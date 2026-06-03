import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Comic, Chapter } from '@/types'

interface ComicState {
  comics: Record<string, Comic>
  chapters: Record<string, Chapter>
  deletedDTags: Set<string>
  setComic: (comic: Comic) => void
  setChapter: (chapter: Chapter) => void
  removeComic: (comicDTag: string) => void
  removeChaptersForComic: (comicDTag: string) => void
  chaptersForComic: (comicDTag: string) => Chapter[]
}

export const useComicStore = create<ComicState>()(
  persist(
    (set, get) => ({
      comics: {},
      chapters: {},
      deletedDTags: new Set<string>(),
      setComic: (comic) =>
        set((s) => {
          if (s.deletedDTags.has(comic.dTag)) return s
          return { comics: { ...s.comics, [comic.dTag]: comic } }
        }),
      setChapter: (chapter) =>
        set((s) => ({ chapters: { ...s.chapters, [chapter.dTag]: chapter } })),
      removeComic: (comicDTag) =>
        set((s) => {
          const comics = { ...s.comics }
          delete comics[comicDTag]
          const deletedDTags = new Set(s.deletedDTags)
          deletedDTags.add(comicDTag)
          return { comics, deletedDTags }
        }),
      removeChaptersForComic: (comicDTag) =>
        set((s) => ({
          chapters: Object.fromEntries(
            Object.entries(s.chapters).filter(([, chapter]) => chapter.parentDTag !== comicDTag),
          ),
        })),
      chaptersForComic: (comicDTag) =>
        Object.values(get().chapters).filter((c) => c.parentDTag === comicDTag),
    }),
    {
      name: 'comics',
      partialize: (state) => ({
        comics: state.comics,
        chapters: state.chapters,
        deletedDTags: [...state.deletedDTags],
      }),
      merge: (persisted, current) => {
        const p = persisted as { comics?: Record<string, Comic>; chapters?: Record<string, Chapter>; deletedDTags?: string[] }
        return {
          ...current,
          comics: p.comics ?? {},
          chapters: p.chapters ?? {},
          deletedDTags: new Set<string>(p.deletedDTags ?? []),
        }
      },
    }
  )
)
