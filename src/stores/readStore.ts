import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReadingProgress } from '@/types'

interface ReadState {
  progress: Record<string, ReadingProgress>
  setProgress: (p: ReadingProgress) => void
}

export const useReadStore = create<ReadState>()(
  persist(
    (set) => ({
      progress: {},
      setProgress: (p) =>
        set((s) => ({ progress: { ...s.progress, [p.id]: p } })),
    }),
    { name: 'read' }
  )
)
