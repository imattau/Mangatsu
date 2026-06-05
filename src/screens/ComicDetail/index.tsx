import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
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
import { ComicCommentsSection } from '@/components/ComicComments'
import {
  areTargetsCached,
  cacheTargetsForOffline,
  comicOfflineTargets,
  removeTargetsFromOfflineCache,
} from '@/lib/offline'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTag(event: NostrEvent, name: string): string {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

function parseTagTail(event: NostrEvent, name: string, startIndex: number): string[] {
  const tag = event.tags.find((entry) => entry[0] === name)
  return tag ? tag.slice(startIndex).filter(Boolean) : []
}

function parseAnyTag(event: NostrEvent, names: string[]): string {
  for (const name of names) {
    const value = parseTag(event, name)
    if (value) return value
  }
  return ''
}

function parsePageUploads(event: NostrEvent): Array<{ hash: string; server: string }> {
  return event.tags
    .filter((tag) => tag[0] === 'page')
    .map((tag) => {
      const raw = tag[1] ?? ''
      const hash = raw.startsWith('blossom://') ? raw.slice('blossom://'.length) : raw
      return { hash, server: tag[2] ?? '' }
    })
    .filter((upload) => upload.hash.length > 0)
}

function parseChapterEvent(event: NostrEvent, comicDTag: string): Chapter | null {
  const dTag = parseTag(event, 'd')
  if (!dTag || !dTag.startsWith(`${comicDTag}/`)) return null
  const pageUploads = parsePageUploads(event)
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    parentDTag: comicDTag,
    title: parseTag(event, 'title') || dTag,
    pageHashes: pageUploads.map((upload) => upload.hash),
    pageServers: pageUploads.map((upload) => upload.server),
    pageServerLists: event.tags
      .filter((tag) => tag[0] === 'page')
      .map((tag) => tag.slice(2).filter(Boolean)),
    blossomServer: parseTag(event, 'blossom') || pageUploads[0]?.server || '',
    publishedAt: event.created_at ?? 0,
    eventId: event.id,
  }
}

