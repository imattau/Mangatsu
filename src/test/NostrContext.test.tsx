import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NostrProvider, useNostr } from '../context/NostrContext'
import type { AuthMethod } from '../stores/authStore'

const mocks = vi.hoisted(() => {
  const mockSetAuth = vi.fn()
  const mockClearAuth = vi.fn()
  const mockSetRelays = vi.fn()
  const mockSetServers = vi.fn()
  const state = {
    pubkey: 'pubkey' as string | null,
    method: 'bunker' as AuthMethod | null,
    secretKey: null as Uint8Array | null,
  }
  return { mockSetAuth, mockClearAuth, mockSetRelays, mockSetServers, state }
})

let mockPubkey: string | null = 'pubkey'
let mockMethod: AuthMethod | null = 'bunker'
const mockSetAuth = mocks.mockSetAuth
const mockClearAuth = mocks.mockClearAuth
const mockSetRelays = mocks.mockSetRelays
const mockSetServers = mocks.mockSetServers

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

vi.mock('../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        pubkey: mocks.state.pubkey,
        method: mocks.state.method,
        secretKey: mocks.state.secretKey,
        setAuth: mocks.mockSetAuth,
        clearAuth: mocks.mockClearAuth,
      }),
    {
      getState: () => ({
        pubkey: mocks.state.pubkey,
        method: mocks.state.method,
        secretKey: mocks.state.secretKey,
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
    mockPubkey = 'pubkey'
    mockMethod = 'bunker'
    mocks.state.pubkey = 'pubkey'
    mocks.state.method = 'bunker'
    mockSetAuth.mockClear()
    mockClearAuth.mockClear()
    mockSetRelays.mockClear()
    mockSetServers.mockClear()
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
    mockMethod = method
    mockService.accountManager.active = { pubkey: 'pubkey' }

    renderProvider()

    await waitFor(() => {
      expect(mockService.connect).toHaveBeenCalled()
      expect(mockClearAuth).not.toHaveBeenCalled()
      expect(mockService.accountManager.clearActive).not.toHaveBeenCalled()
    })
  })

  it.each(['bunker', 'qr'] as AuthMethod[])('clears stale %s auth after reload', async (method) => {
    mocks.state.method = method
    mockMethod = method
    mockService.accountManager.active = null

    renderProvider()

    await waitFor(() => {
      expect(mockClearAuth).toHaveBeenCalled()
      expect(mockService.accountManager.clearActive).toHaveBeenCalled()
    })
  })
})
