import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReadingProgress } from '@/types'

interface ReadState {
  progress: Record<string, ReadingProgress>
  setProgress: (p: ReadingProgress) => void
  removeProgressForComic: (comicDTag: string) => void
}

export const useReadStore = create<ReadState>()(
  persist(
    (set) => ({
      progress: {},
      setProgress: (p) =>
        set((s) => ({ progress: { ...s.progress, [p.id]: p } })),
      removeProgressForComic: (comicDTag) =>
        set((s) => ({
          progress: Object.fromEntries(
            Object.entries(s.progress).filter(([, entry]) => !entry.chapterDTag.startsWith(`${comicDTag}/`)),
          ),
        })),
    }),
    { name: 'read' }
  )
)
