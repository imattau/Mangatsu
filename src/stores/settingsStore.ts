import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  showNsfw: boolean
  setShowNsfw: (value: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      showNsfw: false,
      setShowNsfw: (value) => set({ showNsfw: value }),
    }),
    { name: 'settings' },
  ),
)
