import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useComicStore } from '@/stores/comicStore'
import { useReadStore } from '@/stores/readStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { BoostButton } from '@/components/BoostButton'
import { useProgressPublisher } from './useProgressPublisher'
import { usePagePreloader } from './usePagePreloader'
import { ZoomableReaderSurface } from './ZoomableReaderSurface'
import { BlossomImage } from '@/components/BlossomImage'
import { webTorrentService } from '@/services/WebTorrentService'
import { useSettingsStore } from '@/stores/settingsStore'


function chapterNumber(dTag: string): number {
  const match = dTag.match(/(\d+(?:\.\d+)?)$/)
  return match ? parseFloat(match[1]) : 0
}

export function ReaderScreen() {
  const { dTag, chapterId } = useParams<{ dTag: string; chapterId: string }>()
  const chapterDTag = chapterId ? decodeURIComponent(chapterId) : ''
  const [searchParams, setSearchParams] = useSearchParams()
  const viewMode = searchParams.get('view')
  const [isSmallScreen, setIsSmallScreen] = useState(false)
  const fullscreen = viewMode === 'full' || (isSmallScreen && viewMode !== 'compact')
  const mobileDefaultAppliedRef = useRef(false)

  const comic = useComicStore((s) => (dTag ? s.comics[dTag] ?? null : null))
  const chaptersForComic = useComicStore((s) => s.chaptersForComic)
  const cachedHashes = useBlossomStore((s) => s.cachedHashes)
  const primaryServer = useBlossomStore((s) => s.primaryServer)
  const blossomServers = useBlossomStore((s) => s.servers)
  const setProgress = useReadStore((s) => s.setProgress)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const query = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsSmallScreen(query.matches)

    sync()

    if (!mobileDefaultAppliedRef.current && query.matches && !viewMode) {
      mobileDefaultAppliedRef.current = true
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.set('view', 'full')
      setSearchParams(nextSearchParams, { replace: true })
    }

    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [searchParams, setSearchParams, viewMode])

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
  const appOrigin = window.location.origin
  const comicUrl = comic && dTag ? `${window.location.origin}/comic/${dTag}?pubkey=${comic.pubkey}` : ''
  const activeBlossomServers = useMemo(
    () => blossomServers.map((entry) => entry.url),
    [blossomServers],
  )
  const pageUrls = useMemo(
    () =>
      chapter
        ? chapter.pageHashes.map((h, idx) => {
            const pageServerList = chapter.pageServerLists?.[idx] ?? []
            const pageServer = chapter.pageServers?.[idx] || server
            const pageTorrent = chapter.pageTorrents?.[idx] || chapter.torrent
            const dimensions = chapter.pageDimensions?.[idx]
            const explicitServers = [...new Set([...(pageServerList ?? []), pageServer].filter(Boolean))]
            const cachedUrl = cachedHashes[h] || ''
            return {
              hash: h,
              server: pageServer,
              servers: explicitServers,
              torrent: pageTorrent,
              dimensions,
              url: `${pageServer.replace(/\/$/, '')}/${h}`,
              cachedUrl,
              isCached: Boolean(cachedUrl),
            }
          })
        : [],
    [cachedHashes, chapter, server],
  )

  const [currentPage, setCurrentPage] = useState(1)
  const [showControls, setShowControls] = useState(true)
  const savedPage = useReadStore((s) => s.progress[chapterDTag]?.page ?? 1)
  const enableWebTorrent = useSettingsStore((s) => s.enableWebTorrent)
  const [stats, setStats] = useState(() => webTorrentService.getStats())

  const handleSurfaceClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, select, label')) {
      return
    }
    setShowControls((prev) => !prev)
  }, [])

  useEffect(() => {
    setCurrentPage(savedPage)
  }, [chapterDTag, savedPage])

  useEffect(() => {
    return () => {
      webTorrentService.cleanupAll()
    }
  }, [chapterDTag])

  useEffect(() => {
    if (!enableWebTorrent) return

    const interval = setInterval(() => {
      setStats(webTorrentService.getStats())
    }, 1000)

    return () => clearInterval(interval)
  }, [enableWebTorrent])

  // One ref per page — stable across renders (keyed by pageUrls.length)
  const pageRefs = useMemo(
    () => pageUrls.map(() => ({ current: null }) as React.RefObject<HTMLImageElement | null>),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageUrls.length],
  )

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

  usePagePreloader(pageUrls, currentPage)
  useProgressPublisher(chapterDTag, currentPage)

  const setFullscreenMode = useCallback(
    async (nextFullscreen: boolean) => {
      const nextSearchParams = new URLSearchParams(searchParams)
      if (nextFullscreen) {
        nextSearchParams.set('view', 'full')
      } else {
        nextSearchParams.set('view', 'compact')
      }
      setSearchParams(nextSearchParams, { replace: true })
    },
    [searchParams, setSearchParams],
  )

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
    <div
      onClick={fullscreen ? handleSurfaceClick : undefined}
      className={
        fullscreen
          ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-zinc-950 text-zinc-100'
          : 'flex h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100'
      }
    >
      {!fullscreen ? (
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void setFullscreenMode(true)
              }}
              className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-white"
            >
              Fullscreen
            </button>
            <PageCounter current={currentPage} total={pageUrls.length} />
          </div>
        </header>
      ) : (
        <div className={`pointer-events-none absolute left-3 right-3 top-3 z-20 flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-zinc-950/60 px-3 py-2 backdrop-blur transition-all duration-300 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}>
          <Link
            to={`/comic/${dTag}`}
            className="pointer-events-auto rounded-full border border-white/10 bg-zinc-900/70 px-3 py-1 text-xs text-zinc-200 transition hover:border-white/25 hover:bg-zinc-800"
          >
            Back
          </Link>
          <div className="pointer-events-none min-w-0 text-center">
            <p className="truncate text-sm font-medium">{chapter.title}</p>
            <p className="text-[11px] text-zinc-400">{currentPage} / {pageUrls.length}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void setFullscreenMode(false)
            }}
            className="pointer-events-auto rounded-full border border-white/10 bg-zinc-900/70 px-3 py-1 text-xs text-zinc-200 transition hover:border-white/25 hover:bg-zinc-800"
          >
            Exit
          </button>
        </div>
      )}

      <main
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
      >
        <ZoomableReaderSurface
          className={fullscreen ? 'mx-auto max-w-5xl' : 'mx-auto max-w-2xl'}
          resetKey={chapterDTag}
          initialPage={savedPage}
          onPageChange={handleVisible}
        >
          {pageUrls.map((page, idx) => (
            <BlossomImage
              key={page.hash}
              ref={(el) => {
                pageRefs[idx].current = el
              }}
              hash={page.hash}
              server={page.server}
              servers={page.servers}
              torrent={page.torrent}
              intrinsicWidth={page.dimensions?.width}
              intrinsicHeight={page.dimensions?.height}
              alt={`Page ${idx + 1}`}
              className="block w-full"
              loading={page.isCached || idx === 0 ? 'eager' : 'lazy'}
            />
          ))}
        </ZoomableReaderSurface>
      </main>

      {fullscreen ? (
        <div className={`absolute bottom-3 left-3 right-3 z-20 flex flex-col gap-2 transition-all duration-300 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}>
          {enableWebTorrent && (
            <div className="mx-auto rounded-full bg-zinc-950/80 px-3 py-1 text-[0.65rem] text-zinc-400 font-mono backdrop-blur flex gap-3 shadow-lg border border-white/5">
              <span className="flex items-center gap-1">
                <span className={`h-1 w-1 rounded-full bg-emerald-500 ${stats.activeTorrents > 0 ? 'animate-pulse' : 'opacity-50'}`} />
                Torrents: {stats.activeTorrents}
              </span>
              <span>Peers: {stats.numPeers}</span>
              <span>DL: {(stats.downloadSpeed / 1024).toFixed(1)} KB/s</span>
              <span>UL: {(stats.uploadSpeed / 1024).toFixed(1)} KB/s</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div>
              {prevChapter ? (
                <Link
                  to={`/comic/${dTag}/chapter/${encodeURIComponent(prevChapter.dTag)}?view=full`}
                  className="rounded-xl border border-white/10 bg-zinc-950/60 px-4 py-2 text-sm backdrop-blur transition hover:border-white/25 hover:bg-zinc-900"
                >
                  ← Prev
                </Link>
              ) : (
                <span />
              )}
            </div>
            <div>
              {nextChapter ? (
                <Link
                  to={`/comic/${dTag}/chapter/${encodeURIComponent(nextChapter.dTag)}?view=full`}
                  className="rounded-xl border border-white/10 bg-zinc-950/60 px-4 py-2 text-sm backdrop-blur transition hover:border-white/25 hover:bg-zinc-900"
                >
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </div>
          </div>
        </div>
      ) : (
        <nav className="flex flex-col gap-2 border-t border-zinc-800 px-4 py-3">
          {enableWebTorrent && (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[0.7rem] text-zinc-500 font-mono">
              <span className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${stats.activeTorrents > 0 ? 'animate-pulse' : 'opacity-50'}`} />
                Active Torrents: <strong className="text-zinc-400">{stats.activeTorrents}</strong>
              </span>
              <span>
                Peers: <strong className="text-zinc-400">{stats.numPeers}</strong>
              </span>
              <span>
                DL: <strong className="text-zinc-400">{(stats.downloadSpeed / 1024).toFixed(1)} KB/s</strong>
              </span>
              <span>
                UL: <strong className="text-zinc-400">{(stats.uploadSpeed / 1024).toFixed(1)} KB/s</strong>
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
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
            <div className="ml-auto flex items-center gap-2">
              {comic ? (
                <BoostButton
                  comic={comic}
                  comicUrl={comicUrl}
                  appOrigin={appOrigin}
                  blossomServers={activeBlossomServers}
                />
              ) : null}
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
            </div>
          </div>
        </nav>
      )}
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
