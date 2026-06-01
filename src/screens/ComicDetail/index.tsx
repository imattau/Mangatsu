import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
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

function parsePageHashes(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === 'page')
    .map((tag) => {
      const raw = tag[1] ?? ''
      return raw.startsWith('blossom://') ? raw.slice('blossom://'.length) : raw
    })
    .filter(Boolean)
}

function parseChapterEvent(event: NostrEvent, comicDTag: string): Chapter | null {
  const dTag = parseTag(event, 'd')
  if (!dTag || !dTag.startsWith(`${comicDTag}/`)) return null

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    parentDTag: comicDTag,
    title: parseTag(event, 'title') || dTag,
    pageHashes: parsePageHashes(event),
    blossomServer: parseTag(event, 'blossom'),
    publishedAt: event.created_at ?? 0,
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

function chapterFilter(comicDTag: string) {
  return [{ kinds: [30403], '#d': [`${comicDTag}/`] }]
}

const EMPTY_EVENTS: NostrEvent[] = []

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function ComicDetailScreen() {
  const { dTag } = useParams<{ dTag: string }>()
  const { service } = useNostr()
  const eventStore = useEventStore()

  const comics = useComicStore((s) => s.comics)
  const setChapter = useComicStore((s) => s.setChapter)
  const chaptersForComic = useComicStore((s) => s.chaptersForComic)
  const progress = useReadStore((s) => s.progress)
  const primaryServer = useBlossomStore((s) => s.primaryServer)

  const comic: Comic | undefined = dTag ? comics[dTag] : undefined

  useEffect(() => {
    if (!dTag) return
    const sub = service.subscribeToChapters(dTag)
    return () => sub.unsubscribe()
  }, [dTag, service])

  const chapterTimeline$ = useMemo(
    () => (dTag ? eventStore.timeline(chapterFilter(dTag)) : of([])),
    [eventStore, dTag],
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
    return chaptersForComic(dTag).slice().sort(
      (a, b) => chapterNumber(a.dTag) - chapterNumber(b.dTag),
    )
  }, [chaptersForComic, dTag])

  const server = comic?.blossomServer || primaryServer()

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
  const url = coverUrl(hash, server)
  const className =
    'aspect-[2/3] w-20 flex-shrink-0 rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'

  if (!url) return <div className={className} />
  return <img src={url} alt={title} loading="lazy" className={className} />
}
