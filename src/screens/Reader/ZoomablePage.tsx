import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { BlossomImage } from '@/components/BlossomImage'

type Point = { x: number; y: number }

type Transform = {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const PAN_EPSILON = 0.5
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_DISTANCE = 24
const TAP_MOVE_EPSILON = 8

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function center(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function clampTransform(transform: Transform, width: number, height: number): Transform {
  const scaledWidth = width * transform.scale
  const scaledHeight = height * transform.scale

  let x = transform.x
  let y = transform.y

  if (scaledWidth <= width) {
    x = (width - scaledWidth) / 2
  } else {
    x = clamp(x, width - scaledWidth, 0)
  }

  if (scaledHeight <= height) {
    y = (height - scaledHeight) / 2
  } else {
    y = clamp(y, height - scaledHeight, 0)
  }

  return { ...transform, x, y }
}

interface ZoomablePageProps {
  hash: string
  server?: string
  servers?: string[]
  torrent?: string
  alt: string
  loading?: 'eager' | 'lazy'
  className?: string
}

export const ZoomablePage = forwardRef<HTMLImageElement, ZoomablePageProps>(function ZoomablePage(
  { hash, server, servers, torrent, alt, loading, className },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const pointersRef = useRef(new Map<number, Point>())
  const gestureRef = useRef<{
    mode: 'idle' | 'scroll' | 'pan' | 'pinch'
    startScale: number
    startTransform: Transform
    startScrollTop: number
    startScrollLeft: number
    startPoint: Point | null
    pinchContentPoint: Point | null
    pinchDistance: number
    startTime: number
    moved: boolean
  }>({
    mode: 'idle',
    startScale: 1,
    startTransform: { scale: 1, x: 0, y: 0 },
    startScrollTop: 0,
    startScrollLeft: 0,
    startPoint: null,
    pinchContentPoint: null,
    pinchDistance: 0,
    startTime: 0,
    moved: false,
  })
  const lastTapRef = useRef<{ time: number; point: Point } | null>(null)
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 })

  const transformStyle = useMemo(
    () => ({
      transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
      transformOrigin: 'top left',
      willChange: 'transform',
      pointerEvents: 'none' as const,
    }),
    [transform],
  )

  useEffect(() => {
    pointersRef.current.clear()
    gestureRef.current.mode = 'idle'
    gestureRef.current.startPoint = null
    gestureRef.current.pinchContentPoint = null
    gestureRef.current.pinchDistance = 0
    gestureRef.current.moved = false
    setTransform({ scale: 1, x: 0, y: 0 })
  }, [hash])

  function getBounds() {
    const rect = wrapperRef.current?.getBoundingClientRect()
    return rect ? { width: rect.width, height: rect.height } : null
  }

  function beginScroll(point: Point) {
    const scrollParent = wrapperRef.current?.closest('main') as HTMLElement | null
    gestureRef.current.mode = 'scroll'
    gestureRef.current.startPoint = point
    gestureRef.current.startTime = performance.now()
    gestureRef.current.moved = false
    gestureRef.current.startScrollTop = scrollParent?.scrollTop ?? 0
    gestureRef.current.startScrollLeft = scrollParent?.scrollLeft ?? 0
  }

  function beginPan(point: Point) {
    gestureRef.current.mode = 'pan'
    gestureRef.current.startPoint = point
    gestureRef.current.startTime = performance.now()
    gestureRef.current.moved = false
    gestureRef.current.startTransform = transform
  }

  function beginPinch() {
    const points = [...pointersRef.current.values()]
    if (points.length < 2) return

    const bounds = getBounds()
    if (!bounds) return

    const pinchCenter = center(points[0], points[1])
    const pinchDistance = distance(points[0], points[1])
    const startTransform = transform
    gestureRef.current.mode = 'pinch'
    gestureRef.current.startTransform = startTransform
    gestureRef.current.startScale = startTransform.scale
    gestureRef.current.pinchDistance = pinchDistance
    gestureRef.current.startTime = performance.now()
    gestureRef.current.moved = false
    gestureRef.current.pinchContentPoint = {
      x: (pinchCenter.x - startTransform.x) / startTransform.scale,
      y: (pinchCenter.y - startTransform.y) / startTransform.scale,
    }
  }

  function updateTransform(next: Transform) {
    const bounds = getBounds()
    if (!bounds) {
      setTransform(next)
      return
    }
    setTransform(clampTransform(next, bounds.width, bounds.height))
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') return

    const point = { x: event.clientX, y: event.clientY }
    pointersRef.current.set(event.pointerId, point)
    event.currentTarget.setPointerCapture(event.pointerId)

    if (pointersRef.current.size === 1) {
      if (transform.scale > MIN_SCALE + 0.001) {
        beginPan(point)
      } else {
        beginScroll(point)
      }
      return
    }

    if (pointersRef.current.size >= 2) {
      beginPinch()
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') return

    const point = { x: event.clientX, y: event.clientY }
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, point)

    if (gestureRef.current.mode === 'scroll' && pointersRef.current.size === 1) {
      const startPoint = gestureRef.current.startPoint
      const scrollParent = wrapperRef.current?.closest('main') as HTMLElement | null
      if (!startPoint || !scrollParent) return

      const dy = point.y - startPoint.y
      const dx = point.x - startPoint.x
      if (Math.hypot(dx, dy) > TAP_MOVE_EPSILON) {
        gestureRef.current.moved = true
      }
      if (Math.abs(dx) > PAN_EPSILON) {
        scrollParent.scrollLeft = gestureRef.current.startScrollLeft - dx
      }
      scrollParent.scrollTop = gestureRef.current.startScrollTop - dy
      return
    }

    if (gestureRef.current.mode === 'pan' && pointersRef.current.size === 1) {
      const startPoint = gestureRef.current.startPoint
      if (!startPoint) return

      const dx = point.x - startPoint.x
      const dy = point.y - startPoint.y
      if (Math.hypot(dx, dy) > TAP_MOVE_EPSILON) {
        gestureRef.current.moved = true
      }
      const next = {
        ...gestureRef.current.startTransform,
        x: gestureRef.current.startTransform.x + dx,
        y: gestureRef.current.startTransform.y + dy,
      }
      updateTransform(next)
      return
    }

    if (gestureRef.current.mode === 'pinch' && pointersRef.current.size >= 2) {
      const points = [...pointersRef.current.values()]
      const bounds = getBounds()
      if (!bounds || !gestureRef.current.pinchContentPoint) return

      const pinchCenter = center(points[0], points[1])
      const pinchDistance = distance(points[0], points[1])
      const ratio = pinchDistance / Math.max(gestureRef.current.pinchDistance, 1)
      gestureRef.current.moved = true
      const scale = clamp(gestureRef.current.startScale * ratio, MIN_SCALE, MAX_SCALE)
      const next = {
        scale,
        x: pinchCenter.x - gestureRef.current.pinchContentPoint.x * scale,
        y: pinchCenter.y - gestureRef.current.pinchContentPoint.y * scale,
      }
      updateTransform(next)
    }
  }

  function resetGestureIfNeeded() {
    if (pointersRef.current.size > 0) return
    gestureRef.current.mode = 'idle'
    gestureRef.current.startPoint = null
    gestureRef.current.pinchContentPoint = null
    gestureRef.current.pinchDistance = 0
    gestureRef.current.moved = false
    if (transform.scale <= MIN_SCALE + 0.001) {
      setTransform({ scale: 1, x: 0, y: 0 })
    }
  }

  function onPointerUpOrCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') return
    const point = { x: event.clientX, y: event.clientY }
    const duration = performance.now() - gestureRef.current.startTime
    const tapCandidate =
      !gestureRef.current.moved &&
      duration < DOUBLE_TAP_MS &&
      gestureRef.current.mode !== 'pinch'

    pointersRef.current.delete(event.pointerId)

    if (pointersRef.current.size === 1) {
      const [remainingPoint] = pointersRef.current.values()
      if (!remainingPoint) return
      if (transform.scale > MIN_SCALE + 0.001) {
        beginPan(remainingPoint)
      } else {
        beginScroll(remainingPoint)
      }
      return
    }

    if (tapCandidate) {
      const previousTap = lastTapRef.current
      const isDoubleTap =
        previousTap != null &&
        performance.now() - previousTap.time < DOUBLE_TAP_MS &&
        distance(previousTap.point, point) < DOUBLE_TAP_DISTANCE

      lastTapRef.current = { time: performance.now(), point }

      if (isDoubleTap) {
        setTransform({ scale: 1, x: 0, y: 0 })
        gestureRef.current.mode = 'idle'
        gestureRef.current.startPoint = null
        gestureRef.current.pinchContentPoint = null
        gestureRef.current.pinchDistance = 0
        gestureRef.current.moved = false
        return
      }
    } else {
      lastTapRef.current = null
    }

    resetGestureIfNeeded()
  }

  return (
    <div
      ref={wrapperRef}
      className="relative overflow-hidden select-none"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUpOrCancel}
      onPointerCancel={onPointerUpOrCancel}
    >
      <BlossomImage
        ref={ref}
        hash={hash}
        server={server}
        servers={servers}
        torrent={torrent}
        alt={alt}
        loading={loading}
        className={className}
        style={transformStyle}
        draggable={false}
      />
    </div>
  )
})
