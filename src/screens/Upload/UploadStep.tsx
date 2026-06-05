import { useEffect, useRef, useState } from 'react'
import { blossomService } from '@/services/BlossomService'
import { DEFAULT_BLOSSOM_SERVERS, useBlossomStore } from '@/stores/blossomStore'
import { useNostr } from '@/context/NostrContext'
import { convertImageFileToWebp } from './webp'
import { MAX_CHAPTER_PAGES } from './limits'
import type { UploadArtifact } from './publishDraft'
import { BLOSSOM_UPLOAD_TIMEOUT_MS, uploadFileToServers } from './uploadHelpers'
import { webTorrentService } from '@/services/WebTorrentService'

export interface ServerResult {
  url: string
  uploaded: number
  total: number
}

export interface UploadResult {
  pageUploads: UploadArtifact[]
  coverUpload: UploadArtifact | null
  serverResults: ServerResult[]
}

type UploadArtifactState = UploadArtifact & { missingServers: string[] }

interface UploadStepProps {
  pages: File[]
  coverFile: File | null
  coverMode: 'file' | 'first-page'
  onDone: (result: UploadResult) => void
  onBack: () => void
}

export function UploadStep({ pages, coverFile, coverMode, onDone, onBack }: UploadStepProps) {
  const servers = useBlossomStore((s) => s.servers)
  const setCachedHash = useBlossomStore((s) => s.setCachedHash)
  const { service } = useNostr()
  const [uploaded, setUploaded] = useState(0)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'converting' | 'uploading'>('idle')
  const ranRef = useRef(false)

  const total = pages.length + (coverFile || coverMode === 'first-page' ? 1 : 0)

  function getUploadServers(): string[] {
    const ordered = [
      ...servers.map((server) => server.url),
      ...DEFAULT_BLOSSOM_SERVERS,
    ]
    return [...new Set(ordered.filter((server) => server.trim().length > 0))]
  }

  async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: number | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error(`Timed out ${label}`)),
            timeoutMs,
          )
        }),
      ])
    } finally {
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function uploadToAll(file: File, serverUrls: string[]): Promise<UploadArtifactState> {
    const account = service.accountManager.active
    if (!account) throw new Error('Not logged in')

    const upload = await uploadFileToServers(
      serverUrls,
      (serverUrl) =>
        withTimeout(
          blossomService.upload(file, serverUrl, account.signer as never),
          BLOSSOM_UPLOAD_TIMEOUT_MS,
          `uploading to ${serverUrl}`,
        ),
      setCachedHash,
    )

    return {
      ...upload,
      missingServers: upload.missingServers ?? [],
    }
  }

  async function convertAndUploadToAll(file: File, serverUrls: string[]): Promise<UploadArtifact> {
    setPhase('converting')
    const webpFile = await convertImageFileToWebp(file)
    setPhase('uploading')
    return uploadToAll(webpFile, serverUrls)
  }

  async function run() {
    setRunning(true)
    setError('')
    setPhase('idle')

    if (pages.length > MAX_CHAPTER_PAGES) {
      setError(
        `Chapter has ${pages.length} pages. Maximum allowed is ${MAX_CHAPTER_PAGES} pages.`,
      )
      setRunning(false)
      return
    }

    const serverUrls = getUploadServers()
    const pageUploads: UploadArtifactState[] = []
    const convertedNamedFiles: File[] = []

    for (const page of pages) {
      try {
        setPhase('converting')
        const webpFile = await convertImageFileToWebp(page)
        setPhase('uploading')
        const upload = await uploadToAll(webpFile, serverUrls)

        pageUploads.push({
          ...upload,
          missingServers: upload.missingServers ?? [],
        })

        const extension = webpFile.name.split('.').pop() || 'webp'
        const namedFile = new File([webpFile], `${upload.hash}.${extension}`, { type: webpFile.type })
        convertedNamedFiles.push(namedFile)

        setUploaded((n) => n + 1)
      } catch (err) {
        setError(`Failed to upload page: ${err instanceof Error ? err.message : String(err)}`)
        setRunning(false)
        setPhase('idle')
        return
      }
    }

    let coverUpload: UploadArtifactState | null = null
    const coverSource = coverMode === 'first-page' ? pages[0] : coverFile
    if (coverSource) {
      try {
        const upload = await convertAndUploadToAll(coverSource, serverUrls)
        coverUpload = {
          ...upload,
          missingServers: upload.missingServers ?? [],
        }
        setUploaded((n) => n + 1)
      } catch (err) {
        setError(`Failed to upload cover: ${err instanceof Error ? err.message : String(err)}`)
        setRunning(false)
        setPhase('idle')
        return
      }
    }

    let magnetURI: string | undefined = undefined
    if (webTorrentService.isWebTorrentEnabled() && convertedNamedFiles.length > 0) {
      try {
        const title = `Chapter-${Date.now()}`
        const torrentResult = await webTorrentService.seedFiles(convertedNamedFiles, title)
        magnetURI = torrentResult.magnetURI
      } catch (torrentErr) {
        console.warn('Failed to seed chapter torrent:', torrentErr)
      }
    }

    const allUploads = [...pageUploads, ...(coverUpload ? [coverUpload] : [])]
    const serverResults: ServerResult[] = serverUrls.map((url) => ({
      url,
      uploaded: allUploads.filter((u) => u.servers.includes(url)).length,
      total: allUploads.length,
    }))

    setRunning(false)
    setPhase('idle')
    onDone({ pageUploads, coverUpload, serverResults, magnetURI })
  }

  const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-zinc-100">Step 3 — Uploading</h2>

      <div className="space-y-2">
        <div className="flex justify-between text-sm text-zinc-400">
          <span>
            {running
              ? phase === 'converting'
                ? `Converting ${uploaded + 1} of ${total}...`
                : `Uploading ${uploaded + 1} of ${total}...`
              : uploaded === total
              ? 'Upload complete'
              : 'Ready'}
          </span>
          <span>{percent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-white transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-zinc-700 px-5 py-3 text-sm text-zinc-300 transition hover:border-zinc-500"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                ranRef.current = false
                void run()
              }}
              className="flex-1 rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
