import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { Comic } from '@/types'

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
    tags: event.tags
      .filter((tag) => tag[0] === 't')
      .map((tag) => tag[1])
      .filter(Boolean),
    nsfw: event.tags.some((tag) => tag[0] === 'content-warning'),
    eventId: event.id,
  }
}
