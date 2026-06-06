import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { Chapter, Comic, PageDimensions } from '@/types'

export function parseTag(event: NostrEvent, name: string): string {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

export function parseTagTail(event: NostrEvent, name: string, startIndex: number): string[] {
  const tag = event.tags.find((entry) => entry[0] === name)
  return tag ? tag.slice(startIndex).filter(Boolean) : []
}

export function parseAnyTag(event: NostrEvent, names: string[]): string {
  for (const name of names) {
    const value = parseTag(event, name)
    if (value) return value
  }
  return ''
}

function parsePageUploads(event: NostrEvent): Array<{ hash: string; server: string }> {
  return event.tags
    .filter((tag) => tag[0] === 'page')
    .map((tag) => {
      const raw = tag[1] ?? ''
      const hash = raw.startsWith('blossom://') ? raw.slice('blossom://'.length) : raw
      return { hash, server: tag[2] ?? '' }
    })
    .filter((upload) => upload.hash.length > 0)
}

function parsePageTorrentMap(event: NostrEvent): Record<string, string> {
  return event.tags
    .filter((tag) => tag[0] === 'page_torrent')
    .reduce<Record<string, string>>((acc, tag) => {
      const raw = tag[1] ?? ''
      const hash = raw.startsWith('blossom://') ? raw.slice('blossom://'.length) : raw
      const torrent = tag[2] ?? ''
      if (hash && torrent) {
        acc[hash] = torrent
      }
      return acc
  }, {})
}

function parsePageDimensionsMap(event: NostrEvent): Record<string, { width: number; height: number }> {
  return event.tags
    .filter((tag) => tag[0] === 'page_dimensions')
    .reduce<Record<string, { width: number; height: number }>>((acc, tag) => {
      const raw = tag[1] ?? ''
      const hash = raw.startsWith('blossom://') ? raw.slice('blossom://'.length) : raw
      const width = Number.parseInt(tag[2] ?? '', 10)
      const height = Number.parseInt(tag[3] ?? '', 10)
      if (hash && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        acc[hash] = { width, height }
      }
      return acc
    }, {})
}

export function parseComicEvent(event: NostrEvent, server: string | undefined): Comic | null {
  const dTag = parseTag(event, 'd')
  if (!dTag) return null
  const coverServers = [
    ...parseTagTail(event, 'cover', 2),
    ...parseTagTail(event, 'image', 2),
  ]
  const coverServer = coverServers[0] || ''
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: parseTag(event, 'title') || event.content || 'Untitled',
    author: parseTag(event, 'author'),
    authorPubkey: parseTag(event, 'author_pubkey'),
    description: parseTag(event, 'description') || event.content || '',
    coverHash: parseAnyTag(event, ['cover', 'cover_hash', 'image']),
    blossomServer: parseAnyTag(event, ['blossom', 'blossom_server']) || coverServer || server || '',
    coverServer,
    coverServers,
    coverTorrent: parseAnyTag(event, ['cover_torrent', 'image_torrent']) || undefined,
    tags: event.tags
      .filter((tag) => tag[0] === 't')
      .map((tag) => tag[1])
      .filter(Boolean),
    nsfw: event.tags.some((tag) => tag[0] === 'content-warning'),
    eventId: event.id,
  }
}

export function parseChapterEvent(event: NostrEvent, comicDTag: string): Chapter | null {
  const dTag = parseTag(event, 'd')
  if (!dTag || !dTag.startsWith(`${comicDTag}/`)) return null

  const pageUploads = parsePageUploads(event)
  const pageTorrentMap = parsePageTorrentMap(event)
  const pageDimensionsMap = parsePageDimensionsMap(event)
  const chapterTorrent = parseTag(event, 'torrent') || parseTag(event, 'magnet') || ''
  const parsedPageDimensions = pageUploads.map((upload) => pageDimensionsMap[upload.hash])
  const pageDimensions = parsedPageDimensions.every(
    (dimension): dimension is PageDimensions => Boolean(dimension),
  )
    ? parsedPageDimensions
    : undefined

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    parentDTag: comicDTag,
    title: parseTag(event, 'title') || dTag,
    pageHashes: pageUploads.map((upload) => upload.hash),
    pageDimensions,
    pageServers: pageUploads.map((upload) => upload.server),
    pageServerLists: event.tags
      .filter((tag) => tag[0] === 'page')
      .map((tag) => tag.slice(2).filter(Boolean)),
    pageTorrents: pageUploads.map((upload) => pageTorrentMap[upload.hash] || chapterTorrent || ''),
    blossomServer: parseTag(event, 'blossom') || pageUploads[0]?.server || '',
    publishedAt: event.created_at ?? 0,
    eventId: event.id,
    torrent: chapterTorrent || pageTorrentMap[pageUploads[0]?.hash ?? ''] || undefined,
  }
}
