import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Comic, Chapter } from '@/types'

interface ComicState {
  comics: Record<string, Comic>
  chapters: Record<string, Chapter>
  setComic: (comic: Comic) => void
  setChapter: (chapter: Chapter) => void
  chaptersForComic: (comicDTag: string) => Chapter[]
}

export const useComicStore = create<ComicState>()(
  persist(
    (set, get) => ({
      comics: {},
      chapters: {},
      setComic: (comic) =>
        set((s) => ({ comics: { ...s.comics, [comic.id]: comic } })),
      setChapter: (chapter) =>
        set((s) => ({ chapters: { ...s.chapters, [chapter.id]: chapter } })),
      chaptersForComic: (comicDTag) =>
        Object.values(get().chapters).filter((c) => c.parentDTag === comicDTag),
    }),
    { name: 'comics' }
  )
)
