import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SerializedAccount } from 'applesauce-accounts'
import type { NostrConnectAccountSignerData } from 'applesauce-accounts/accounts'

export type AuthMethod = 'extension' | 'nsec' | 'bunker' | 'qr' | 'passkey'

interface AuthState {
  pubkey: string | null
  method: AuthMethod | null
  secretKey: Uint8Array | null
  account: SerializedAccount<NostrConnectAccountSignerData> | null
  setPubkey: (pubkey: string | null) => void
  setMethod: (method: AuthMethod | null) => void
  setAuth: (
    pubkey: string | null,
    method?: AuthMethod | null,
    account?: SerializedAccount<NostrConnectAccountSignerData> | null,
  ) => void
  setAccount: (account: SerializedAccount<NostrConnectAccountSignerData> | null) => void
  setSecretKey: (key: Uint8Array | null) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      pubkey: null,
      method: null,
      secretKey: null,
      account: null,
      setPubkey: (pubkey) => set({ pubkey }),
      setMethod: (method) => set({ method }),
      setAuth: (pubkey, method = null, account = null) => set({ pubkey, method, account }),
      setAccount: (account) => set({ account }),
      setSecretKey: (key) => set({ secretKey: key }),
      clearAuth: () => set({ pubkey: null, method: null, secretKey: null, account: null }),
    }),
    {
      name: 'auth',
      partialize: (state) => ({
        pubkey: state.pubkey,
        method: state.method,
        account: state.account,
      }),
    },
  )
)
