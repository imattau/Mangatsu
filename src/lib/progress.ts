import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { ReadingProgress } from '@/types'

/** Reading progress from a kind 30301 event (`d` = chapter d tag, `page` = 1-based page). */
export function progressFromEvent(event: NostrEvent): ReadingProgress | null {
  if (event.kind !== 30301) return null
  const chapterDTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
  const page = Number(event.tags.find((tag) => tag[0] === 'page')?.[1])
  if (!chapterDTag || !Number.isInteger(page) || page < 1) return null
  return { id: chapterDTag, chapterDTag, page, updatedAt: event.created_at * 1000 }
}

/** NIP-09 `a` tags (plus `k`) asking relays to delete the user's progress for these chapters. */
export function progressDeleteTags(pubkey: string, chapterDTags: Iterable<string>): string[][] {
  const tags = [...new Set(chapterDTags)].map((dTag) => ['a', `30301:${pubkey}:${dTag}`])
  return tags.length > 0 ? [...tags, ['k', '30301']] : []
}

/** Chapter d tags whose progress (by `pubkey`) a kind 5 deletion request removes. */
export function deletedProgressChapters(event: NostrEvent, pubkey: string): string[] {
  if (event.kind !== 5 || event.pubkey !== pubkey) return []
  const prefix = `30301:${pubkey}:`
  return event.tags
    .filter((tag) => tag[0] === 'a' && tag[1]?.startsWith(prefix))
    .map((tag) => tag[1].slice(prefix.length))
    .filter(Boolean)
}
