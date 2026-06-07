/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { AccountsProvider } from 'applesauce-react/providers'
import { EventStoreProvider } from 'applesauce-react/providers'
import { NostrConnectSigner } from 'applesauce-signers'
import { ExtensionAccount, NostrConnectAccount, PrivateKeyAccount } from 'applesauce-accounts/accounts'
import { NostrService } from '@/services/NostrService'
import { useAuthStore, type AuthMethod } from '@/stores/authStore'
import { DEFAULT_RELAYS, useRelayStore } from '@/stores/relayStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { Nip44Signer } from '@/lib/nip51'
import { useComicStore } from '@/stores/comicStore'
import type { Subscription } from 'rxjs'
import { parseComicEvent } from '@/lib/comic'

const NSEC_SESSION_KEY = 'mangatsu:nsec'

interface NostrContextValue {
  service: NostrService
  refreshSync: () => void
  syncGeneration: number
  isRefreshing: boolean
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function restoreExtensionAccount(
  attempts = 20,
  delayMs = 100,
): Promise<ExtensionAccount | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await ExtensionAccount.fromExtension()
    } catch {
      if (attempt < attempts - 1) {
        await sleep(delayMs)
      }
    }
  }

  return null
}

export function NostrProvider({ children }: PropsWithChildren) {
  const [service] = useState(() => new NostrService())
  const [syncGeneration, setSyncGeneration] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const pubkey = useAuthStore((state) => state.pubkey)
  const method = useAuthStore((state) => state.method)
  const accountData = useAuthStore((state) => state.account)
  const setAuth = useAuthStore((state) => state.setAuth)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const relayUrls = useRelayStore((state) => state.relays)
  const activeRelayUrls = useMemo(
    () => (relayUrls.length > 0 ? relayUrls : DEFAULT_RELAYS),
    [relayUrls],
  )
  const relayKey = useMemo(() => activeRelayUrls.join('\u0000'), [activeRelayUrls])
  const refreshSync = useCallback(() => {
    setIsRefreshing(true)
    setSyncGeneration((generation) => generation + 1)
  }, [])

  const connectionPool = useMemo(
    () => ({
      subscription: service.relayPool.subscription.bind(service.relayPool),
      publish: service.relayPool.publish.bind(service.relayPool),
    }),
    [service],
  )

  useEffect(() => {
    void service.connect(activeRelayUrls)
    return () => {
      service.disconnect()
    }
  }, [activeRelayUrls, relayKey, service, syncGeneration])

  useEffect(() => {
    if (!isRefreshing) {
      return
    }

    const timer = window.setTimeout(() => {
      setIsRefreshing(false)
    }, 1200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isRefreshing, syncGeneration])

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
        const active = service.accountManager.active
        if (active && active.pubkey === pubkey) {
          return
        }
        if (accountData) {
          try {
            const account = NostrConnectAccount.fromJSON(accountData)
            const existing = service.accountManager.getAccountForPubkey(account.pubkey)
            if (existing) {
              service.accountManager.replaceAccount(existing, account)
            } else {
              service.accountManager.addAccount(account)
            }
            service.accountManager.setActive(account)
            if (!cancelled && (pubkey !== account.pubkey || method !== resolvedMethod)) {
              setAuth(account.pubkey, resolvedMethod, accountData)
            }
            return
          } catch {
            // fall through to clearing auth below
          }
        }

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
          if (existing) {
            service.accountManager.replaceAccount(existing, account)
          } else {
            service.accountManager.addAccount(account)
          }
          service.accountManager.setActive(account)
          if (!cancelled && (pubkey !== account.pubkey || method !== 'nsec')) {
            setAuth(account.pubkey, 'nsec')
          }
        } catch {
          sessionStorage.removeItem(NSEC_SESSION_KEY)
          clearAuth()
          service.accountManager.clearActive()
        }
        return
      }

      try {
        const account = await restoreExtensionAccount()
        if (!account) {
          return
        }
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
  }, [accountData, clearAuth, method, pubkey, service, setAuth])

  useEffect(() => {
    if (!pubkey) {
      return
    }

    const sub = service.subscribeToUserComics(pubkey)
    return () => {
      sub.unsubscribe()
    }
  }, [pubkey, relayKey, service, syncGeneration])

  useEffect(() => {
    if (!pubkey) return
    const sub = service.subscribeToUserLists(
      pubkey,
      (urls) => {
        useRelayStore.getState().setRelays(urls)
      },
      (urls) => useBlossomStore.getState().setServers(urls.map((url) => ({ url }))),
    )
    return () => sub.unsubscribe()
  }, [pubkey, relayKey, service, syncGeneration])

  useEffect(() => {
    if (!pubkey) return

    const setAll = useLibraryStore.getState().setAll
    const foreignComicSubs = new Map<string, Subscription>()

    const librarySub = service.subscribeToLibraryList(pubkey, async (event) => {
      try {
        const { decryptFromSelf, decodeLibraryList } = await import('@/lib/nip51')
        const windowNostr = typeof window !== 'undefined'
          ? (window as unknown as { nostr?: Nip44Signer }).nostr
          : undefined
        const { secretKey } = useAuthStore.getState()
        const plaintext = await decryptFromSelf(event.content, {
          windowNostr,
          secretKey: secretKey ?? undefined,
          pubkey,
        })
        const aTags = decodeLibraryList(plaintext)
        setAll(aTags)

        const { comics, setComic } = useComicStore.getState()
        const desiredForeignKeys = new Set<string>()
        for (const aTag of aTags) {
          const parts = aTag.split(':')
          if (parts.length < 3) continue
          const [, authorPubkey, dTag] = parts
          if (!authorPubkey || !dTag) continue

          const key = `${authorPubkey}:${dTag}`
          desiredForeignKeys.add(key)

          if (comics[dTag] || foreignComicSubs.has(key)) continue

          const sub = service.subscribeToForeignComic(authorPubkey, dTag, (foreignEvent) => {
            const comic = parseComicEvent(foreignEvent, undefined)
            if (comic) {
              setComic(comic)
            }
          })
          foreignComicSubs.set(key, sub)
        }

        for (const [key, sub] of foreignComicSubs) {
          if (!desiredForeignKeys.has(key)) {
            sub.unsubscribe()
            foreignComicSubs.delete(key)
          }
        }
      } catch {
        // decryption failed — leave existing local state intact
      }
    })

    return () => {
      librarySub.unsubscribe()
      for (const sub of foreignComicSubs.values()) {
        sub.unsubscribe()
      }
    }
  }, [pubkey, relayKey, service, syncGeneration])

  useEffect(() => {
    const comics = Object.values(useComicStore.getState().comics)
    if (comics.length === 0) return
    void service.comicIndex.upsertComics(comics)
  }, [service, syncGeneration])

  return (
    <EventStoreProvider eventStore={service.eventStore}>
      <AccountsProvider manager={service.accountManager}>
        <NostrContext.Provider value={{ service, refreshSync, syncGeneration, isRefreshing }}>
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
