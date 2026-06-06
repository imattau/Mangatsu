import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BlossomServer, PageDimensions } from '@/types'

export const DEFAULT_BLOSSOM_SERVERS = [
  'https://blossom.primal.net',
  'https://blossom.band',
  'https://cdn.satellite.earth',
]

interface BlossomState {
  servers: BlossomServer[]
  cachedHashes: Record<string, string>
  cachedDimensions: Record<string, PageDimensions>
  setServers: (servers: BlossomServer[]) => void
  setCachedHash: (hash: string, objectUrl: string) => void
  setCachedDimensions: (hash: string, dimensions: PageDimensions) => void
  primaryServer: () => string
}

export const useBlossomStore = create<BlossomState>()(
  persist(
    (set, get) => ({
      servers: [],
      cachedHashes: {},
      cachedDimensions: {},
      setServers: (servers) => set({ servers }),
      setCachedHash: (hash, objectUrl) =>
        set((s) => ({ cachedHashes: { ...s.cachedHashes, [hash]: objectUrl } })),
      setCachedDimensions: (hash, dimensions) =>
        set((s) => ({ cachedDimensions: { ...s.cachedDimensions, [hash]: dimensions } })),
      primaryServer: () => get().servers[0]?.url ?? DEFAULT_BLOSSOM_SERVERS[0],
    }),
    {
      name: 'blossom',
      partialize: (state) => ({
        servers: state.servers,
        cachedDimensions: state.cachedDimensions,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<BlossomState>),
        cachedHashes: {},
        cachedDimensions: (persistedState as Partial<BlossomState>)?.cachedDimensions ?? {},
      }),
    },
  ),
)
