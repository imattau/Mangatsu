import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { DEFAULT_RELAYS, useRelayStore } from '@/stores/relayStore'
import type { Comic } from '@/types'
import {
  buildCommentThread,
  comicCommentAddress,
  createFallbackComicCommentEvent,
  type CommentThreadNode,
} from '@/lib/comments'

const EMPTY_EVENTS: NostrEvent[] = []

type ProfileState = {
  name: string | null
  picture: string | null
}

function truncatePubkey(pubkey: string) {
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`
}

function authorInitials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'A'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function formatRelativeTime(createdAt: number) {
  if (!createdAt) return 'just now'

  const diff = Math.floor(Date.now() / 1000) - createdAt
  if (diff < 60) return `${Math.max(diff, 1)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(createdAt * 1000).toLocaleDateString()
}

export function ComicCommentsSection({ comic, comicEvent }: { comic: Comic; comicEvent: NostrEvent | null }) {
  const { service, syncGeneration } = useNostr()
  const eventStore = useEventStore()
  const myPubkey = useAuthStore((s) => s.pubkey)
  const relayUrls = useRelayStore((s) => s.relays)
  const activeAccount = service.activeAccount

  const [replyTarget, setReplyTarget] = useState<NostrEvent | null>(null)
  const [content, setContent] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [profiles, setProfiles] = useState<Record<string, ProfileState | null>>({})

  const activeRelayUrls = useMemo(
    () => (relayUrls.length > 0 ? relayUrls : DEFAULT_RELAYS),
    [relayUrls],
  )
  const relayKey = useMemo(() => activeRelayUrls.join('\u0000'), [activeRelayUrls])

  const parentEvent = useMemo(
    () => comicEvent ?? createFallbackComicCommentEvent(comic),
    [comic, comicEvent],
  )

  useEffect(() => {
    const sub = service.subscribeToComicComments(comic.pubkey, comic.dTag)
    return () => sub.unsubscribe()
  }, [comic.dTag, comic.pubkey, relayKey, service, syncGeneration])

  const commentsFilter = useMemo(
    () => [{ kinds: [1111], '#A': [comicCommentAddress(comic)] }],
    [comic],
  )
  const commentsTimeline$ = useMemo(
    () => eventStore.timeline(commentsFilter),
    [commentsFilter, eventStore],
  )
  const commentEvents = useObservableState(commentsTimeline$) ?? EMPTY_EVENTS

  const commentThread = useMemo(() => buildCommentThread(commentEvents), [commentEvents])

  const authorPubkeys = useMemo(
    () => [...new Set(commentEvents.map((event) => event.pubkey).filter(Boolean))],
    [commentEvents],
  )

  useEffect(() => {
    let cancelled = false
    const missing = authorPubkeys.filter((pubkey) => profiles[pubkey] === undefined)
    if (missing.length === 0) return

    void Promise.all(
      missing.map(async (pubkey) => {
        const profile = await service.fetchProfile(pubkey)
        return [
          pubkey,
          {
            name: profile?.name?.trim() || profile?.display_name?.trim() || null,
            picture: profile?.picture?.trim() || null,
          },
        ] as const
      }),
    ).then((results) => {
      if (cancelled) return
      setProfiles((current) => {
        const next = { ...current }
        for (const [pubkey, profile] of results) {
          next[pubkey] = profile
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [authorPubkeys, profiles, service, syncGeneration])

  async function publishComment(event: FormEvent) {
    event.preventDefault()
    const body = content.trim()
    if (!body || !activeAccount) return

    const target = replyTarget ?? parentEvent
    setPublishing(true)
    setPublishError('')

    try {
      const draft = await service.eventFactory.comment(target, body)
      const signed = await activeAccount.signer.signEvent(draft)
      await service.publishEvent(signed)
      setContent('')
      setReplyTarget(null)
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err))
    } finally {
      setPublishing(false)
    }
  }

  function selectReplyTarget(node: CommentThreadNode) {
    setReplyTarget(node.event)
  }

  function clearReplyTarget() {
    setReplyTarget(null)
  }

  function authorLabel(pubkey: string) {
    return profiles[pubkey]?.name || truncatePubkey(pubkey)
  }

  function authorPicture(pubkey: string) {
    return profiles[pubkey]?.picture || null
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Comments</p>
        <p className="text-xs text-zinc-500">
          {commentEvents.length} comment{commentEvents.length !== 1 ? 's' : ''}
        </p>
      </div>

      <form onSubmit={(event) => void publishComment(event)} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-900">
            {myPubkey ? (
              <span className="text-xs font-medium text-zinc-300">{authorInitials(truncatePubkey(myPubkey))}</span>
            ) : (
              <span className="text-xs font-medium text-zinc-500">?</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {replyTarget && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-400">
                <span>
                  Replying to{' '}
                  <span className="text-zinc-200">
                    {authorLabel(replyTarget.pubkey)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={clearReplyTarget}
                  className="text-zinc-500 transition hover:text-zinc-200"
                >
                  Clear
                </button>
              </div>
            )}
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={!activeAccount || publishing}
              rows={3}
              placeholder={
                activeAccount
                  ? 'Write a comment...'
                  : 'Sign in to comment'
              }
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
            />
            {publishError && <p className="mt-2 text-sm text-red-400">{publishError}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                Comments are published as Nostr replies so other clients can thread them too.
              </p>
              <button
                type="submit"
                disabled={!activeAccount || publishing || !content.trim()}
                className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? 'Posting…' : 'Post comment'}
              </button>
            </div>
          </div>
        </div>
      </form>

      {commentThread.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-10 text-center">
          <p className="text-sm text-zinc-400">No comments yet.</p>
          <p className="mt-1 text-xs text-zinc-600">Be the first to start the thread.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {commentThread.map((node) => (
            <CommentNodeView
              key={node.event.id}
              node={node}
              depth={0}
              onReply={selectReplyTarget}
              authorLabel={authorLabel}
              authorPicture={authorPicture}
              canReply={Boolean(activeAccount)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function CommentNodeView({
  node,
  depth,
  onReply,
  authorLabel,
  authorPicture,
  canReply,
}: {
  node: CommentThreadNode
  depth: number
  onReply: (node: CommentThreadNode) => void
  authorLabel: (pubkey: string) => string
  authorPicture: (pubkey: string) => string | null
  canReply: boolean
}) {
  const label = authorLabel(node.event.pubkey)
  const picture = authorPicture(node.event.pubkey)

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-zinc-800 pl-4' : ''}>
      <article className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-900">
            {picture ? (
              <img src={picture} alt={label} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs font-medium text-zinc-300">{authorInitials(label)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                to={`/feed?author=${encodeURIComponent(node.event.pubkey)}`}
                className="truncate text-sm font-medium text-zinc-100 transition hover:text-white"
              >
                {label}
              </Link>
              <span className="text-xs text-zinc-500">{formatRelativeTime(node.event.created_at ?? 0)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
              {node.event.content}
            </p>
            {canReply && (
              <button
                type="button"
                onClick={() => onReply(node)}
                className="mt-3 text-xs font-medium text-zinc-400 transition hover:text-zinc-100"
              >
                Reply
              </button>
            )}
          </div>
        </div>
      </article>

      {node.children.length > 0 && (
        <div className="mt-3 space-y-3">
          {node.children.map((child) => (
            <CommentNodeView
              key={child.event.id}
              node={child}
              depth={depth + 1}
              onReply={onReply}
              authorLabel={authorLabel}
              authorPicture={authorPicture}
              canReply={canReply}
            />
          ))}
        </div>
      )}
    </div>
  )
}
