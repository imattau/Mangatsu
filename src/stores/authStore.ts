import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AuthMethod = 'extension' | 'nsec' | 'bunker' | 'qr'

interface AuthState {
  pubkey: string | null
  method: AuthMethod | null
  setPubkey: (pubkey: string | null) => void
  setMethod: (method: AuthMethod | null) => void
  setAuth: (pubkey: string | null, method?: AuthMethod | null) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      pubkey: null,
      method: null,
      setPubkey: (pubkey) => set({ pubkey }),
      setMethod: (method) => set({ method }),
      setAuth: (pubkey, method = null) => set({ pubkey, method }),
      clearAuth: () => set({ pubkey: null, method: null }),
    }),
    { name: 'auth' }
  )
)
