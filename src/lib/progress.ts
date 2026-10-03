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
