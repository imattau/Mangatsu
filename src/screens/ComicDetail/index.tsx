import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { ZapButton } from '@/components/ZapButton'
import { useComicStore } from '@/stores/comicStore'
import { useReadStore } from '@/stores/readStore'
import { useBlossomStore } from '@/stores/blossomStore'
import type { Chapter, Comic } from '@/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTag(event: NostrEvent, name: string): string {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

function parseTagAt(event: NostrEvent, name: string, index: number): string {
  return event.tags.find((tag) => tag[0] === name)?.[index] ?? ''
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
    blossomServer: parseTag(event, 'blossom') || pageUploads[0]?.server || '',
    publishedAt: event.created_at ?? 0,
    eventId: event.id,
  }
}

function parseComicEvent(event: NostrEvent, server: string | undefined): Comic | null {
  const dTag = parseTag(event, 'd')
  if (!dTag) return null
  const coverHash = parseAnyTag(event, ['cover', 'cover_hash', 'image'])
  const coverServer = parseTagAt(event, 'cover', 2) || parseTagAt(event, 'image', 2) || ''
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: parseTag(event, 'title') || event.content || 'Untitled',
    author: parseTag(event, 'author'),
    description: parseTag(event, 'description') || event.content || '',
    coverHash,
    coverServer,
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

function coverUrl(hash: string, server: string | undefined): string | null {
  if (!hash || !server) return null
  return `${server.replace(/\/$/, '')}/blob/${hash}`
}

const EMPTY_EVENTS: NostrEvent[] = []

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function ComicDetailScreen() {
  const { dTag } = useParams<{ dTag: string }>()
  const [searchParams] = useSearchParams()
  const foreignPubkey = searchParams.get('pubkey')

  const { service, syncGeneration } = useNostr()
  const eventStore = useEventStore()

  const myPubkey = useAuthStore((s) => s.pubkey)
  const comics = useComicStore((s) => s.comics)
  const setComic = useComicStore((s) => s.setComic)
  const setChapter = useComicStore((s) => s.setChapter)
  const chaptersForComic = useComicStore((s) => s.chaptersForComic)
  const progress = useReadStore((s) => s.progress)
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
    return chaptersForComic(dTag)
      .slice()
      .sort((a, b) => chapterNumber(a.dTag) - chapterNumber(b.dTag))
  }, [chaptersForComic, dTag])

  const server = comic?.coverServer || comic?.blossomServer || primaryServer()

  const isForeign = foreignPubkey !== null && foreignPubkey !== myPubkey

  async function handleAddToLibrary() {
    if (!comic || !dTag) return
    setAdding(true)
    try {
      const tags: string[][] = [
        ['d', comic.dTag],
        ['title', comic.title],
      ]
      if (comic.author) tags.push(['author', comic.author])
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
              <CoverImage hash={comic.coverHash} server={server} title={comic.title} />
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
              <div className="mt-3 flex gap-2 flex-wrap">
                {isForeign && !addedToLibrary && (
                  <button
                    onClick={() => void handleAddToLibrary()}
                    disabled={adding}
                    className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
                  >
                    {adding ? 'Adding…' : 'Add to Library'}
                  </button>
                )}
                {comic.pubkey && comic.pubkey !== myPubkey && (
                  <ZapButton authorPubkey={comic.pubkey} />
                )}
              </div>
              {addedToLibrary && (
                <p className="mt-3 text-sm text-emerald-400">Added to your library</p>
              )}
            </div>
          </header>
        ) : (
          <header>
            <div className="h-6 w-40 rounded bg-zinc-800 animate-pulse" />
          </header>
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
                return (
                  <li key={chapter.dTag}>
                    <Link
                      to={`/comic/${dTag}/chapter/${encodeURIComponent(chapter.dTag)}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 transition hover:border-zinc-600 hover:bg-zinc-900/80"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-zinc-500">{chapterLabel(chapter.dTag)}</p>
                        <p className="mt-0.5 truncate text-sm font-medium text-zinc-100">
                          {chapter.title}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-600">
                          {chapter.pageHashes.length} page{chapter.pageHashes.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {chapterProgress && (
                          <span className="rounded-full bg-indigo-500/20 border border-indigo-500/40 px-2.5 py-1 text-xs font-medium text-indigo-300">
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
                  </li>
                )
              })}
            </ul>
          </section>
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
  title,
}: {
  hash: string
  server: string | undefined
  title: string
}) {
  const cachedUrl = useBlossomStore((state) => state.cachedHashes[hash] ?? '')
  const url = coverUrl(hash, server)
  const imageUrl = cachedUrl || url
  const className =
    'aspect-[2/3] w-20 flex-shrink-0 rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'
  if (!imageUrl) return <div className={className} />
  return <img src={imageUrl} alt={title} loading="lazy" className={className} />
}
