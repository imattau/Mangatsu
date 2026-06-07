import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react'

interface ZoomableReaderSurfaceProps {
  children: ReactNode
  className?: string
  resetKey?: string
  initialPage?: number
  onPageChange?: (idx: number) => void // 0-based index
}

type ViewState = {
  scale: number
  panX: number
  panY: number
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const WHEEL_ZOOM_STEP = 0.2
const DEFAULT_VIEW: ViewState = { scale: MIN_SCALE, panX: 0, panY: 0 }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function ZoomableReaderSurface({
  children,
  className,
  resetKey,
  initialPage,
  onPageChange,
}: ZoomableReaderSurfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ViewState>(DEFAULT_VIEW)
  const dragRef = useRef<{
    startX: number
    startY: number
    startPanX: number
    startPanY: number
  } | null>(null)
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW)
  const [contentHeight, setContentHeight] = useState(0)
  const [dragging, setDragging] = useState(false)

  const updateView = (next: ViewState) => {
    viewRef.current = next
    setView(next)
  }

  const syncVisiblePage = () => {
    if (!onPageChange) return
    const scrollEl = scrollRef.current
    const content = contentRef.current
    const currentView = viewRef.current
    if (!scrollEl || !content) return

    const viewportH = scrollEl.clientHeight
    const centerY =
      (scrollEl.scrollTop + viewportH / 2 - currentView.panY) /
      currentView.scale
    const childrenEls = Array.from(content.children) as HTMLElement[]

    let visibleIdx = 0
    for (let i = 0; i < childrenEls.length; i++) {
      if (childrenEls[i].offsetTop <= centerY) visibleIdx = i
      else break
    }

    onPageChange(visibleIdx)
  }

  useEffect(() => {
    setDragging(false)
    updateView(DEFAULT_VIEW)

    const scrollEl = scrollRef.current
    const content = contentRef.current
    if (!scrollEl || !content) return

    const raf = requestAnimationFrame(() => {
      const target = content.children[(initialPage ?? 1) - 1] as
        | HTMLElement
        | undefined
      if (target) {
        scrollEl.scrollTop = target.offsetTop
      }
      syncVisiblePage()
    })

    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    const updateHeight = () => {
      setContentHeight(content.offsetHeight)
    }

    updateHeight()

    if (typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(updateHeight)
    observer.observe(content)
    return () => observer.disconnect()
  }, [resetKey])

  useEffect(() => {
    syncVisiblePage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.scale, view.panX, view.panY, contentHeight])

  useEffect(() => {
    if (!dragging) return undefined

    const handleMouseMove = (event: MouseEvent) => {
      const dragStart = dragRef.current
      if (!dragStart) return

      event.preventDefault()
      updateView({
        ...viewRef.current,
        panX: dragStart.startPanX + (event.clientX - dragStart.startX),
        panY: dragStart.startPanY + (event.clientY - dragStart.startY),
      })
    }

    const handleMouseUp = () => {
      dragRef.current = null
      setDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging])

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    if (dragging) {
      scrollEl.style.cursor = 'grabbing'
      return
    }

    scrollEl.style.cursor = view.scale > 1 ? 'grab' : 'auto'
  }, [dragging, view.scale])

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return

    event.preventDefault()
    event.stopPropagation()

    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const currentView = viewRef.current
    const direction = event.deltaY < 0 ? 1 : -1
    const nextScale = clamp(
      currentView.scale + direction * WHEEL_ZOOM_STEP,
      MIN_SCALE,
      MAX_SCALE,
    )

    if (nextScale === currentView.scale) return

    const rect = scrollEl.getBoundingClientRect()
    const cursorY = event.clientY - rect.top
    const screenY = scrollEl.scrollTop + cursorY
    const contentY = (screenY - currentView.panY) / currentView.scale

    updateView({
      ...currentView,
      scale: nextScale,
      panY: screenY - contentY * nextScale,
    })
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    if (viewRef.current.scale <= 1) return

    event.preventDefault()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startPanX: viewRef.current.panX,
      startPanY: viewRef.current.panY,
    }
    setDragging(true)
  }

  const scaledHeight =
    contentHeight > 0 ? `${contentHeight * view.scale}px` : undefined

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overflow-x-hidden"
      onScroll={syncVisiblePage}
      onWheel={handleWheel}
    >
      <div style={{ height: scaledHeight, position: 'relative' }}>
        <div
          ref={contentRef}
          className={className}
          draggable={false}
          onMouseDown={handleMouseDown}
          style={{
            width: '100%',
            transform: `translate3d(${view.panX}px, ${view.panY}px, 0) scale(${view.scale})`,
            transformOrigin: 'top center',
            willChange: 'transform',
            userSelect: dragging ? 'none' : 'auto',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
