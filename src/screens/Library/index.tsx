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
import { parseComicEvent } from '@/lib/comic'
import { Menu, RefreshCw, Settings, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const COMIC_FILTER = (pubkey: string) => [{ kinds: [30040], authors: [pubkey] }]
const EMPTY_EVENTS: NostrEvent[] = []

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
      allComics.find((comic) => latestProgress.chapterDTag.startsWith(`${comic.dTag}/`)) ?? null
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

  const relayLabel = relayOnline ? `${onlineCount} relay${onlineCount === 1 ? '' : 's'} online` : 'Offline cache'

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
            <BrandMark size="sm" showLabel={false} />
            <div className="min-w-0">
              <p className="text-[0.65rem] uppercase tracking-[0.45em] text-muted-foreground">Mangatsu</p>
              <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">Library</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <HeaderNav />
            <Button asChild size="lg" className="hidden h-9 rounded-full px-3 sm:inline-flex">
              <Link to="/upload" aria-label="Upload a comic">
                <Upload data-icon="inline-start" />
                Upload a comic
              </Link>
            </Button>
            <Badge
              variant="outline"
              title={relayLabel}
              aria-label={relayOnline ? `${onlineCount} relays online` : 'Offline cache'}
              className={cn(
                'h-9 gap-2 rounded-full px-3',
                relayOnline ? 'border-emerald-500/30 text-emerald-300' : 'border-rose-500/30 text-rose-300',
              )}
            >
              <span className={cn('size-2.5 rounded-full', relayOnline ? 'bg-emerald-400' : 'bg-rose-400')} />
              <span className="hidden sm:inline">{relayLabel}</span>
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={refreshSync}
              aria-label="Refresh relays"
              title="Refresh relays"
              className="hidden h-9 rounded-full px-3 sm:inline-flex"
            >
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
            <Button asChild variant="outline" size="lg" className="hidden h-9 rounded-full px-3 sm:inline-flex">
              <Link to="/settings" aria-label="Settings">
                <Settings data-icon="inline-start" />
                Settings
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  aria-label="Open menu"
                  className="size-10 rounded-full sm:hidden"
                >
                  <Menu />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem asChild>
                  <Link to="/upload">
                    <Upload />
                    Upload
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={refreshSync}>
                  <RefreshCw />
                  Refresh
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings />
                    Settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {queuedDrafts.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Queued for publish</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  These comics are saved locally and waiting for a successful relay publish.
                </p>
              </div>
              <p className="text-xs text-muted-foreground/70">{queuedDrafts.length} queued</p>
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
          <section className="overflow-hidden rounded-[2rem] border bg-card/90 shadow-2xl shadow-black/30">
            <div className="grid gap-4 p-4 sm:grid-cols-[120px_1fr_auto] sm:items-center sm:p-5">
              <CoverImage
                comic={continueComic}
                size="hero"
                server={continueComic.coverServer || continueComic.blossomServer || primaryServer()}
                servers={continueComic.coverServers}
              />
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                  Continue Reading
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  {continueComic.title}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {chapterLabel(latestProgress.chapterDTag)} · p.{latestProgress.page}
                </p>
              </div>
              <Button asChild size="lg" className="h-11 rounded-full px-5">
                <Link to={`/comic/${continueComic.dTag}/chapter/${encodeURIComponent(latestProgress.chapterDTag)}`}>
                  Continue
                </Link>
              </Button>
            </div>
          </section>
        ) : null}

        {ownComics.length === 0 && queuedDrafts.length === 0 && savedATags.length === 0 ? (
          <section className="flex min-h-[50vh] flex-col items-center justify-center rounded-[2rem] border border-dashed bg-card/40 px-6 text-center">
            <p className="text-lg font-medium">No comics yet</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Your library will appear here once your relays sync or you import comics locally.
            </p>
            <Button asChild variant="outline" size="lg" className="mt-6 h-10 rounded-full px-4">
              <Link to="/upload">
                <Upload data-icon="inline-start" />
                Upload a comic
              </Link>
            </Button>
          </section>
        ) : (
          <>
            {ownComics.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">My Comics</p>
                  <p className="text-xs text-muted-foreground/70">{ownComics.length} total</p>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {ownComics.map((comic) => (
                    <Link
                      key={comic.dTag}
                      to={`/comic/${comic.dTag}`}
                      className="group flex flex-col gap-2 rounded-2xl outline-none transition hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <CoverImage
                        comic={comic}
                        size="grid"
                        server={comic.coverServer || comic.blossomServer || primaryServer()}
                        servers={comic.coverServers}
                      />
                      <div className="px-0.5">
                        <p className="text-sm font-medium leading-5">
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
                  <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Saved</p>
                  <p className="text-xs text-muted-foreground/70">{savedEntries.length} saved</p>
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
          <h3 className="mt-2 truncate text-lg font-semibold">{draft.title}</h3>
          <p className="mt-1 truncate text-sm text-muted-foreground">{draft.comicDTag}</p>
        </div>
        <Badge variant="outline" className="h-6 border-amber-800/50 bg-amber-950/60 px-2.5 text-amber-200">
          Retry pending
        </Badge>
      </div>

      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        {draft.lastError
          ? `Last publish error: ${draft.lastError}`
          : 'This comic is waiting for a relay acknowledgement. You can retry publish from here.'}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" size="lg" onClick={onRetry} disabled={retrying} className="h-9 rounded-full px-4">
          <RefreshCw data-icon="inline-start" className={cn(retrying && 'animate-spin')} />
          {retrying ? 'Retrying…' : 'Retry Publish'}
        </Button>
        <p className="text-xs text-muted-foreground">
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
      : 'aspect-[2/3] w-full rounded-2xl object-cover bg-muted shadow-lg shadow-black/20'

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
      className="group flex flex-col gap-2 rounded-2xl outline-none transition hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {resolvedComic ? (
        <CoverImage
          comic={resolvedComic}
          size="grid"
          server={resolvedComic.coverServer || resolvedComic.blossomServer || primaryServer}
          servers={resolvedComic.coverServers}
        />
      ) : (
        <Skeleton aria-hidden="true" className="aspect-[2/3] w-full rounded-2xl" />
      )}
      <div className="px-0.5">
        <p className="text-sm font-medium leading-5">
          {resolvedComic?.title ?? entry.dTag}
        </p>
        {!resolvedComic ? (
          <p className="mt-1 text-xs text-muted-foreground">Loading from library sync…</p>
        ) : null}
      </div>
    </Link>
  )
}