function parseComicEvent(event: NostrEvent, server: string | undefined): Comic | null {
  const dTag = parseTag(event, 'd')
  if (!dTag) return null
  const coverHash = parseAnyTag(event, ['cover', 'cover_hash', 'image'])
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
    coverHash,
    coverServer,
    coverServers,
    blossomServer: parseAnyTag(event, ['blossom', 'blossom_server']) || coverServer || server || '',
    tags: event.tags.filter((t) => t[0] === 't').map((t) => t[1]).filter(Boolean),
    eventId: event.id,
  }
}

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
  const savedATags = useLibraryStore((s) => s.savedATags)
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
  const [deletingChapterDTag, setDeletingChapterDTag] = useState('')

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

  async function handleSave() {
    if (!comic || !myPubkey || !comicATag) return
    addToLibrary(comicATag)
    try {
      await service.publishLibraryList(
        [...savedATags, comicATag],
        { secretKey: secretKey ?? undefined, pubkey: myPubkey },
      )
    } catch {
      // fire-and-forget
    }
  }

  async function handleUnsave() {
    if (!comic || !myPubkey || !comicATag) return
    removeFromLibrary(comicATag)
    try {
      await service.publishLibraryList(
        savedATags.filter((t) => t !== comicATag),
        { secretKey: secretKey ?? undefined, pubkey: myPubkey },
      )
    } catch {
      // fire-and-forget
    }
  }

  async function handleDeleteComic() {
    if (!comic || !dTag) return
    const confirmed = window.confirm(
      `Delete "${comic.title}"? This will publish a Nostr deletion request for the comic and its chapters.`,
    )
    if (!confirmed) return

    const nextSavedATags = comicATag ? savedATags.filter((tag) => tag !== comicATag) : savedATags
    if (saved && comicATag) {
      removeFromLibrary(comicATag)
    }

    removeComic(comic.dTag)
    removeChaptersForComic(comic.dTag)
    removeProgressForComic(comic.dTag)
    navigate('/')

    try {
      if (saved && myPubkey) {
        await service.publishLibraryList(
          nextSavedATags,
          { secretKey: secretKey ?? undefined, pubkey: myPubkey },
        )
      }

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
    const confirmDelete = window.confirm(`Delete chapter "${chapter.title}"?`)
    if (!confirmDelete) return

    setDeletingChapterDTag(chapter.dTag)
    removeChapter(chapter.dTag)
    removeProgressForChapter(chapter.dTag)
    setDeletingChapterDTag('')

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

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 py-4 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6">

        <Link
          to="/"
          className="self-start rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-white"
        >
          ← Library
        </Link>

        {comic ? (
          <header className="flex gap-4 items-end">
              <CoverImage
                hash={comic.coverHash}
                server={server}
                servers={comic.coverServers}
                title={comic.title}
              />
            <div className="flex-1 min-w-0">
              <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">
                {comic.author || 'Unknown author'}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight leading-tight">
                {comic.title}
              </h1>
              <p className="mt-1 text-sm text-zinc-400">
                {chapters.length} chapter{chapters.length !== 1 ? 's' : ''}
              </p>
              {visibleTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {visibleTags.map((tag) => (
                    <Link
                      key={tag}
                      to={`/feed?tag=${encodeURIComponent(tag)}`}
                      className="rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2 flex-wrap">
                {isForeign && !addedToLibrary && (
                  <button
                    onClick={() => void handleAddToLibrary()}
                    disabled={adding}
                    aria-label="Add to library"
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50 sm:px-4"
                  >
                    <LibraryPlusIcon />
                    <span className="hidden sm:inline">{adding ? 'Adding…' : 'Add to Library'}</span>
                  </button>
                )}
                {comic.pubkey && comic.pubkey !== myPubkey && (
                  <ZapButton authorPubkey={comic.pubkey} />
                )}
                {isForeign && myPubkey && (
                  <button
                    type="button"
                    onClick={() => void (saved ? handleUnsave() : handleSave())}
                    aria-label={saved ? 'Unsave comic' : 'Save comic'}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white sm:px-4"
                  >
                    <BookmarkIcon filled={saved} />
                    <span className="hidden sm:inline">{saved ? 'Unsave' : 'Save'}</span>
                  </button>
                )}
                {comic.pubkey === myPubkey && (
                  <Link
                    to={`/comic/${comic.dTag}/edit`}
                    aria-label="Edit details"
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white sm:px-4"
                  >
                    <PencilIcon />
                    <span className="hidden sm:inline">Edit details</span>
                  </Link>
                )}
                {comic && (
                  <button
                    type="button"
                    onClick={() => void handleOfflineToggle()}
                    disabled={offlineState === 'checking' || offlineState === 'downloading' || offlineState === 'removing'}
                    aria-label={offlineState === 'available' ? 'Remove offline comic' : 'Make comic available offline'}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
                  >
                    <OfflineIcon />
              <span className="hidden sm:inline">
                      {offlineState === 'available'
                        ? 'Remove offline'
                        : offlineState === 'downloading'
                          ? `Caching ${offlineProgress.done}/${offlineProgress.total}`
                          : offlineState === 'removing'
                            ? 'Removing…'
                            : offlineState === 'checking'
                              ? 'Checking…'
                              : 'Make offline'}
                    </span>
                  </button>
                )}
                {comic.pubkey === myPubkey && (
                  <Link
                    to={`/comic/${comic.dTag}/upload`}
                    aria-label="Add chapter"
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white sm:px-4"
                  >
                    <PlusIcon />
                    <span className="hidden sm:inline">Add chapter</span>
                  </Link>
                )}
                {comic.pubkey === myPubkey && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteComic()}
                    className="inline-flex items-center gap-2 rounded-full border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300 transition hover:border-red-700 hover:text-red-200 sm:px-4"
                    aria-label="Delete comic"
                  >
                    <TrashIcon />
                    <span className="hidden sm:inline">Delete</span>
                  </button>
                )}
              </div>
              {addedToLibrary && (
                <p className="mt-3 text-sm text-emerald-400">Added to your library</p>
              )}
              {offlineError && (
                <p className="mt-3 text-sm text-red-400">{offlineError}</p>
              )}
              {!offlineError && offlineState === 'available' && (
                <p className="mt-3 text-sm text-emerald-400">Available offline</p>
              )}
              {!offlineError && offlineState === 'missing' && offlineTargets.length > 0 && (
                <p className="mt-3 text-sm text-zinc-500">Not cached for offline reading</p>
              )}
            </div>
          </header>
        ) : (
          <header>
            <div className="h-6 w-40 rounded bg-zinc-800 animate-pulse" />
          </header>
        )}

        {blossomServers.length > 0 && (
          <details className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
                  Blossom servers
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  {isCheckingBlossomAssets
                    ? 'Probing declared comic assets for reachability.'
                    : allBlossomAssetsReachable
                      ? 'All declared comic assets are reachable.'
                      : 'Some declared comic assets are missing or partial.'}
                </p>
              </div>
              <div
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  isCheckingBlossomAssets
                    ? 'border-zinc-700 bg-zinc-900/80 text-zinc-400'
                    : allBlossomAssetsReachable
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                }`}
              >
                {isCheckingBlossomAssets ? 'Checking' : allBlossomAssetsReachable ? 'Available' : 'Incomplete'}
              </div>
            </summary>
            <ul className="mt-3 space-y-2">
              {blossomServers.map((entry) => {
                const availability = blossomAvailability[entry.server]
                const ready = availability?.status ?? 'checking'
                return (
                  <li
                    key={entry.server}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-100">{entry.server}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {availability
                          ? `${availability.ok}/${availability.total} assets reachable`
                          : `${entry.assets.length} assets queued for check`}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                        ready === 'available'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : ready === 'partial'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                            : ready === 'missing'
                              ? 'border-red-500/30 bg-red-500/10 text-red-300'
                              : 'border-zinc-700 bg-zinc-900/80 text-zinc-400'
                      }`}
                    >
                      {ready === 'available'
                        ? 'Available'
                        : ready === 'partial'
                          ? 'Partial'
                          : ready === 'missing'
                            ? 'Missing'
                            : 'Checking'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </details>
        )}

        {chapters.length === 0 ? (
          <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
            <p className="text-lg font-medium text-zinc-100">No chapters yet</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
              Chapters will appear here once your relays sync this comic.
            </p>
          </section>
        ) : (
          <section className="space-y-2">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Chapters</p>
            <ul className="flex flex-col gap-2">
              {chapters.map((chapter) => {
                const chapterProgress = progress[chapter.dTag]
                const deleting = deletingChapterDTag === chapter.dTag
                const canEditOrDelete = comic?.pubkey === myPubkey
                return (
                  <li key={chapter.dTag}>
                    <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 transition hover:border-zinc-600 hover:bg-zinc-900/80">
                      <Link
                        to={`/comic/${dTag}/chapter/${encodeURIComponent(chapter.dTag)}`}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-zinc-500">{chapterLabel(chapter.dTag)}</p>
                          <p className="mt-0.5 truncate text-sm font-medium text-zinc-100">
                            {chapter.title}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-600">
                            {chapter.pageHashes.length} page{chapter.pageHashes.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {chapterProgress && (
                            <span className="rounded-full border border-indigo-500/40 bg-indigo-500/20 px-2.5 py-1 text-xs font-medium text-indigo-300">
                              Continue
                            </span>
                          )}
                          <svg
                            className="h-4 w-4 text-zinc-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>
                      </Link>
                      {canEditOrDelete && (
                        <div className="flex flex-shrink-0 items-center gap-2">
                          <Link
                            to={`/comic/${dTag}/chapter/${encodeURIComponent(chapter.dTag)}/edit`}
                            aria-label={`Edit chapter ${chapter.title}`}
                            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white sm:px-4"
                          >
                            <PencilIcon />
                            <span className="hidden sm:inline">Edit</span>
                          </Link>
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={() => void handleDeleteChapter(chapter)}
                            aria-label={`Delete chapter ${chapter.title}`}
                            className="inline-flex items-center gap-2 rounded-full border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300 transition hover:border-red-700 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
                          >
                            <TrashIcon />
                            <span className="hidden sm:inline">{deleting ? 'Deleting…' : 'Delete'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {comic && (
          <ComicCommentsSection comic={comic} comicEvent={comicEvent} />
        )}
      </div>
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
  title,
}: {
  hash: string
  server: string | undefined
  servers?: string[]
  title: string
}) {
  const className =
    'aspect-[2/3] w-20 flex-shrink-0 rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'
  if (!hash) return <div className={className} />
  return (
    <BlossomImage
      hash={hash}
      server={server}
      servers={servers}
      alt={title}
      loading="lazy"
      className={className}
    />
  )
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function OfflineIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

function LibraryPlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M4 6h10" />
      <path d="M4 10h10" />
      <path d="M4 14h6" />
      <path d="M16 12v6" />
      <path d="M13 15h6" />
    </svg>
  )
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M6 3.75A2.75 2.75 0 0 1 8.75 1h6.5A2.75 2.75 0 0 1 18 3.75V21a.75.75 0 0 1-1.2.6L12 17.25 7.2 21.6A.75.75 0 0 1 6 21V3.75Z" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" />
    </svg>
  )
}
