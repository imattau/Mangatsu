import { useEffect, useRef, type ReactNode } from 'react'
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'

interface ZoomableReaderSurfaceProps {
  children: ReactNode
  className?: string
  resetKey?: string
  initialPage?: number
  onPageChange?: (idx: number) => void  // 0-based index
}

export function ZoomableReaderSurface({ children, className, resetKey, initialPage, onPageChange }: ZoomableReaderSurfaceProps) {
  const transformRef = useRef<ReactZoomPanPinchRef>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Reset + restore page on chapter change
  useEffect(() => {
    transformRef.current?.resetTransform(0)  // 0ms animation
    if (!initialPage || initialPage <= 1) return
    requestAnimationFrame(() => {
      const content = contentRef.current
      if (!content) return
      const target = content.children[initialPage - 1] as HTMLElement | undefined
      if (!target) return
      transformRef.current?.setTransform(0, -target.offsetTop, 1, 0)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  function handleTransform(_: ReactZoomPanPinchRef, state: { scale: number; positionX: number; positionY: number }) {
    if (!onPageChange) return
    const content = contentRef.current
    const wrapper = transformRef.current?.instance?.wrapperComponent
    if (!content || !wrapper) return
    const viewportH = wrapper.clientHeight
    const centerY = (-state.positionY + viewportH / 2) / state.scale
    const children = Array.from(content.children) as HTMLElement[]
    let visibleIdx = 0
    for (let i = 0; i < children.length; i++) {
      if (children[i].offsetTop <= centerY) visibleIdx = i
      else break
    }
    onPageChange(visibleIdx)
  }

  return (
    <TransformWrapper
      ref={transformRef}
      minScale={1}
      maxScale={4}
      limitToBounds={true}
      panning={{ lockAxisX: false }}
      doubleClick={{ step: 0.7 }}
      velocityAnimation={{ sensitivityTouch: 1, animationTime: 400 }}
      onTransform={handleTransform}
    >
      <TransformComponent
        wrapperStyle={{ width: '100%', height: '100%' }}
        contentStyle={{ width: '100%' }}
        contentClass={className}
      >
        <div ref={contentRef} style={{ width: '100%' }}>
          {children}
        </div>
      </TransformComponent>
    </TransformWrapper>
  )
}
