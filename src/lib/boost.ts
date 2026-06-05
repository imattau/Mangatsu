import type { Comic } from '@/types'
import { npubEncode } from 'nostr-tools/nip19'
import { buildBlossomBlobUrl, normalizeBlossomServer, resolveFirstReachableBlossomUrl } from '@/lib/blossom'

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function comicBoostCoverCandidates(comic: Comic, blossomServers: string[] = []): string[] {
  if (!comic.coverHash) return []

  const servers = uniq(
    [
      ...(comic.coverServers ?? []),
      comic.coverServer,
      comic.blossomServer,
      ...blossomServers,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeBlossomServer(value)),
  )

  return servers.map((server) => buildBlossomBlobUrl(server, comic.coverHash))
}

export async function resolveComicBoostCoverUrl(
  comic: Comic,
  blossomServers: string[] = [],
): Promise<string | null> {
  return resolveFirstReachableBlossomUrl(comicBoostCoverCandidates(comic, blossomServers))
}

export function buildComicBoostContent(
  comic: Comic,
  comicUrl: string,
  coverUrl: string,
  appOrigin: string,
): string {
  const authorLabel = comic.author || comic.authorPubkey || comic.pubkey
  const authorRef = getAuthorNostrRef(comic.authorPubkey)
  const body = authorLabel
    ? `Check out ${comic.title} by ${authorLabel}`
    : `Check out ${comic.title}`
  const coverLine = coverUrl || ''
  const hashtags = comic.tags.length > 0 ? comic.tags.map((tag) => `#${tag}`).join(' ') : ''
  const footer = appOrigin ? `Get #mangatsu at ${appOrigin}` : ''

  return [coverLine, body, authorRef, comicUrl, hashtags, footer].filter(Boolean).join('\n')
}

function getAuthorNostrRef(authorPubkey: string): string {
  if (!authorPubkey) return ''
  try {
    return `nostr:${npubEncode(authorPubkey)}`
  } catch {
    return ''
  }
}

export function buildComicBoostTags(comic: Comic, coverUrl: string, comicUrl: string): string[][] {
  const tags: string[][] = [
    ['r', comicUrl],
    ['image', coverUrl, comic.title],
    ['imeta', `url ${coverUrl}`, 'm image/webp', `alt ${comic.title}`, `x ${comic.coverHash}`],
  ]

  if (comic.authorPubkey) {
    tags.push(['p', comic.authorPubkey])
  }

  for (const tag of comic.tags) {
    tags.push(['t', tag])
  }

  return tags
}
