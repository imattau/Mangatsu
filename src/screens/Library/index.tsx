import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import { BrandMark } from '@/components/BrandMark'
import { HeaderNav } from '@/components/HeaderNav'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { useComicStore } from '@/stores/comicStore'
import { usePublishQueueStore, type PendingPublishDraft } from '@/stores/publishQueueStore'
import { useReadStore } from '@/stores/readStore'
import type { Comic } from '@/types'
import { publishDraft } from '@/screens/Upload/publishDraft'

const COMIC_FILTER = (pubkey: string) => [{ kinds: [30040], authors: [pubkey] }]
const EMPTY_EVENTS: NostrEvent[] = []

const UploadIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0"
  >
    <path d="M12 16V4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M4 20h16" />
  </svg>
)

const SettingsIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.34-1.88l-.05-.05A2 2 0 1 1 7.04 4.24l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)

function parseTag(event: NostrEvent, name: string) {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

function parseTagAt(event: NostrEvent, name: string, index: number) {
  return event.tags.find((tag) => tag[0] === name)?.[index] ?? ''
}

function parseAnyTag(event: NostrEvent, names: string[]) {
  for (const name of names) {
    const value = parseTag(event, name)
    if (value) {
      return value
    }
  }
  return ''
}

function parseComicEvent(event: NostrEvent, server: string | undefined): Comic | null {
  const dTag = parseTag(event, 'd')
  if (!dTag) {
    return null
  }
  const coverServer = parseTagAt(event, 'cover', 2) || parseTagAt(event, 'image', 2) || ''

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: parseTag(event, 'title') || event.content || 'Untitled',
    author: parseTag(event, 'author'),
    description: parseTag(event, 'description') || event.content || '',
    coverHash: parseAnyTag(event, ['cover', 'cover_hash', 'image']),
    blossomServer: parseAnyTag(event, ['blossom', 'blossom_server']) || coverServer || server || '',
    coverServer,
    tags: event.tags
      .filter((tag) => tag[0] === 't')
      .map((tag) => tag[1])
      .filter(Boolean),
    eventId: event.id,
  }
}

function coverUrl(hash: string, server: string | undefined) {
  if (!hash || !server) {
    return null
  }
  return `${server.replace(/\/$/, '')}/blob/${hash}`
}

function chapterLabel(dTag: string) {
  const match = dTag.match(/(\d+(?:\.\d+)?)/)
  return match ? `Ch. ${match[1]}` : `Ch. ${dTag}`
}

