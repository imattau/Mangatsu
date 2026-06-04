import { useEffect, useRef } from 'react'

export function usePageObserver(
  refs: React.RefObject<HTMLImageElement | null>[],
  onVisible: (index: number) => void,
  rootRef?: React.RefObject<HTMLElement | null>,
) {
  const onVisibleRef = useRef(onVisible)
  useEffect(() => {
    onVisibleRef.current = onVisible
  })

  useEffect(() => {
    if (refs.length === 0) return

    const root = rootRef?.current ?? null
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = refs.findIndex((r) => r.current === entry.target)
            if (idx !== -1) onVisibleRef.current(idx)
          }
        }
      },
      { threshold: 0.65, root },
    )

    for (const ref of refs) {
      if (ref.current) {
        observer.observe(ref.current)
      }
    }

    return () => {
      observer.disconnect()
    }
  }, [refs, rootRef])
}
