import type { Chapter, Comic } from '@/types'

export function normalizeBlossomServer(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return value.replace(/\/$/, '')
  }
}

export interface BlossomAssetRef {
  server: string
  hash: string
  label: string
}

export interface BlossomServerAvailability {
  server: string
  assets: BlossomAssetRef[]
}

export function buildBlossomBlobUrl(server: string, hash: string): string {
  return `${normalizeBlossomServer(server)}/${hash}`
}

export function probeBlossomImage(url: string, timeoutMs = 8000): Promise<boolean> {
  if (typeof Image === 'undefined') {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    const image = new Image()
    let settled = false

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }

    const timer = window.setTimeout(() => finish(false), timeoutMs)
    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    image.src = url
  })
}

export async function probeBlossomAssetExists(url: string): Promise<boolean> {
  if (typeof fetch === 'undefined') return false

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      mode: 'cors',
      headers: { Range: 'bytes=0-0' },
    })
    return response.ok
  } catch {
    return false
  }
}

export async function resolveFirstReachableBlossomUrl(candidates: string[]): Promise<string | null> {
  for (const url of candidates) {
    if (await probeBlossomAssetExists(url)) {
      return url
    }
  }

  return null
}

export function collectComicBlossomAssets(comic: Comic | null | undefined, chapters: Chapter[]): BlossomAssetRef[] {
  if (!comic) return []

  const assets: BlossomAssetRef[] = []

  const coverServers = [
    ...(comic.coverServers ?? []),
    comic.coverServer,
    comic.blossomServer,
  ].filter(Boolean) as string[]
  const uniqueCoverServers = [...new Set(coverServers.map(normalizeBlossomServer))]
  for (const coverServer of uniqueCoverServers) {
    if (!comic.coverHash || !coverServer) continue
    assets.push({
      server: coverServer,
      hash: comic.coverHash,
      label: 'Cover',
    })
  }

  for (const chapter of chapters) {
    const fallbackServers = [
      ...(chapter.pageServerLists ?? []).flat(),
      ...(chapter.pageServers ?? []),
      chapter.blossomServer,
      comic.blossomServer,
      ...(comic.coverServers ?? []),
      comic.coverServer,
    ].filter(Boolean) as string[]
    chapter.pageHashes.forEach((hash, index) => {
      const pageServers = [
        ...(chapter.pageServerLists?.[index] ?? []),
        chapter.pageServers?.[index],
        ...fallbackServers,
      ].filter(Boolean) as string[]
      const uniquePageServers = [...new Set(pageServers.map(normalizeBlossomServer))]
      for (const server of uniquePageServers) {
        if (!server || !hash) continue
        assets.push({
          server,
          hash,
          label: `${chapter.title} page ${index + 1}`,
        })
      }
    })
  }

  return assets
}

export function groupBlossomAssetsByServer(assets: BlossomAssetRef[]): BlossomServerAvailability[] {
  const grouped = new Map<string, BlossomAssetRef[]>()

  for (const asset of assets) {
    const server = normalizeBlossomServer(asset.server)
    const current = grouped.get(server) ?? []
    current.push({ ...asset, server })
    grouped.set(server, current)
  }

  return [...grouped.entries()].map(([server, serverAssets]) => ({
    server,
    assets: serverAssets,
  }))
}
