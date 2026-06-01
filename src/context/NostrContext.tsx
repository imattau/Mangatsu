/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { AccountsProvider } from 'applesauce-react/providers'
import { EventStoreProvider } from 'applesauce-react/providers'
import { NostrConnectSigner } from 'applesauce-signers'
import { ExtensionAccount, PrivateKeyAccount } from 'applesauce-accounts/accounts'
import { NostrService } from '@/services/NostrService'
import { useAuthStore, type AuthMethod } from '@/stores/authStore'

const NSEC_SESSION_KEY = 'mangatsu:nsec'

interface NostrContextValue {
  service: NostrService
}

const NostrContext = createContext<NostrContextValue | null>(null)

function restoreMethod(method: AuthMethod | null) {
  if (!method) {
    if (typeof window !== 'undefined' && sessionStorage.getItem(NSEC_SESSION_KEY)) {
      return 'nsec' as const
    }
    if (typeof window !== 'undefined' && 'nostr' in window && window.nostr) {
      return 'extension' as const
    }
    return null
  }

  return method
}

export function NostrProvider({ children }: PropsWithChildren) {
  const [service] = useState(() => new NostrService())
  const pubkey = useAuthStore((state) => state.pubkey)
  const method = useAuthStore((state) => state.method)
  const setAuth = useAuthStore((state) => state.setAuth)
  const clearAuth = useAuthStore((state) => state.clearAuth)

  const connectionPool = useMemo(
    () => ({
      subscription: service.relayPool.subscription.bind(service.relayPool),
      publish: service.relayPool.publish.bind(service.relayPool),
    }),
    [service],
  )

  useEffect(() => {
    service.connect()
    return () => {
      service.disconnect()
    }
  }, [service])

  useEffect(() => {
    NostrConnectSigner.pool = connectionPool
    return () => {
      if (NostrConnectSigner.pool === connectionPool) {
        NostrConnectSigner.pool = undefined
      }
    }
  }, [connectionPool])

  useEffect(() => {
    let cancelled = false

    async function restore() {
      if (!pubkey) {
        return
      }

      const resolvedMethod = restoreMethod(method)

      if (resolvedMethod === 'bunker' || resolvedMethod === 'qr') {
        clearAuth()
        service.accountManager.clearActive()
        return
      }

      if (resolvedMethod === 'nsec') {
        const stored = sessionStorage.getItem(NSEC_SESSION_KEY)
        if (!stored) {
          clearAuth()
          service.accountManager.clearActive()
          return
        }

        try {
          const account = PrivateKeyAccount.fromKey(stored)
          const existing = service.accountManager.getAccountForPubkey(account.pubkey)
          const active = existing ?? account
          if (!existing) {
            service.accountManager.addAccount(account)
          }
          service.accountManager.setActive(active)
          if (!cancelled && (pubkey !== active.pubkey || method !== 'nsec')) {
            setAuth(active.pubkey, 'nsec')
          }
        } catch {
          sessionStorage.removeItem(NSEC_SESSION_KEY)
          clearAuth()
          service.accountManager.clearActive()
        }
        return
      }

      try {
        const account = await ExtensionAccount.fromExtension()
        const existing = service.accountManager.getAccountForPubkey(account.pubkey)
        const active = existing ?? account
        if (!existing) {
          service.accountManager.addAccount(account)
        }
        service.accountManager.setActive(active)
        if (!cancelled && (pubkey !== active.pubkey || method !== 'extension')) {
          setAuth(active.pubkey, 'extension')
        }
      } catch {
        clearAuth()
        service.accountManager.clearActive()
      }
    }

    void restore()

    return () => {
      cancelled = true
    }
  }, [clearAuth, method, pubkey, service, setAuth])

  useEffect(() => {
    if (!pubkey) {
      return
    }

    const sub = service.subscribeToUserComics(pubkey)
    return () => {
      sub.unsubscribe()
    }
  }, [pubkey, service])

  return (
    <EventStoreProvider eventStore={service.eventStore}>
      <AccountsProvider manager={service.accountManager}>
        <NostrContext.Provider value={{ service }}>
          {children}
        </NostrContext.Provider>
      </AccountsProvider>
    </EventStoreProvider>
  )
}

export function useNostr(): NostrContextValue {
  const context = useContext(NostrContext)
  if (!context) {
    throw new Error('useNostr must be used inside NostrProvider')
  }
  return context
}
