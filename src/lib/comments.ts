import type { NostrEvent } from 'applesauce-core/helpers/event'
import { getCommentReplyPointer, isValidComment } from 'applesauce-common/helpers'
import { createReplaceableAddress } from 'applesauce-core/helpers/event'
import type { Comic } from '@/types'

export interface CommentThreadNode {
  event: NostrEvent
  children: CommentThreadNode[]
}

export function comicCommentAddress(comic: Pick<Comic, 'pubkey' | 'dTag'>): string {
  return createReplaceableAddress(30040, comic.pubkey, comic.dTag)
}

export function createFallbackComicCommentEvent(comic: Pick<Comic, 'pubkey' | 'dTag' | 'eventId'>): NostrEvent {
  return {
    id: comic.eventId,
    kind: 30040,
    pubkey: comic.pubkey,
    created_at: 0,
    content: '',
    tags: [['d', comic.dTag]],
    sig: '',
  }
}

export function buildCommentThread(events: NostrEvent[]): CommentThreadNode[] {
  const sorted = [...events]
    .filter(isValidComment)
    .sort((a, b) => {
      const delta = (a.created_at ?? 0) - (b.created_at ?? 0)
      return delta !== 0 ? delta : a.id.localeCompare(b.id)
    })

  const nodes = new Map<string, CommentThreadNode>()
  const parentIds = new Map<string, string | null>()

  for (const event of sorted) {
    nodes.set(event.id, { event, children: [] })
    const replyPointer = getCommentReplyPointer(event)
    parentIds.set(event.id, replyPointer?.type === 'event' ? replyPointer.id : null)
  }

  const roots: CommentThreadNode[] = []
  for (const event of sorted) {
    const node = nodes.get(event.id)
    if (!node) continue

    const parentId = parentIds.get(event.id)
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}
