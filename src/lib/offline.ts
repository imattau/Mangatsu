import type { Chapter, Comic } from '@/types'
import {
  buildBlossomBlobUrl,
  collectComicBlossomAssets,
  probeBlossomAssetExists,
} from '@/lib/blossom'

const IMAGE_CACHE = 'mangatsu-images-v1'

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export interface OfflineAssetTarget {
  key: string
  label: string
  candidates: string[]
}

export function comicOfflineTargets(comic: Comic | null | undefined, chapters: Chapter[]): OfflineAssetTarget[] {
  const grouped = new Map<string, OfflineAssetTarget>()

  for (const asset of collectComicBlossomAssets(comic, chapters)) {
    const key = `${asset.label}::${asset.hash}`
    const url = buildBlossomBlobUrl(asset.server, asset.hash)
    const existing = grouped.get(key)
    if (existing) {
      existing.candidates.push(url)
      continue
    }
    grouped.set(key, {
      key,
      label: asset.label,
      candidates: [url],
    })
  }

  return [...grouped.values()].map((target) => ({
    ...target,
    candidates: uniq(target.candidates),
  }))
}

async function openImageCache() {
  if (typeof caches === 'undefined') return null
  return caches.open(IMAGE_CACHE)
}

export async function areTargetsCached(targets: OfflineAssetTarget[]): Promise<boolean> {
  const cache = await openImageCache()
  if (!cache) return false

  for (const target of targets) {
    let cached = false
    for (const url of target.candidates) {
      if (await cache.match(url)) {
        cached = true
        break
      }
    }
    if (!cached) {
      return false
    }
  }

  return true
}

export async function cacheTargetsForOffline(
  targets: OfflineAssetTarget[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const cache = await openImageCache()
  if (!cache) {
    throw new Error('Offline caching is not available in this browser')
  }

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    const url = await chooseWorkingUrl(target.candidates)
    if (!url) {
      throw new Error(`Missing asset: ${target.label}`)
    }

    const response = await fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
    })
    await cache.put(url, response.clone())
    onProgress?.(index + 1, targets.length)
  }
}

export async function removeTargetsFromOfflineCache(targets: OfflineAssetTarget[]): Promise<void> {
  const cache = await openImageCache()
  if (!cache) {
    return
  }

  for (const target of targets) {
    for (const url of target.candidates) {
      await cache.delete(url)
    }
  }
}

async function chooseWorkingUrl(candidates: string[]): Promise<string | null> {
  for (const url of candidates) {
    if (await probeBlossomAssetExists(url)) {
      return url
    }
  }

  return null
}
