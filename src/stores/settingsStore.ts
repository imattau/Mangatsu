import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  showNsfw: boolean
  setShowNsfw: (value: boolean) => void
  enableWebTorrent: boolean
  setEnableWebTorrent: (value: boolean) => void
  torrentTrackers: string[]
  setTorrentTrackers: (value: string[]) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      showNsfw: false,
      setShowNsfw: (value) => set({ showNsfw: value }),
      enableWebTorrent: true,
      setEnableWebTorrent: (value) => set({ enableWebTorrent: value }),
      torrentTrackers: [],
      setTorrentTrackers: (value) => set({ torrentTrackers: value }),
    }),
    { name: 'settings' },
  ),
)
