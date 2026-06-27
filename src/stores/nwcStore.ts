import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { encryptForSession, decryptFromSession, hasSessionKey } from '@/lib/sessionCrypto'

interface NwcState {
  connectionString: string | null
  setConnectionString: (s: string | null) => void
}

const encryptedStorage = createJSONStorage<NwcState>(() => ({
  getItem: async (name) => {
    const raw = localStorage.getItem(name)
    if (!raw) return null
    // Try to decrypt; if session key is missing, return null so the store
    // hydrates with connectionString: null (disconnected state).
    if (!hasSessionKey()) return null
    const decrypted = await decryptFromSession(raw)
    return decrypted
  },
  setItem: async (name, value) => {
    const encrypted = await encryptForSession(value)
    localStorage.setItem(name, encrypted)
  },
  removeItem: (name) => localStorage.removeItem(name),
}))

export const useNwcStore = create<NwcState>()(
  persist(
    (set) => ({
      connectionString: null,
      setConnectionString: (connectionString) => set({ connectionString }),
    }),
    {
      name: 'nwc',
      storage: encryptedStorage,
    },
  )
)
