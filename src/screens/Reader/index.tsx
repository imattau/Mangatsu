import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useComicStore } from '@/stores/comicStore'
import { useReadStore } from '@/stores/readStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { usePageObserver } from './usePageObserver'
import { useProgressPublisher } from './useProgressPublisher'
import { usePagePreloader } from './usePagePreloader'
import { BlossomImage } from '@/components/BlossomImage'

function chapterNumber(dTag: string): number {
  const match = dTag.match(/(\d+(?:\.\d+)?)$/)
  return match ? parseFloat(match[1]) : 0
}

export function ReaderScreen() {
  const { dTag, chapterId } = useParams<{ dTag: string; chapterId: string }>()
  const chapterDTag = chapterId ? decodeURIComponent(chapterId) : ''

  const chaptersForComic = useComicStore((s) => s.chaptersForComic)
  const cachedHashes = useBlossomStore((s) => s.cachedHashes)
  const primaryServer = useBlossomStore((s) => s.primaryServer)
  const setProgress = useReadStore((s) => s.setProgress)
  const scrollContainerRef = useRef<HTMLElement | null>(null)

  const allChapters = useMemo(
    () =>
      dTag
        ? chaptersForComic(dTag)
            .slice()
            .sort((a, b) => chapterNumber(a.dTag) - chapterNumber(b.dTag))
        : [],
    [chaptersForComic, dTag],
  )

  const chapter = allChapters.find((c) => c.dTag === chapterDTag)
  const chapterIndex = allChapters.findIndex((c) => c.dTag === chapterDTag)
  const prevChapter = chapterIndex > 0 ? allChapters[chapterIndex - 1] : null
  const nextChapter =
    chapterIndex >= 0 && chapterIndex < allChapters.length - 1
      ? allChapters[chapterIndex + 1]
      : null

  const server = chapter?.blossomServer || primaryServer() || ''
  const pageUrls = useMemo(
    () =>
      chapter
        ? chapter.pageHashes.map((h, idx) => {
            const pageServerList = chapter.pageServerLists?.[idx] ?? []
            const pageServer = chapter.pageServers?.[idx] || server
            const explicitServers = [...new Set([...(pageServerList ?? []), pageServer].filter(Boolean))]
            const cachedUrl = cachedHashes[h] || ''
            return {
              hash: h,
              server: pageServer,
              servers: explicitServers,
              url: `${pageServer.replace(/\/$/, '')}/${h}`,
              cachedUrl,
              isCached: Boolean(cachedUrl),
            }
          })
        : [],
    [cachedHashes, chapter, server],
  )

  const [currentPage, setCurrentPage] = useState(1)
  const restoredChapterRef = useRef('')
  const savedPage = useReadStore((s) => s.progress[chapterDTag]?.page ?? 1)

  useEffect(() => {
    setCurrentPage(savedPage)
    restoredChapterRef.current = ''
  }, [chapterDTag, savedPage])

  // One ref per page — stable across renders (keyed by pageUrls.length)
  const pageRefs = useMemo(
    () => pageUrls.map(() => ({ current: null }) as React.RefObject<HTMLImageElement | null>),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageUrls.length],
  )

  useEffect(() => {
    if (!chapter || !chapterDTag || restoredChapterRef.current === chapterDTag) return
    const targetIndex = Math.min(Math.max(savedPage, 1), pageRefs.length) - 1
    const target = pageRefs[targetIndex]?.current
    if (!target) return
    target.scrollIntoView?.({ block: 'start' })
    restoredChapterRef.current = chapterDTag
  }, [chapter, chapterDTag, pageRefs, savedPage])

  const handleVisible = useCallback(
    (idx: number) => {
      const page = idx + 1
      setCurrentPage(page)
      if (!chapterDTag) return
      setProgress({
        id: chapterDTag,
        chapterDTag,
        page,
        updatedAt: Date.now(),
      })
    },
    [chapterDTag, setProgress],
  )

  usePageObserver(pageRefs, handleVisible, scrollContainerRef)
  usePagePreloader(pageUrls, currentPage)
  useProgressPublisher(chapterDTag, currentPage)

  if (!chapter) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="text-center">
          <p className="text-lg font-medium text-zinc-100">Chapter not found</p>
          {dTag && (
            <Link
              to={`/comic/${dTag}`}
              className="mt-4 inline-block text-sm text-indigo-400 hover:text-indigo-300"
            >
              ← Back to comic
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur">
        <Link
          to={`/comic/${dTag}`}
          className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-white"
        >
          ← Back
        </Link>
        <div className="flex-1 min-w-0 text-center">
          <p className="truncate text-sm font-medium">{chapter.title}</p>
        </div>
        <PageCounter current={currentPage} total={pageUrls.length} />
      </header>

      {/* Pages */}
      <main
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scroll-smooth overscroll-contain snap-y snap-mandatory touch-pan-y md:snap-none"
      >
        <div className="mx-auto max-w-2xl">
          {pageUrls.map((page, idx) => (
            <BlossomImage
              key={page.hash}
              ref={(el) => {
                pageRefs[idx].current = el
              }}
              hash={page.hash}
              server={page.server}
              servers={page.servers}
              alt={`Page ${idx + 1}`}
              className="block w-full snap-start snap-always"
              loading={page.isCached || idx === 0 ? 'eager' : 'lazy'}
            />
          ))}
        </div>
      </main>

      {/* Chapter navigation */}
      <nav className="flex items-center justify-between border-t border-zinc-800 px-4 py-6">
        {prevChapter ? (
          <Link
            to={`/comic/${dTag}/chapter/${encodeURIComponent(prevChapter.dTag)}`}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm transition hover:border-zinc-500"
          >
            ← Prev
          </Link>
        ) : (
          <span />
        )}
        {nextChapter ? (
          <Link
            to={`/comic/${dTag}/chapter/${encodeURIComponent(nextChapter.dTag)}`}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm transition hover:border-zinc-500"
          >
            Next →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  )
}

function PageCounter({ current, total }: { current: number; total: number }) {
  return (
    <span className="flex-shrink-0 rounded-full bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400">
      {current} / {total}
    </span>
  )
}
