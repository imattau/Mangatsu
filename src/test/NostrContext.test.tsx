import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NostrProvider, useNostr } from '../context/NostrContext'
import type { AuthMethod } from '../stores/authStore'

const mocks = vi.hoisted(() => {
  const mockSetAuth = vi.fn()
  const mockClearAuth = vi.fn()
  const mockSetRelays = vi.fn()
  const mockSetServers = vi.fn()
  const mockFromExtension = vi.fn()
  const mockAccountData = {
    id: 'account-id',
    type: 'nostr-connect',
    pubkey: 'pubkey',
    signer: {
      clientKey: '11'.repeat(32),
      remote: 'remote-pubkey',
      relays: ['wss://relay.example'],
    },
  }
  const state = {
    pubkey: 'pubkey' as string | null,
    method: 'bunker' as AuthMethod | null,
    secretKey: null as Uint8Array | null,
    account: mockAccountData as typeof mockAccountData | null,
  }
  return {
    mockSetAuth,
    mockClearAuth,
    mockSetRelays,
    mockSetServers,
    mockFromExtension,
    mockAccountData,
    state,
  }
})

const mockSetAuth = mocks.mockSetAuth
const mockClearAuth = mocks.mockClearAuth
const mockSetRelays = mocks.mockSetRelays
const mockSetServers = mocks.mockSetServers
const mockFromExtension = mocks.mockFromExtension
const mockAccountData = mocks.mockAccountData

type MockActiveAccount = { pubkey: string } | null

const mockService = {
  accountManager: {
    active: { pubkey: 'pubkey' } as MockActiveAccount,
    clearActive: vi.fn(),
    getAccountForPubkey: vi.fn(),
    addAccount: vi.fn(),
    setActive: vi.fn(),
  },
  relayPool: {
    subscription: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
    publish: vi.fn(),
    status$: {},
    relay: vi.fn(),
    remove: vi.fn(),
    relays: new Map(),
  },
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  subscribeToUserComics: vi.fn(() => ({ unsubscribe: vi.fn() })),
  subscribeToUserLists: vi.fn(() => ({ unsubscribe: vi.fn() })),
  subscribeToLibraryList: vi.fn(() => ({ unsubscribe: vi.fn() })),
}

vi.mock('applesauce-accounts/accounts', async () => {
  const actual = await vi.importActual<typeof import('applesauce-accounts/accounts')>(
    'applesauce-accounts/accounts',
  )

  return {
    ...actual,
    ExtensionAccount: {
      ...actual.ExtensionAccount,
      fromExtension: mocks.mockFromExtension,
    },
  }
})

vi.mock('../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        pubkey: mocks.state.pubkey,
        method: mocks.state.method,
        secretKey: mocks.state.secretKey,
        account: mocks.state.account,
        setAuth: mocks.mockSetAuth,
        clearAuth: mocks.mockClearAuth,
      }),
    {
      getState: () => ({
        pubkey: mocks.state.pubkey,
        method: mocks.state.method,
        secretKey: mocks.state.secretKey,
        account: mocks.state.account,
      }),
    },
  ),
}))

vi.mock('../stores/relayStore', () => ({
  DEFAULT_RELAYS: ['wss://relay.example'],
  useRelayStore: (sel: (s: { relays: string[]; setRelays: (relays: string[]) => void }) => unknown) =>
    sel({ relays: [], setRelays: mocks.mockSetRelays }),
}))

vi.mock('../stores/blossomStore', () => ({
  useBlossomStore: (sel: (s: { setServers: (servers: Array<{ url: string }>) => void }) => unknown) =>
    sel({ setServers: mocks.mockSetServers }),
}))

vi.mock('../lib/nip51', () => ({
  decryptFromSelf: vi.fn().mockResolvedValue('[]'),
  decodeLibraryList: vi.fn().mockReturnValue([]),
}))

vi.mock('../stores/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({ setAll: vi.fn() }),
  },
}))

vi.mock('../stores/comicStore', () => ({
  useComicStore: {
    getState: () => ({ comics: {} }),
  },
}))

vi.mock('../services/NostrService', () => ({
  NostrService: class {
    accountManager = mockService.accountManager
    relayPool = mockService.relayPool
    connect = mockService.connect
    disconnect = mockService.disconnect
    subscribeToUserComics = mockService.subscribeToUserComics
    subscribeToUserLists = mockService.subscribeToUserLists
    subscribeToLibraryList = mockService.subscribeToLibraryList
  },
}))

function Consumer() {
  useNostr()
  return null
}

function renderProvider() {
  return render(
    <NostrProvider>
      <Consumer />
    </NostrProvider>,
  )
}

describe('NostrProvider auth restore', () => {
  beforeEach(() => {
    mocks.state.pubkey = 'pubkey'
    mocks.state.method = 'bunker'
    mocks.state.account = mockAccountData
    mockSetAuth.mockClear()
    mockClearAuth.mockClear()
    mockSetRelays.mockClear()
    mockSetServers.mockClear()
    mockFromExtension.mockReset()
    mockService.accountManager.clearActive.mockClear()
    mockService.accountManager.setActive.mockClear()
    mockService.accountManager.addAccount.mockClear()
    mockService.accountManager.getAccountForPubkey.mockClear()
    mockService.connect.mockClear()
    mockService.disconnect.mockClear()
    mockService.subscribeToUserComics.mockClear()
    mockService.subscribeToUserLists.mockClear()
    mockService.subscribeToLibraryList.mockClear()
  })

  it.each(['bunker', 'qr'] as AuthMethod[])('keeps active %s auth during session', async (method) => {
    mocks.state.method = method
    mocks.state.account = mockAccountData
    mockService.accountManager.active = { pubkey: 'pubkey' }

    renderProvider()

    await waitFor(() => {
      expect(mockService.connect).toHaveBeenCalled()
      expect(mockClearAuth).not.toHaveBeenCalled()
      expect(mockService.accountManager.clearActive).not.toHaveBeenCalled()
    })
  })

  it.each(['bunker', 'qr'] as AuthMethod[])('restores persisted %s auth after reload', async (method) => {
    mocks.state.method = method
    mocks.state.account = mockAccountData
    mockService.accountManager.active = null

    renderProvider()

    await waitFor(() => {
      expect(mockClearAuth).not.toHaveBeenCalled()
      expect(mockService.accountManager.clearActive).not.toHaveBeenCalled()
      expect(mockService.accountManager.addAccount).toHaveBeenCalled()
      expect(mockService.accountManager.setActive).toHaveBeenCalled()
    })
  })

  it('retries transient extension restore failures without clearing auth', async () => {
    mocks.state.method = 'extension'
    mocks.state.account = null
    mockService.accountManager.active = null
    mockFromExtension
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce({ pubkey: 'pubkey' } as never)

    renderProvider()

    await waitFor(() => {
      expect(mockService.accountManager.setActive).toHaveBeenCalled()
      expect(mockClearAuth).not.toHaveBeenCalled()
      expect(mockService.accountManager.clearActive).not.toHaveBeenCalled()
    })
  })
})
