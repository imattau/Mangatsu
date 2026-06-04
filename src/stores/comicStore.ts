import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Comic, Chapter } from '@/types'

interface ComicState {
  comics: Record<string, Comic>
  chapters: Record<string, Chapter>
  deletedDTags: Set<string>
  deletedChapterDTags: Set<string>
  setComic: (comic: Comic) => void
  setChapter: (chapter: Chapter) => void
  forceSetChapter: (chapter: Chapter) => void
  removeComic: (comicDTag: string) => void
  removeChapter: (chapterDTag: string) => void
  removeChaptersForComic: (comicDTag: string) => void
  chaptersForComic: (comicDTag: string) => Chapter[]
}

export const useComicStore = create<ComicState>()(
  persist(
    (set, get) => ({
      comics: {},
      chapters: {},
      deletedDTags: new Set<string>(),
      deletedChapterDTags: new Set<string>(),
      setComic: (comic) =>
        set((s) => {
          if (s.deletedDTags.has(comic.dTag)) return s
          return { comics: { ...s.comics, [comic.dTag]: comic } }
        }),
      setChapter: (chapter) =>
        set((s) => {
          if (s.deletedChapterDTags.has(chapter.dTag)) return s
          return { chapters: { ...s.chapters, [chapter.dTag]: chapter } }
        }),
      forceSetChapter: (chapter) =>
        set((s) => {
          const deletedChapterDTags = new Set(s.deletedChapterDTags)
          deletedChapterDTags.delete(chapter.dTag)
          return { chapters: { ...s.chapters, [chapter.dTag]: chapter }, deletedChapterDTags }
        }),
      removeComic: (comicDTag) =>
        set((s) => {
          const comics = { ...s.comics }
          delete comics[comicDTag]
          const deletedDTags = new Set(s.deletedDTags)
          deletedDTags.add(comicDTag)
          return { comics, deletedDTags }
        }),
      removeChapter: (chapterDTag) =>
        set((s) => {
          const chapters = { ...s.chapters }
          delete chapters[chapterDTag]
          const deletedChapterDTags = new Set(s.deletedChapterDTags)
          deletedChapterDTags.add(chapterDTag)
          return { chapters, deletedChapterDTags }
        }),
      removeChaptersForComic: (comicDTag) =>
        set((s) => {
          const chapters = Object.fromEntries(
            Object.entries(s.chapters).filter(([, chapter]) => chapter.parentDTag !== comicDTag),
          )
          const deletedChapterDTags = new Set(s.deletedChapterDTags)
          for (const [chapterDTag, chapter] of Object.entries(s.chapters)) {
            if (chapter.parentDTag === comicDTag) {
              deletedChapterDTags.add(chapterDTag)
            }
          }
          return { chapters, deletedChapterDTags }
        }),
      chaptersForComic: (comicDTag) =>
        Object.values(get().chapters).filter(
          (c) => c.parentDTag === comicDTag && !get().deletedChapterDTags.has(c.dTag),
        ),
    }),
    {
      name: 'comics',
      partialize: (state) => ({
        comics: state.comics,
        chapters: state.chapters,
        deletedDTags: [...state.deletedDTags],
        deletedChapterDTags: [...state.deletedChapterDTags],
      }),
      merge: (persisted, current) => {
        const p = persisted as {
          comics?: Record<string, Comic>
          chapters?: Record<string, Chapter>
          deletedDTags?: string[]
          deletedChapterDTags?: string[]
        }
        return {
          ...current,
          comics: p.comics ?? {},
          chapters: Object.fromEntries(
            Object.entries(p.chapters ?? {}).filter(
              ([dTag]) => !(p.deletedChapterDTags ?? []).includes(dTag),
            ),
          ),
          deletedDTags: new Set<string>(p.deletedDTags ?? []),
          deletedChapterDTags: new Set<string>(p.deletedChapterDTags ?? []),
        }
      },
    }
  )
)
