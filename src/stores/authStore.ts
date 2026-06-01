import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  pubkey: string | null
  setPubkey: (pubkey: string | null) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      pubkey: null,
      setPubkey: (pubkey) => set({ pubkey }),
    }),
    { name: 'auth' }
  )
)
