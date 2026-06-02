import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NwcState {
  connectionString: string | null
  setConnectionString: (s: string | null) => void
}

export const useNwcStore = create<NwcState>()(
  persist(
    (set) => ({
      connectionString: null,
      setConnectionString: (connectionString) => set({ connectionString }),
    }),
    { name: 'nwc' }
  )
)
