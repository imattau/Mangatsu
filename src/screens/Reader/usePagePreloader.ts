import { useEffect, useRef } from 'react'

interface ReaderPageAsset {
  url: string
  isCached: boolean
}

export function usePagePreloader(pageUrls: ReaderPageAsset[], currentPage: number) {
  const seenUrls = useRef(new Set<string>())

  useEffect(() => {
    const nextPage = pageUrls[currentPage]
    if (!nextPage || nextPage.isCached || seenUrls.current.has(nextPage.url)) return
    if (typeof Image === 'undefined') return

    seenUrls.current.add(nextPage.url)
    const image = new Image()
    image.src = nextPage.url
  }, [currentPage, pageUrls])
}
