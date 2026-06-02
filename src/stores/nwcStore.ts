import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NwcState {
  connectionString: string | null
  setConnectionString: (s: string | null) => void
}

// SECURITY NOTE: The NWC connection string is a spending credential (contains a
// private key that authorises payments from the user's wallet). It is persisted
// in cleartext localStorage because the Web Crypto API does not provide a
// portable way to encrypt secrets that survive page reloads without a user
// password. Trust assumption: the device/browser profile is not compromised.
// Mitigations in place:
//   1. ZapButton requires explicit user confirmation before each payment.
//   2. The invoice amount is verified against the decoded BOLT11 before paying.
// If stronger guarantees are required, consider prompting for a PIN/passphrase
// to derive an encryption key and wrapping the connection string with AES-GCM.
export const useNwcStore = create<NwcState>()(
  persist(
    (set) => ({
      connectionString: null,
      setConnectionString: (connectionString) => set({ connectionString }),
    }),
    { name: 'nwc' }
  )
)
