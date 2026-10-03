import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReadingProgress } from '@/types'

interface ReadState {
  progress: Record<string, ReadingProgress>
  setProgress: (p: ReadingProgress) => void
  /** Apply progress from another device, unless this device has newer progress for that chapter. */
  mergeRemoteProgress: (p: ReadingProgress) => void
  /** Drop a chapter's progress if it was saved at or before a deletion request (ms). */
  removeDeletedProgress: (chapterDTag: string, untilMs: number) => void
  removeProgressForComic: (comicDTag: string) => void
  removeProgressForChapter: (chapterDTag: string) => void
}

export const useReadStore = create<ReadState>()(
  persist(
    (set) => ({
      progress: {},
      setProgress: (p) =>
        set((s) => ({ progress: { ...s.progress, [p.id]: p } })),
      mergeRemoteProgress: (p) =>
        set((s) => {
          const local = s.progress[p.id]
          if (local && local.updatedAt >= p.updatedAt) return s
          return { progress: { ...s.progress, [p.id]: p } }
        }),
      removeDeletedProgress: (chapterDTag, untilMs) =>
        set((s) => {
          const local = s.progress[chapterDTag]
          if (!local || local.updatedAt > untilMs) return s
          const progress = { ...s.progress }
          delete progress[chapterDTag]
          return { progress }
        }),
      removeProgressForComic: (comicDTag) =>
        set((s) => ({
          progress: Object.fromEntries(
            Object.entries(s.progress).filter(([, entry]) => !entry.chapterDTag.startsWith(`${comicDTag}/`)),
          ),
        })),
      removeProgressForChapter: (chapterDTag) =>
        set((s) => {
          const progress = { ...s.progress }
          for (const [key, entry] of Object.entries(progress)) {
            if (entry.chapterDTag === chapterDTag) {
              delete progress[key]
            }
          }
          return { progress }
        }),
    }),
    { name: 'read' }
  )
)
