import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  EllipsisVertical,
  LibraryBig,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { ZapButton } from '@/components/ZapButton'
import { useComicStore } from '@/stores/comicStore'
import { useReadStore } from '@/stores/readStore'
import { useBlossomStore } from '@/stores/blossomStore'
import type { Chapter, Comic } from '@/types'
import { BlossomImage } from '@/components/BlossomImage'
import {
  collectComicBlossomAssets,
  groupBlossomAssetsByServer,
  probeBlossomAssetExists,
} from '@/lib/blossom'
import { parseChapterEvent, parseComicEvent } from '@/lib/comic'
import { ComicCommentsSection } from '@/components/ComicComments'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  areTargetsCached,
  cacheTargetsForOffline,
  comicOfflineTargets,
  removeTargetsFromOfflineCache,
} from '@/lib/offline'

function chapterNumber(dTag: string): number {
  const match = dTag.match(/(\d+(?:\.\d+)?)$/)
  return match ? parseFloat(match[1]) : 0
}

function chapterLabel(dTag: string): string {
  const num = chapterNumber(dTag)
  return num > 0 ? `Chapter ${num}` : dTag.split('/').pop() ?? dTag
}

function comicDeleteTags(comic: Comic, chapters: Chapter[]): string[][] {
  const tags: string[][] = [
    ['a', `30040:${comic.pubkey}:${comic.dTag}`],
  ]

  const kinds = new Set(['30040'])
  for (const chapter of chapters) {
    tags.push(['a', `30041:${chapter.pubkey}:${chapter.dTag}`])
    kinds.add('30041')
  }

  for (const kind of kinds) {
    tags.push(['k', kind])
  }

  return tags
}

function chapterDeleteTags(chapter: Chapter): string[][] {
  return [
    ['a', `30041:${chapter.pubkey}:${chapter.dTag}`],
    ['k', '30041'],
  ]
}

const EMPTY_EVENTS: NostrEvent[] = []

interface ServerAvailability {
  status: 'checking' | 'available' | 'partial' | 'missing'
  total: number
  ok: number
}

type OfflineState = 'checking' | 'available' | 'missing' | 'downloading' | 'removing' | 'error'

type PendingDelete = { kind: 'comic' } | { kind: 'chapter'; chapter: Chapter } | null

