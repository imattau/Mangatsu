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
        const best = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => ({
            entry,
            idx: refs.findIndex((r) => r.current === entry.target),
          }))
          .filter(({ idx }) => idx !== -1)
          .reduce<{ idx: number; ratio: number } | null>((current, next) => {
            const ratio = next.entry.intersectionRatio
            if (!current) return { idx: next.idx, ratio }
            if (ratio > current.ratio) return { idx: next.idx, ratio }
            if (ratio === current.ratio && next.idx < current.idx) {
              return { idx: next.idx, ratio }
            }
            return current
          }, null)

        if (best) {
          onVisibleRef.current(best.idx)
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