export function LibraryScreen() {
  const { service } = useNostr()
  const eventStore = useEventStore()
  const pubkey = useAuthStore((state) => state.pubkey)
  const comics = useComicStore((state) => state.comics)
  const setComic = useComicStore((state) => state.setComic)
  const draftMap = usePublishQueueStore((state) => state.draftsByComicDTag)
  const removeDraft = usePublishQueueStore((state) => state.removeDraft)
  const queueDraft = usePublishQueueStore((state) => state.queueDraft)
  const progress = useReadStore((state) => state.progress)
  const primaryServer = useBlossomStore((state) => state.primaryServer)
  const relayStatus = useObservableState(service.relayPool.status$)
  const [retryingComicDTag, setRetryingComicDTag] = useState<string | null>(null)
  const queuedDrafts = useMemo(
    () => Object.values(draftMap).sort((a, b) => b.queuedAt - a.queuedAt),
    [draftMap],
  )

  const comicTimeline$ = useMemo(
    () => (pubkey ? eventStore.timeline(COMIC_FILTER(pubkey)) : of([])),
    [eventStore, pubkey],
  )
  const liveComicEvents = useObservableState(comicTimeline$) ?? EMPTY_EVENTS

  useEffect(() => {
    for (const event of liveComicEvents) {
      const comic = parseComicEvent(event, primaryServer())
      if (comic) {
        setComic(comic)
      }
    }
  }, [liveComicEvents, primaryServer, setComic])

  const allComics = useMemo(
    () => Object.values(comics).sort((a, b) => a.title.localeCompare(b.title)),
    [comics],
  )

  const latestProgress = useMemo(
    () =>
      Object.values(progress).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
    [progress],
  )

  const continueComic = useMemo(() => {
    if (!latestProgress) {
      return null
    }
    return (
      allComics.find((comic) => latestProgress.chapterDTag.startsWith(comic.dTag)) ?? null
    )
  }, [allComics, latestProgress])

  const onlineCount =
    relayStatus ? Object.values(relayStatus).filter((status) => status.connected).length : 0

  async function handleRetry(draft: PendingPublishDraft) {
    setRetryingComicDTag(draft.comicDTag)
    try {
      await publishDraft(service, draft)
      removeDraft(draft.comicDTag)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      queueDraft(draft, message)
    } finally {
      setRetryingComicDTag(null)
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 py-4 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" showLabel={false} />
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">Library</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <HeaderNav />
            <div className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-400">
              {onlineCount > 0 ? `${onlineCount} relay${onlineCount === 1 ? '' : 's'} online` : 'Offline cache'}
            </div>
            <Link
              to="/upload"
              aria-label="Upload a comic"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-white px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200"
            >
              <UploadIcon />
              <span className="hidden sm:inline">Upload a comic</span>
            </Link>
            <Link
              to="/settings"
              aria-label="Settings"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white"
            >
              <SettingsIcon />
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </div>
        </header>

        {queuedDrafts.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Queued for publish</p>
                <p className="mt-2 text-sm text-zinc-500">
                  These comics are saved locally and waiting for a successful relay publish.
                </p>
              </div>
              <p className="text-xs text-zinc-600">{queuedDrafts.length} queued</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {queuedDrafts.map((draft) => (
                <QueuedComicCard
                  key={draft.comicDTag}
                  draft={draft}
                  retrying={retryingComicDTag === draft.comicDTag}
                  onRetry={() => void handleRetry(draft)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {continueComic && latestProgress ? (
            <section className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950/90 shadow-2xl shadow-black/30">
            <div className="grid gap-4 p-4 sm:grid-cols-[120px_1fr_auto] sm:items-center sm:p-5">
              <CoverImage
                comic={continueComic}
                size="hero"
                server={continueComic.coverServer || continueComic.blossomServer || primaryServer()}
              />
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
                  Continue Reading
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  {continueComic.title}
                </h2>
                <p className="mt-2 text-sm text-zinc-400">
                  {chapterLabel(latestProgress.chapterDTag)} · p.{latestProgress.page}
                </p>
              </div>
              <Link
                to={`/comic/${continueComic.dTag}/chapter/${encodeURIComponent(latestProgress.chapterDTag)}`}
                className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200"
              >
                Continue
              </Link>
            </div>
          </section>
        ) : null}

        {allComics.length === 0 && queuedDrafts.length === 0 ? (
          <section className="flex min-h-[50vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
            <p className="text-lg font-medium text-zinc-100">No comics yet</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
              Your library will appear here once your relays sync or you import comics locally.
            </p>
              <Link
                to="/upload"
                className="mt-6 rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                Upload a comic
              </Link>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">All Comics</p>
              <p className="text-xs text-zinc-600">{allComics.length} total</p>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {allComics.map((comic) => (
                <Link
                  key={comic.dTag}
                  to={`/comic/${comic.dTag}`}
                  className="group flex flex-col gap-2 rounded-2xl transition hover:-translate-y-0.5"
                >
                  <CoverImage
                    comic={comic}
                    size="grid"
                    server={comic.coverServer || comic.blossomServer || primaryServer()}
                  />
                  <div className="px-0.5">
                    <p className="text-sm font-medium leading-5 text-zinc-100 group-hover:text-white">
                      {comic.title}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function QueuedComicCard({
  draft,
  retrying,
  onRetry,
}: {
  draft: PendingPublishDraft
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <article className="rounded-[1.5rem] border border-amber-900/40 bg-amber-950/20 p-4 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.65rem] uppercase tracking-[0.35em] text-amber-300/80">Queued</p>
          <h3 className="mt-2 truncate text-lg font-semibold text-zinc-100">{draft.title}</h3>
          <p className="mt-1 truncate text-sm text-zinc-400">{draft.comicDTag}</p>
        </div>
        <span className="rounded-full border border-amber-800/50 bg-amber-950/60 px-2.5 py-1 text-xs text-amber-200">
          Retry pending
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-400">
        {draft.lastError
          ? `Last publish error: ${draft.lastError}`
          : 'This comic is waiting for a relay acknowledgement. You can retry publish from here.'}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrying ? 'Retrying…' : 'Retry Publish'}
        </button>
        <p className="text-xs text-zinc-500">
          Queued since {new Date(draft.queuedAt).toLocaleString()}
        </p>
      </div>
    </article>
  )
}

function CoverImage({
  comic,
  size,
  server,
}: {
  comic: Comic
  size: 'hero' | 'grid'
  server: string | undefined
}) {
  const cachedUrl = useBlossomStore((state) => state.cachedHashes[comic.coverHash] ?? '')
  const url = coverUrl(comic.coverHash, server)
  const imageUrl = cachedUrl || url
  const className =
    size === 'hero'
      ? 'aspect-[2/3] w-full max-w-[120px] rounded-2xl object-cover shadow-lg shadow-black/20 sm:max-w-none'
      : 'aspect-[2/3] w-full rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'

  if (!imageUrl) {
    return <div className={className} />
  }

  return <img src={imageUrl} alt={comic.title} loading="lazy" className={className} />
}
