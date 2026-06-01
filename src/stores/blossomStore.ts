import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BlossomServer } from '@/types'

interface BlossomState {
  servers: BlossomServer[]
  cachedHashes: Record<string, string>
  setServers: (servers: BlossomServer[]) => void
  setCachedHash: (hash: string, objectUrl: string) => void
  primaryServer: () => string | undefined
}

export const useBlossomStore = create<BlossomState>()(
  persist(
    (set, get) => ({
      servers: [],
      cachedHashes: {},
      setServers: (servers) => set({ servers }),
      setCachedHash: (hash, objectUrl) =>
        set((s) => ({ cachedHashes: { ...s.cachedHashes, [hash]: objectUrl } })),
      primaryServer: () => get().servers[0]?.url,
    }),
    { name: 'blossom' }
  )
)
