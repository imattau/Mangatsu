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
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowLeft, ChevronLeft, ChevronRight, ListOrdered, Maximize2, Minimize2 } from 'lucide-react'
import { ChapterListDrawer } from './ChapterListDrawer'


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
  const comicUrl =
    comic && dTag
      ? `${window.location.origin}${import.meta.env.BASE_URL}comic/${dTag}?pubkey=${comic.pubkey}`
      : ''
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

  const savedPage = useReadStore((s) => s.progress[chapterDTag]?.page ?? 1)
  const [currentPage, setCurrentPage] = useState(savedPage)
  const [pageChapter, setPageChapter] = useState(chapterDTag)
  const [showControls, setShowControls] = useState(true)

  // Restore the saved page when a chapter opens. Later changes to savedPage (this device's
  // own saves, or progress synced from another device) must not move the open chapter.
  if (pageChapter !== chapterDTag) {
    setPageChapter(chapterDTag)
    setCurrentPage(savedPage)
  }
  const enableWebTorrent = useSettingsStore((s) => s.enableWebTorrent)
  const [stats, setStats] = useState(() => webTorrentService.getStats())

  const handleSurfaceClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    // Portaled content (e.g. the chapter drawer) bubbles through React but isn't in this subtree.
    if (!e.currentTarget.contains(target) || target.closest('button, a, input, select, label')) {
      return
    }
    setShowControls((prev) => !prev)
  }, [])

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
            <Button asChild variant="link" className="mt-4 text-indigo-400">
              <Link to={`/comic/${dTag}`}>
                <ChevronLeft data-icon="inline-start" />
                Back to comic
              </Link>
            </Button>
          )}
        </div>
      </div>
    )
  }

  const chapterHref = (target: { dTag: string }) =>
    `/comic/${dTag}/chapter/${encodeURIComponent(target.dTag)}${fullscreen ? '?view=full' : ''}`
  const progressPercent = pageUrls.length > 0 ? (currentPage / pageUrls.length) * 100 : 0

  return (
    <div
      onClick={fullscreen ? handleSurfaceClick : undefined}
      className={
        fullscreen
          ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground'
          : 'flex h-dvh flex-col overflow-hidden bg-background text-foreground'
      }
    >
      {!fullscreen ? (
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background/90 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 backdrop-blur">
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link to={`/comic/${dTag}`}>
              <ChevronLeft data-icon="inline-start" />
              Back
            </Link>
          </Button>
          <div className="flex-1 min-w-0 text-center">
            <p className="truncate text-sm font-medium">{chapter.title}</p>
          </div>
          <div className="flex items-center gap-2">
            <PageCounter current={currentPage} total={pageUrls.length} />
            <ChapterListDrawer
              comicTitle={comic?.title}
              chapters={allChapters}
              currentDTag={chapterDTag}
              chapterHref={chapterHref}
            >
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="rounded-full"
                aria-label="Chapters"
                title="Chapters"
              >
                <ListOrdered />
              </Button>
            </ChapterListDrawer>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="rounded-full"
              aria-label="Fullscreen"
              title="Fullscreen"
              onClick={() => {
                void setFullscreenMode(true)
              }}
            >
              <Maximize2 />
            </Button>
          </div>
        </header>
      ) : (
        <div
          inert={!showControls}
          className={cn(
            'pointer-events-none absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-20 flex flex-col overflow-hidden rounded-2xl border bg-background/70 backdrop-blur transition-all duration-300',
            showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4',
          )}
        >
          <div className="flex items-center justify-between gap-2 px-2 py-2">
            <Button asChild variant="ghost" size="icon-lg" className="pointer-events-auto rounded-full">
              <Link to={`/comic/${dTag}`} aria-label="Back" title="Back">
                <ArrowLeft />
              </Link>
            </Button>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-medium">{chapter.title}</p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {currentPage} / {pageUrls.length}
              </p>
            </div>
            <div className="flex items-center">
              <ChapterListDrawer
                comicTitle={comic?.title}
                chapters={allChapters}
                currentDTag={chapterDTag}
                chapterHref={chapterHref}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="pointer-events-auto rounded-full"
                  aria-label="Chapters"
                  title="Chapters"
                >
                  <ListOrdered />
                </Button>
              </ChapterListDrawer>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="pointer-events-auto rounded-full"
                aria-label="Exit fullscreen"
                title="Exit fullscreen"
                onClick={() => {
                  void setFullscreenMode(false)
                }}
              >
                <Minimize2 />
              </Button>
            </div>
          </div>
          <div
            role="progressbar"
            aria-label="Chapter progress"
            aria-valuemin={1}
            aria-valuemax={pageUrls.length}
            aria-valuenow={currentPage}
            className="h-0.5 w-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
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
        <div
          inert={!showControls}
          className={cn(
            'pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-3 right-3 z-20 flex flex-col gap-2 transition-all duration-300',
            showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
          )}
        >
          {enableWebTorrent && <TorrentStats stats={stats} overlay />}
          <div className="flex items-center justify-between gap-3">
            {prevChapter ? (
              <Button asChild variant="ghost" size="lg" className="pointer-events-auto h-10 rounded-xl border bg-background/70 px-4 backdrop-blur">
                <Link to={chapterHref(prevChapter)}>
                  <ChevronLeft data-icon="inline-start" />
                  Prev
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {nextChapter ? (
              <Button asChild variant="ghost" size="lg" className="pointer-events-auto h-10 rounded-xl border bg-background/70 px-4 backdrop-blur">
                <Link to={chapterHref(nextChapter)}>
                  Next
                  <ChevronRight data-icon="inline-end" />
                </Link>
              </Button>
            ) : (
              <span />
            )}
          </div>
        </div>
      ) : (
        <nav className="flex flex-col gap-2 border-t px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          {enableWebTorrent && <TorrentStats stats={stats} />}
          <div className="flex items-center justify-between">
            {prevChapter ? (
              <Button asChild variant="outline" size="lg" className="h-10 rounded-xl px-4">
                <Link to={chapterHref(prevChapter)}>
                  <ChevronLeft data-icon="inline-start" />
                  Prev
                </Link>
              </Button>
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
                <Button asChild variant="outline" size="lg" className="h-10 rounded-xl px-4">
                  <Link to={chapterHref(nextChapter)}>
                    Next
                    <ChevronRight data-icon="inline-end" />
                  </Link>
                </Button>
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
    <span className="flex-shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
      {current} / {total}
    </span>
  )
}

type TorrentStatsValue = ReturnType<typeof webTorrentService.getStats>

function TorrentStats({ stats, overlay = false }: { stats: TorrentStatsValue; overlay?: boolean }) {
  const kbps = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB/s`
  const active = stats.activeTorrents > 0

  return (
    <div
      className={cn(
        'flex font-mono text-muted-foreground',
        overlay
          ? 'mx-auto gap-3 rounded-full border bg-background/80 px-3 py-1 text-[0.65rem] shadow-lg backdrop-blur'
          : 'flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[0.7rem]',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className={cn('size-1.5 rounded-full bg-emerald-500', active ? 'animate-pulse' : 'opacity-50')} />
        Torrents: {stats.activeTorrents}
      </span>
      <span>Peers: {stats.numPeers}</span>
      <span>DL: {kbps(stats.downloadSpeed)}</span>
      <span>UL: {kbps(stats.uploadSpeed)}</span>
    </div>
  )
}
