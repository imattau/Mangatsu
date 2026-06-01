import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://purplepag.es',
]

interface RelayState {
  relays: string[]
  setRelays: (relays: string[]) => void
  activeRelays: () => string[]
}

export const useRelayStore = create<RelayState>()(
  persist(
    (set, get) => ({
      relays: [],
      setRelays: (relays) => set({ relays }),
      activeRelays: () => (get().relays.length > 0 ? get().relays : DEFAULT_RELAYS),
    }),
    { name: 'relays' },
  ),
)