const AVAILABILITY_BADGE: Record<ServerAvailability['status'], { label: string; className: string }> = {
  checking: { label: 'Checking', className: 'text-muted-foreground' },
  available: { label: 'Available', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  partial: { label: 'Partial', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  missing: { label: 'Missing', className: 'border-red-500/30 bg-red-500/10 text-red-300' },
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function ComicDetailScreen() {
  const { dTag } = useParams<{ dTag: string }>()
  const [searchParams] = useSearchParams()
  const foreignPubkey = searchParams.get('pubkey')
  const navigate = useNavigate()

  const { service, syncGeneration } = useNostr()
  const eventStore = useEventStore()

  const myPubkey = useAuthStore((s) => s.pubkey)
  const secretKey = useAuthStore((s) => s.secretKey)
  const setLibrary = useLibraryStore((s) => s.setAll)
  const addToLibrary = useLibraryStore((s) => s.add)
  const removeFromLibrary = useLibraryStore((s) => s.remove)
  const isInLibrary = useLibraryStore((s) => s.isIn)
  const comics = useComicStore((s) => s.comics)
  const setComic = useComicStore((s) => s.setComic)
  const setChapter = useComicStore((s) => s.setChapter)
  const removeComic = useComicStore((s) => s.removeComic)
  const removeChapter = useComicStore((s) => s.removeChapter)
  const removeChaptersForComic = useComicStore((s) => s.removeChaptersForComic)
  const allChapters = useComicStore((s) => s.chapters)
  const deletedChapterDTags = useComicStore((s) => s.deletedChapterDTags)
  const progress = useReadStore((s) => s.progress)
  const removeProgressForComic = useReadStore((s) => s.removeProgressForComic)
  const removeProgressForChapter = useReadStore((s) => s.removeProgressForChapter)
  const primaryServer = useBlossomStore((s) => s.primaryServer)

  const [addedToLibrary, setAddedToLibrary] = useState(false)
  const [adding, setAdding] = useState(false)
  const [libraryError, setLibraryError] = useState('')

  // Comic from store (own or previously cached)
  const storedComic: Comic | undefined = dTag ? comics[dTag] : undefined
  const chapterAuthor = storedComic?.pubkey || foreignPubkey || ''

  // Subscribe to foreign comic if pubkey param is present
  useEffect(() => {
    if (!dTag || !foreignPubkey) return
    const sub = service.subscribeToForeignComic(foreignPubkey, dTag)
    return () => sub.unsubscribe()
  }, [dTag, foreignPubkey, service, syncGeneration])

  // Subscribe to chapters
  useEffect(() => {
    if (!dTag || !chapterAuthor) return
    const sub = service.subscribeToChapters(chapterAuthor, dTag)
    return () => sub.unsubscribe()
  }, [chapterAuthor, dTag, service, syncGeneration])

  // Live foreign comic event from eventStore
  const foreignComicFilter = useMemo(
    () =>
      dTag && foreignPubkey
        ? [{ kinds: [30040], authors: [foreignPubkey], '#d': [dTag] }]
        : null,
    [dTag, foreignPubkey],
  )
  const foreignTimeline$ = useMemo(
    () => (foreignComicFilter ? eventStore.timeline(foreignComicFilter) : of([])),
    [eventStore, foreignComicFilter],
  )
  const foreignEvents = useObservableState(foreignTimeline$) ?? EMPTY_EVENTS

  const foreignComic: Comic | null = useMemo(() => {
    for (const event of foreignEvents) {
      const c = parseComicEvent(event, primaryServer())
      if (c) return c
    }
    return null
  }, [foreignEvents, primaryServer])

  const comic: Comic | undefined = storedComic ?? foreignComic ?? undefined
  const comicEvent = useMemo(() => {
    if (!comic) return null
    return (
      eventStore.getEvent({ kind: 30040, pubkey: comic.pubkey, identifier: comic.dTag }) ??
      eventStore.getEvent(comic.eventId) ??
      null
    )
  }, [comic, eventStore, syncGeneration])

  useEffect(() => {
    if (comic) {
      setComic(comic)
    }
  }, [comic, setComic])

  // Chapter live events
  const chapterFilter = useMemo(
    () => (dTag && chapterAuthor ? [{ kinds: [30041], authors: [chapterAuthor] }] : null),
    [chapterAuthor, dTag],
  )
  const chapterTimeline$ = useMemo(
    () => (chapterFilter ? eventStore.timeline(chapterFilter) : of([])),
    [eventStore, chapterFilter],
  )
  const liveChapterEvents = useObservableState(chapterTimeline$) ?? EMPTY_EVENTS

  useEffect(() => {
    if (!dTag) return
    for (const event of liveChapterEvents) {
      const chapter = parseChapterEvent(event, dTag)
      if (chapter) setChapter(chapter)
    }
  }, [liveChapterEvents, dTag, setChapter])

  const chapters = useMemo(() => {
    if (!dTag) return []
    return Object.values(allChapters)
      .filter((c) => c.parentDTag === dTag && !deletedChapterDTags.has(c.dTag))
      .sort((a, b) => chapterNumber(a.dTag) - chapterNumber(b.dTag))
  }, [allChapters, deletedChapterDTags, dTag])
  const visibleTags = useMemo(
    () => Array.from(new Set((comic?.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    [comic?.tags],
  )

  const server = comic?.coverServer || comic?.blossomServer || primaryServer()
  const blossomServers = useMemo(() => {
    if (!comic) return []
    return groupBlossomAssetsByServer(collectComicBlossomAssets(comic, chapters))
  }, [chapters, comic])
  const [blossomAvailability, setBlossomAvailability] = useState<Record<string, ServerAvailability>>({})
  const offlineTargets = useMemo(() => comicOfflineTargets(comic, chapters), [chapters, comic])
  const offlineTargetsKey = useMemo(() => offlineTargets.map((target) => target.key).join('\n'), [offlineTargets])
  const [offlineState, setOfflineState] = useState<OfflineState>('checking')
  const [offlineProgress, setOfflineProgress] = useState({ done: 0, total: 0 })
  const [offlineError, setOfflineError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)

  useEffect(() => {
    let cancelled = false

    if (!comic || blossomServers.length === 0) {
      setBlossomAvailability({})
      return () => {
        cancelled = true
      }
    }

    setBlossomAvailability(
      Object.fromEntries(
        blossomServers.map((entry) => [
          entry.server,
          { status: 'checking', total: entry.assets.length, ok: 0 } satisfies ServerAvailability,
        ]),
      ),
    )

    async function run() {
      for (const entry of blossomServers) {
        let ok = 0
        for (const asset of entry.assets) {
          const reachable = await probeBlossomAssetExists(`${asset.server}/${asset.hash}`)
          if (cancelled) return
          if (reachable) ok += 1
        }

        if (cancelled) return
        setBlossomAvailability((current) => ({
          ...current,
          [entry.server]: {
            status: ok === entry.assets.length ? 'available' : ok > 0 ? 'partial' : 'missing',
            total: entry.assets.length,
            ok,
          },
        }))
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [blossomServers, comic])

  useEffect(() => {
    let cancelled = false

    async function checkOfflineState() {
      if (!comic || offlineTargets.length === 0) {
        setOfflineState('missing')
        setOfflineProgress({ done: 0, total: 0 })
        setOfflineError('')
        return
      }

      setOfflineState('checking')
      const available = await areTargetsCached(offlineTargets)
      if (cancelled) return

      setOfflineState(available ? 'available' : 'missing')
      setOfflineProgress({ done: 0, total: offlineTargets.length })
      setOfflineError('')
    }

    void checkOfflineState()

    return () => {
      cancelled = true
    }
  }, [comic, offlineTargetsKey])

  async function handleOfflineToggle() {
    if (!comic || offlineTargets.length === 0) {
      return
    }

    setOfflineError('')

    try {
      if (offlineState === 'available') {
        setOfflineState('removing')
        await removeTargetsFromOfflineCache(offlineTargets)
        setOfflineState('missing')
        setOfflineProgress({ done: 0, total: offlineTargets.length })
        return
      }

      setOfflineState('downloading')
      setOfflineProgress({ done: 0, total: offlineTargets.length })
      await cacheTargetsForOffline(offlineTargets, (done, total) => {
        setOfflineProgress({ done, total })
      })
      setOfflineState('available')
    } catch (err) {
      setOfflineState('error')
      setOfflineError(err instanceof Error ? err.message : String(err))
    }
  }

  const allBlossomAssetsReachable =
    blossomServers.length > 0 &&
    blossomServers.every((entry) => blossomAvailability[entry.server]?.status === 'available')
  const isCheckingBlossomAssets =
    blossomServers.length > 0 &&
    blossomServers.some((entry) => !blossomAvailability[entry.server] || blossomAvailability[entry.server]?.status === 'checking')

  const isForeign = foreignPubkey !== null && foreignPubkey !== myPubkey

  const comicATag = comic ? `30040:${comic.pubkey}:${comic.dTag}` : ''
  const saved = comicATag ? isInLibrary(comicATag) : false

  async function updateLibraryEntry(saving: boolean) {
    if (!comic || !myPubkey || !comicATag) return
    setLibraryError('')
    if (saving) addToLibrary(comicATag)
    else removeFromLibrary(comicATag)
    try {
      setLibrary(await service.setLibraryEntry(comicATag, saving, { secretKey: secretKey ?? undefined }))
    } catch (err) {
      // Undo the optimistic change so the button reflects the list on relays.
      if (saving) removeFromLibrary(comicATag)
      else addToLibrary(comicATag)
      setLibraryError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDeleteComic() {
    if (!comic || !dTag) return

    if (saved && comicATag) {
      removeFromLibrary(comicATag)
    }

    removeComic(comic.dTag)
    void service.comicIndex?.removeComic(comic.pubkey, comic.dTag)
    removeChaptersForComic(comic.dTag)
    removeProgressForComic(comic.dTag)
    navigate('/')

    if (saved && myPubkey && comicATag) {
      service
        .setLibraryEntry(comicATag, false, { secretKey: secretKey ?? undefined })
        .then(setLibrary)
        .catch(() => {
          // Local removal is done; the entry stays in the list on relays until the next edit succeeds.
        })
    }

    try {
      const template = {
        kind: 5 as const,
        content: `Deleted from Mangatsu: ${comic.title}`,
        tags: comicDeleteTags(comic, chapters),
      }
      const signed = await service.eventFactory.build(template)
      if (signed) {
        await service.publishEvent(signed as NostrEvent)
      }
    } catch {
      // Deletion event failed to publish — local removal already done
    }
  }

  async function handleDeleteChapter(chapter: Chapter) {
    removeChapter(chapter.dTag)
    removeProgressForChapter(chapter.dTag)

    try {
      const deleteEvent = await service.eventFactory.build({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: chapterDeleteTags(chapter),
        content: `Deleted chapter ${chapter.dTag} from Mangatsu`,
      })
      if (deleteEvent) {
        await service.publishEvent(deleteEvent as NostrEvent)
      }
    } catch {
      // Deletion event failed to publish — local removal already done
    }
  }

  async function handleAddToLibrary() {
    if (!comic || !dTag) return
    setAdding(true)
    try {
      const tags: string[][] = [
        ['d', comic.dTag],
        ['title', comic.title],
      ]
      if (comic.author) tags.push(['author', comic.author])
      if (comic.authorPubkey) tags.push(['author_pubkey', comic.authorPubkey])
      if (comic.description) tags.push(['description', comic.description])
      if (comic.coverHash) {
        tags.push(['cover', comic.coverHash, comic.coverServer || comic.blossomServer || primaryServer() || ''])
      }
      if (comic.blossomServer) tags.push(['blossom', comic.blossomServer])
      for (const tag of comic.tags) {
        tags.push(['t', tag])
      }

      const template = { kind: 30040 as const, tags, content: '' }
      const signed = await service.eventFactory.build(template)
      if (signed) {
        await service.publishEvent(signed as NostrEvent)
        setComic(comic)
        setAddedToLibrary(true)
      }
    } finally {
      setAdding(false)
    }
  }

  function confirmPendingDelete() {
    const target = pendingDelete
    setPendingDelete(null)
    if (target?.kind === 'comic') void handleDeleteComic()
    if (target?.kind === 'chapter') void handleDeleteChapter(target.chapter)
  }

  const isOwner = Boolean(comic && comic.pubkey === myPubkey)
  const offlineBusy = offlineState === 'checking' || offlineState === 'downloading' || offlineState === 'removing'
  const offlineLabel =
    offlineState === 'available'
      ? 'Remove offline'
      : offlineState === 'downloading'
        ? `Caching ${offlineProgress.done}/${offlineProgress.total}`
        : offlineState === 'removing'
          ? 'Removing…'
          : offlineState === 'checking'
            ? 'Checking…'
            : 'Make offline'
  const blossomSummary = isCheckingBlossomAssets
    ? AVAILABILITY_BADGE.checking
    : allBlossomAssetsReachable
      ? AVAILABILITY_BADGE.available
      : { ...AVAILABILITY_BADGE.partial, label: 'Incomplete' }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6">
        <div className="flex items-start justify-between gap-3">
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link to="/">
              <ChevronLeft data-icon="inline-start" />
              Library
            </Link>
          </Button>

          {comic && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  className="size-10 rounded-full"
                  aria-label="Open actions menu"
                >
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56" aria-label="Comic actions">
                {isOwner && (
                  <DropdownMenuItem asChild>
                    <Link to={`/comic/${comic.dTag}/edit`}>
                      <Pencil />
                      Edit details
                    </Link>
                  </DropdownMenuItem>
                )}
                {isOwner && (
                  <DropdownMenuItem asChild>
                    <Link to={`/comic/${comic.dTag}/upload`}>
                      <Plus />
                      Add chapter
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={offlineBusy} onSelect={() => void handleOfflineToggle()}>
                  <Download />
                  {offlineLabel}
                </DropdownMenuItem>
                {isOwner && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete({ kind: 'comic' })}>
                      <Trash2 />
                      Delete comic
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {comic ? (
          <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:gap-5">
            <CoverImage
              hash={comic.coverHash}
              server={server}
              servers={comic.coverServers}
              torrent={comic.coverTorrent}
              title={comic.title}
            />
            <div className="w-full min-w-0 sm:flex-1">
              <p className="text-[0.65rem] uppercase tracking-[0.45em] text-muted-foreground">
                {comic.author || 'Unknown author'}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight leading-tight">
                {comic.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {chapters.length} chapter{chapters.length !== 1 ? 's' : ''}
              </p>
              {comic.description && (
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{comic.description}</p>
              )}
              {visibleTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {visibleTags.map((tag) => (
                    <Badge key={tag} asChild variant="outline" className="h-7 rounded-full px-3">
                      <Link to={`/feed?tag=${encodeURIComponent(tag)}`}>#{tag}</Link>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2 flex-wrap">
                {isForeign && !addedToLibrary && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={() => void handleAddToLibrary()}
                    disabled={adding}
                    aria-label="Add to library"
                    className="h-10 rounded-full px-3 sm:px-4"
                  >
                    <LibraryBig />
                    <span className="hidden sm:inline">{adding ? 'Adding…' : 'Add to Library'}</span>
                  </Button>
                )}
                {(() => {
                  const targetPubkey = comic.authorPubkey || comic.pubkey
                  return targetPubkey && targetPubkey !== myPubkey ? (
                    <ZapButton authorPubkey={targetPubkey} />
                  ) : null
                })()}
                {isForeign && myPubkey && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={() => void updateLibraryEntry(!saved)}
                    aria-label={saved ? 'Unsave comic' : 'Save comic'}
                    aria-pressed={saved}
                    className="h-10 rounded-full px-3 sm:px-4"
                  >
                    {saved ? <BookmarkCheck /> : <Bookmark />}
                    <span className="hidden sm:inline">{saved ? 'Unsave' : 'Save'}</span>
                  </Button>
                )}
              </div>
              {addedToLibrary && (
                <p className="mt-3 text-sm text-emerald-400">Added to your library</p>
              )}
              {libraryError && (
                <p role="alert" className="mt-3 text-sm text-destructive">{libraryError}</p>
              )}
              {offlineError && (
                <p className="mt-3 text-sm text-destructive">{offlineError}</p>
              )}
              {!offlineError && offlineState === 'available' && (
                <p className="mt-3 text-sm text-emerald-400">Available offline</p>
              )}
              {!offlineError && offlineState === 'missing' && offlineTargets.length > 0 && (
                <p className="mt-3 text-sm text-muted-foreground">Not cached for offline reading</p>
              )}
            </div>
          </header>
        ) : (
          <header aria-busy="true" aria-label="Loading comic" className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:gap-5">
            <Skeleton className="aspect-[2/3] w-28 rounded-2xl sm:w-32" />
            <div className="flex w-full flex-col gap-2 sm:flex-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-20" />
            </div>
          </header>
        )}

        {chapters.length === 0 ? (
          <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[2rem] border border-dashed bg-card/40 px-6 text-center">
            <p className="text-lg font-medium">No chapters yet</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Chapters will appear here once your relays sync this comic.
            </p>
          </section>
        ) : (
          <section className="space-y-2">
            <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Chapters</p>
            <ul className="flex flex-col gap-2">
              {chapters.map((chapter) => {
                const chapterProgress = progress[chapter.dTag]
                return (
                  <li key={chapter.dTag}>
                    <div className="flex items-center gap-2 rounded-2xl border bg-card/60 px-4 py-3 transition-colors hover:bg-muted/60">
                      <Link
                        to={`/comic/${dTag}/chapter/${encodeURIComponent(chapter.dTag)}`}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">{chapterLabel(chapter.dTag)}</p>
                          <p className="mt-0.5 truncate text-sm font-medium">
                            {chapter.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground/70">
                            {chapter.pageHashes.length} page{chapter.pageHashes.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {chapterProgress && (
                            <Badge className="border-indigo-500/40 bg-indigo-500/20 text-indigo-300">
                              Continue
                            </Badge>
                          )}
                          <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground/70" />
                        </div>
                      </Link>
                      {isOwner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-lg"
                              className="size-10 shrink-0 rounded-full"
                              aria-label={`Open chapter actions for ${chapter.title}`}
                            >
                              <EllipsisVertical />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48" aria-label={`Chapter actions for ${chapter.title}`}>
                            <DropdownMenuItem asChild>
                              <Link to={`/comic/${dTag}/chapter/${encodeURIComponent(chapter.dTag)}/edit`}>
                                <Pencil />
                                Edit chapter
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setPendingDelete({ kind: 'chapter', chapter })}
                            >
                              <Trash2 />
                              Delete chapter
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {blossomServers.length > 0 && (
          <details className="rounded-2xl border bg-card/70 p-4">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                  Blossom servers
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {isCheckingBlossomAssets
                    ? 'Probing declared comic assets for reachability.'
                    : allBlossomAssetsReachable
                      ? 'All declared comic assets are reachable.'
                      : 'Some declared comic assets are missing or partial.'}
                </p>
              </div>
              <Badge variant="outline" className={cn('h-6 px-2.5', blossomSummary.className)}>
                {blossomSummary.label}
              </Badge>
            </summary>
            <ul className="mt-3 space-y-2">
              {blossomServers.map((entry) => {
                const availability = blossomAvailability[entry.server]
                const badge = AVAILABILITY_BADGE[availability?.status ?? 'checking']
                return (
                  <li
                    key={entry.server}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/70 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{entry.server}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {availability
                          ? `${availability.ok}/${availability.total} assets reachable`
                          : `${entry.assets.length} assets queued for check`}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn('h-6 px-2.5', badge.className)}>
                      {badge.label}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          </details>
        )}

        {comic && (
          <ComicCommentsSection comic={comic} comicEvent={comicEvent} />
        )}
      </div>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === 'chapter'
                ? `Delete "${pendingDelete.chapter.title}"?`
                : `Delete "${comic?.title ?? 'this comic'}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === 'chapter'
                ? 'This publishes a Nostr deletion request for this chapter.'
                : 'This publishes a Nostr deletion request for the comic and all of its chapters.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmPendingDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CoverImage({
  hash,
  server,
  servers,
  torrent,
  title,
}: {
  hash: string
  server: string | undefined
  servers?: string[]
  torrent?: string
  title: string
}) {
  const className =
    'aspect-[2/3] w-28 flex-shrink-0 rounded-2xl object-cover bg-muted shadow-lg shadow-black/20 sm:w-32'
  if (!hash) return <div className={className} />
  return (
    <BlossomImage
      hash={hash}
      server={server}
      servers={servers}
      torrent={torrent}
      alt={title}
      loading="lazy"
      className={className}
    />
  )
}
