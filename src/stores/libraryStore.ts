import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LibraryState {
  savedATags: string[]
  add: (aTag: string) => void
  remove: (aTag: string) => void
  isIn: (aTag: string) => boolean
  setAll: (aTags: string[]) => void
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      savedATags: [],
      add: (aTag) =>
        set((s) =>
          s.savedATags.includes(aTag) ? s : { savedATags: [...s.savedATags, aTag] },
        ),
      remove: (aTag) =>
        set((s) => ({ savedATags: s.savedATags.filter((t) => t !== aTag) })),
      isIn: (aTag) => get().savedATags.includes(aTag),
      setAll: (aTags) => set({ savedATags: aTags }),
    }),
    { name: 'library' },
  ),
)
