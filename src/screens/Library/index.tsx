import { useEffect, useMemo, useState } from 'react'
import { useLibraryStore } from '@/stores/libraryStore'
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
import { BlossomImage } from '@/components/BlossomImage'

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

const RefreshIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`h-4 w-4 shrink-0 ${className}`.trim()}
  >
    <path d="M20 11a8 8 0 1 0 2 5.3" />
    <path d="M20 5v6h-6" />
  </svg>
)

const HamburgerIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0"
  >
    {open ? (
      <>
        <path d="M6 6l12 12" />
        <path d="M18 6L6 18" />
      </>
    ) : (
      <>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
      </>
    )}
  </svg>
)

function parseTag(event: NostrEvent, name: string) {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

function parseTagTail(event: NostrEvent, name: string, startIndex: number) {
  const tag = event.tags.find((entry) => entry[0] === name)
  return tag ? tag.slice(startIndex).filter(Boolean) : []
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

function chapterLabel(dTag: string) {
  const match = dTag.match(/(\d+(?:\.\d+)?)/)
  return match ? `Ch. ${match[1]}` : `Ch. ${dTag}`
}

function parseSavedTag(aTag: string) {
  const [kind, authorPubkey, dTag] = aTag.split(':')
  return kind === '30040' && authorPubkey && dTag ? { authorPubkey, dTag } : null
}

type SavedEntry = {
  aTag: string
  authorPubkey: string
  dTag: string
  comic: Comic | null
}

export function LibraryScreen() {
  const { service, refreshSync } = useNostr()
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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

  const savedATags = useLibraryStore((s) => s.savedATags)
  const savedEntries = useMemo<SavedEntry[]>(
    () =>
      savedATags.flatMap((aTag) => {
        const parsed = parseSavedTag(aTag)
        if (!parsed) return []
        return [
          {
            aTag,
            ...parsed,
            comic: comics[parsed.dTag] ?? null,
          },
        ]
      }),
    [savedATags, comics],
  )

  useEffect(() => {
    if (!pubkey) return

    const missingEntries = savedEntries.filter((entry) => entry.comic === null)
    if (missingEntries.length === 0) return

    const subs = missingEntries.map((entry) =>
      service.subscribeToForeignComic(entry.authorPubkey, entry.dTag, (foreignEvent) => {
        const comic = parseComicEvent(foreignEvent, primaryServer())
        if (comic) {
          setComic(comic)
        }
      }),
    )

    return () => {
      for (const sub of subs) {
        sub.unsubscribe()
      }
    }
  }, [pubkey, primaryServer, savedEntries, service, setComic])

  const allComics = useMemo(
    () => Object.values(comics).sort((a, b) => a.title.localeCompare(b.title)),
    [comics],
  )
  const ownComics = useMemo(
    () => allComics.filter((comic) => comic.pubkey === pubkey),
    [allComics, pubkey],
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
  const relayOnline = onlineCount > 0

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
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
            <BrandMark size="sm" showLabel={false} />
            <div className="min-w-0">
              <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
              <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">Library</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <HeaderNav />
            <Link
              to="/upload"
              aria-label="Upload a comic"
              className="hidden items-center gap-1.5 rounded-full border border-zinc-700 bg-white px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 sm:inline-flex"
            >
              <UploadIcon />
              <span className="hidden sm:inline">Upload a comic</span>
            </Link>
            <div
              className={`inline-flex items-center gap-2 rounded-full border bg-zinc-950/80 px-3 py-1.5 text-xs transition ${
                relayOnline
                  ? 'border-emerald-500/30 text-emerald-300'
                  : 'border-rose-500/30 text-rose-300'
              }`}
              title={relayOnline ? `${onlineCount} relay${onlineCount === 1 ? '' : 's'} online` : 'Offline cache'}
              aria-label={relayOnline ? `${onlineCount} relays online` : 'Offline cache'}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  relayOnline ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              <span className="hidden sm:inline">
                {relayOnline ? `${onlineCount} relay${onlineCount === 1 ? '' : 's'} online` : 'Offline cache'}
              </span>
            </div>
            <button
              type="button"
              onClick={refreshSync}
              aria-label="Refresh relays"
              title="Refresh relays"
              className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white sm:inline-flex"
            >
              <RefreshIcon />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <Link
              to="/settings"
              aria-label="Settings"
              className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white sm:inline-flex"
            >
              <SettingsIcon />
              <span className="hidden sm:inline">Settings</span>
            </Link>
            <div className="relative sm:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((value) => !value)}
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileMenuOpen}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/80 text-zinc-300 transition hover:border-zinc-600 hover:text-white"
              >
                <HamburgerIcon open={mobileMenuOpen} />
              </button>
              {mobileMenuOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black/40">
                  <Link
                    to="/upload"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-3 text-sm text-zinc-200 transition hover:bg-zinc-900"
                  >
                    <UploadIcon />
                    Upload
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false)
                      refreshSync()
                    }}
                    className="flex w-full items-center gap-2 px-4 py-3 text-sm text-zinc-200 transition hover:bg-zinc-900"
                  >
                    <RefreshIcon />
                    Refresh
                  </button>
                  <Link
                    to="/settings"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-3 text-sm text-zinc-200 transition hover:bg-zinc-900"
                  >
                    <SettingsIcon />
                    Settings
                  </Link>
                </div>
              )}
            </div>
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
                servers={continueComic.coverServers}
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

        {ownComics.length === 0 && queuedDrafts.length === 0 && savedATags.length === 0 ? (
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
          <>
            {ownComics.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">My Comics</p>
                  <p className="text-xs text-zinc-600">{ownComics.length} total</p>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {ownComics.map((comic) => (
                    <Link
                      key={comic.dTag}
                      to={`/comic/${comic.dTag}`}
                      className="group flex flex-col gap-2 rounded-2xl transition hover:-translate-y-0.5"
                    >
                      <CoverImage
                        comic={comic}
                        size="grid"
                        server={comic.coverServer || comic.blossomServer || primaryServer()}
                        servers={comic.coverServers}
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
            {savedEntries.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Saved</p>
                  <p className="text-xs text-zinc-600">{savedEntries.length} saved</p>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {savedEntries.map((entry) => (
                    <SavedComicCard
                      key={entry.aTag}
                      entry={entry}
                      eventStore={eventStore}
                      primaryServer={primaryServer()}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
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
  servers,
}: {
  comic: Comic
  size: 'hero' | 'grid'
  server: string | undefined
  servers?: string[]
}) {
  const className =
    size === 'hero'
      ? 'aspect-[2/3] w-full max-w-[120px] rounded-2xl object-cover shadow-lg shadow-black/20 sm:max-w-none'
      : 'aspect-[2/3] w-full rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'

  if (!comic.coverHash) {
    return <div className={className} />
  }

  return (
      <BlossomImage
        hash={comic.coverHash}
        server={server}
        servers={servers}
        torrent={comic.coverTorrent}
        alt={comic.title}
        loading="lazy"
        className={className}
      />
  )
}

function SavedComicCard({
  entry,
  eventStore,
  primaryServer,
}: {
  entry: SavedEntry
  eventStore: ReturnType<typeof useEventStore>
  primaryServer: string | undefined
}) {
  const savedComicFilter = useMemo(
    () => [{ kinds: [30040], authors: [entry.authorPubkey], '#d': [entry.dTag] }],
    [entry.authorPubkey, entry.dTag],
  )
  const savedComicTimeline$ = useMemo(
    () => eventStore.timeline(savedComicFilter),
    [eventStore, savedComicFilter],
  )
  const savedComicEvents = useObservableState(savedComicTimeline$) ?? EMPTY_EVENTS
  const foreignComic = useMemo(() => {
    for (const event of savedComicEvents) {
      const c = parseComicEvent(event, primaryServer)
      if (c) return c
    }
    return null
  }, [primaryServer, savedComicEvents])
  const resolvedComic = entry.comic ?? foreignComic
  const href = resolvedComic
    ? `/comic/${resolvedComic.dTag}?pubkey=${resolvedComic.pubkey}`
    : `/comic/${entry.dTag}?pubkey=${entry.authorPubkey}`

  return (
    <Link
      to={href}
      className="group flex flex-col gap-2 rounded-2xl transition hover:-translate-y-0.5"
    >
      {resolvedComic ? (
        <CoverImage
          comic={resolvedComic}
          size="grid"
          server={resolvedComic.coverServer || resolvedComic.blossomServer || primaryServer}
          servers={resolvedComic.coverServers}
        />
      ) : (
        <div className="flex aspect-[2/3] w-full items-end rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3 shadow-lg shadow-black/20">
          <div className="space-y-2">
            <div className="h-2 w-16 rounded-full bg-zinc-800" />
            <div className="h-3 w-24 rounded-full bg-zinc-700/80" />
            <div className="h-2 w-20 rounded-full bg-zinc-800" />
          </div>
        </div>
      )}
      <div className="px-0.5">
        <p className="text-sm font-medium leading-5 text-zinc-100 group-hover:text-white">
          {resolvedComic?.title ?? entry.dTag}
        </p>
        {!resolvedComic ? (
          <p className="mt-1 text-xs text-zinc-500">Loading from library sync…</p>
        ) : null}
      </div>
    </Link>
  )
}
