import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BlossomServer } from '@/types'

export const DEFAULT_BLOSSOM_SERVERS = [
  'https://blossom.primal.net',
  'https://blossom.band',
  'https://cdn.satellite.earth',
]

interface BlossomState {
  servers: BlossomServer[]
  cachedHashes: Record<string, string>
  setServers: (servers: BlossomServer[]) => void
  setCachedHash: (hash: string, objectUrl: string) => void
  primaryServer: () => string
}

export const useBlossomStore = create<BlossomState>()(
  persist(
    (set, get) => ({
      servers: [],
      cachedHashes: {},
      setServers: (servers) => set({ servers }),
      setCachedHash: (hash, objectUrl) =>
        set((s) => ({ cachedHashes: { ...s.cachedHashes, [hash]: objectUrl } })),
      primaryServer: () => get().servers[0]?.url ?? DEFAULT_BLOSSOM_SERVERS[0],
    }),
    { name: 'blossom' },
  ),
)
