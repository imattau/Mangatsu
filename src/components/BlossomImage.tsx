import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlossomStore } from '@/stores/blossomStore'
import { DEFAULT_BLOSSOM_SERVERS } from '@/stores/blossomStore'
import { buildBlossomBlobUrl, normalizeBlossomServer, probeBlossomAssetExists } from '@/lib/blossom'
import { webTorrentService } from '@/services/WebTorrentService'

function uniq(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!value) continue
    const normalized = value.replace(/\/$/, '')
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

const PLACEHOLDER_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

interface BlossomImageProps {
  hash: string
  alt: string
  server?: string
  servers?: string[]
  className?: string
  loading?: 'eager' | 'lazy'
  torrent?: string
}

export const BlossomImage = forwardRef<HTMLImageElement, BlossomImageProps>(function BlossomImage(
  { hash, alt, server, servers: explicitServers = [], className, loading = 'lazy', torrent },
  ref,
) {
  const blossomServers = useBlossomStore((state) => state.servers)
  const cachedUrl = useBlossomStore((state) => state.cachedHashes[hash] ?? '')

  const serverCandidates = useMemo(
    () => uniq([...explicitServers, ...blossomServers.map((s) => s.url), server, ...DEFAULT_BLOSSOM_SERVERS]),
    [blossomServers, explicitServers, server],
  )
  const cachedUrlAllowed = useMemo(() => {
    if (!cachedUrl) return false
    const cachedOrigin = normalizeBlossomServer(cachedUrl)
    return serverCandidates.some((candidate) => normalizeBlossomServer(candidate) === cachedOrigin)
  }, [cachedUrl, serverCandidates])

  // Ordered list of URLs to probe for availability and fallback.
  const candidates = useMemo(
    () =>
      uniq([
        ...(cachedUrlAllowed ? [cachedUrl] : []),
        ...explicitServers,
        ...blossomServers.map((s) => s.url),
        server,
        ...DEFAULT_BLOSSOM_SERVERS,
      ]).map((candidate) =>
        candidate === cachedUrl ? candidate : buildBlossomBlobUrl(candidate, hash),
      ),
    [blossomServers, cachedUrl, cachedUrlAllowed, explicitServers, hash, server],
  )

  const [resolvedSrc, setResolvedSrc] = useState(() => {
    const memCached = webTorrentService.getResolvedBlobUrl(hash)
    if (memCached) return memCached
    return cachedUrlAllowed ? cachedUrl : PLACEHOLDER_SRC
  })
  const nextIndexRef = useRef(1)

  // Reset probing state whenever candidates change or torrent is updated.
  const candidatesKey = candidates.join('\n')
  useEffect(() => {
    let cancelled = false
    let objectUrl = ''

    // Only reset to placeholder if we don't have a cached version ready in memory
    const existing = webTorrentService.getResolvedBlobUrl(hash)
    if (!existing) {
      setResolvedSrc(PLACEHOLDER_SRC)
    }
    nextIndexRef.current = 1

    async function loadWithFallback() {
      if (existing) {
        setResolvedSrc(existing)
        return
      }

      if (torrent) {
        try {
          // Add a 1.5-second timeout for WebTorrent resolution (metadata & file fetching)
          const torrentPromise = webTorrentService.getFile(torrent, hash)
          const timeoutPromise = new Promise<Blob>((_, reject) =>
            setTimeout(() => reject(new Error('WebTorrent timed out')), 1500)
          )
          
          const blob = await Promise.race([torrentPromise, timeoutPromise])
          if (cancelled) return
          objectUrl = URL.createObjectURL(blob)
          webTorrentService.setResolvedBlobUrl(hash, objectUrl)
          setResolvedSrc(objectUrl)
          return
        } catch (err) {
          console.warn('WebTorrent load failed, falling back to Blossom:', err)
        }
      }

      if (cancelled) return
      if (candidates.length === 0) return

      try {
        const winner = await Promise.any(
          candidates.map(async (candidate, index) => {
            const ok = await probeBlossomAssetExists(candidate)
            if (!ok) {
              throw new Error('missing blob')
            }
            return { candidate, index }
          }),
        )
        if (cancelled) return
        nextIndexRef.current = winner.index + 1
        setResolvedSrc(winner.candidate)
      } catch {
        // Keep the placeholder until an onError fallback finds a working URL.
      }
    }

    void loadWithFallback()

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [candidatesKey, torrent, hash])

  const handleError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const idx = nextIndexRef.current
      if (idx < candidates.length) {
        nextIndexRef.current = idx + 1
        e.currentTarget.src = candidates[idx]
      } else {
        e.currentTarget.src = PLACEHOLDER_SRC
      }
    },
    // candidates identity changes when candidatesKey changes, which also resets nextIndexRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidatesKey],
  )

  return (
    <img
      ref={ref}
      src={resolvedSrc}
      alt={alt}
      loading={loading}
      className={className}
      onError={handleError}
    />
  )
})
