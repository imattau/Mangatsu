import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AuthMethod = 'extension' | 'nsec' | 'bunker' | 'qr'

interface AuthState {
  pubkey: string | null
  method: AuthMethod | null
  secretKey: Uint8Array | null
  setPubkey: (pubkey: string | null) => void
  setMethod: (method: AuthMethod | null) => void
  setAuth: (pubkey: string | null, method?: AuthMethod | null) => void
  setSecretKey: (key: Uint8Array | null) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      pubkey: null,
      method: null,
      secretKey: null,
      setPubkey: (pubkey) => set({ pubkey }),
      setMethod: (method) => set({ method }),
      setAuth: (pubkey, method = null) => set({ pubkey, method }),
      setSecretKey: (key) => set({ secretKey: key }),
      clearAuth: () => set({ pubkey: null, method: null, secretKey: null }),
    }),
    { name: 'auth' }
  )
)
