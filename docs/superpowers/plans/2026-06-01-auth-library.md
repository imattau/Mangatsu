# Auth + Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement login (NIP-07, nsec, bunker, QR) and a reactive Library screen backed by applesauce + Zustand.

**Architecture:** `NostrProvider` wraps the app and composes applesauce's `EventStoreProvider` + `AccountsProvider`. Auth state (pubkey) persists in `authStore`; live Nostr data flows through `EventStore` into `comicStore`. `LibraryScreen` reads both layers reactively.

**Tech Stack:** applesauce-react, applesauce-signers, applesauce-accounts, applesauce-relay, react-qr-code, Zustand, React Router v7, Vitest + Testing Library

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/context/NostrContext.tsx` | Create | `NostrProvider` + `useNostr()` hook |
| `src/screens/Login/index.tsx` | Create | Login screen, 4-method vertical list |
| `src/screens/Login/QrCodeView.tsx` | Create | NIP-46 inbound QR sub-view |
| `src/main.tsx` | Modify | Wrap app in `NostrProvider` |
| `src/router.tsx` | Modify | Auth guard → `/login` when no pubkey |
| `src/services/NostrService.ts` | Modify | Add `subscribeToUserComics(pubkey)` |
| `src/screens/Library/index.tsx` | Modify | Full layout: hero + grid |

---

## Task 1: Install QR code dependency

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install react-qr-code**

```bash
npm install react-qr-code
```

Expected: `package.json` and `package-lock.json` updated with `react-qr-code`.

- [ ] **Step 2: Verify TypeScript types resolve**

```bash
npx tsc --noEmit
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-qr-code"
```

---

## Task 2: NostrProvider context

**Files:**
- Create: `src/context/NostrContext.tsx`
- Test: `src/test/NostrContext.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/test/NostrContext.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NostrProvider, useNostr } from '../context/NostrContext'
import { NostrService } from '../services/NostrService'

function Consumer() {
  const { service } = useNostr()
  return <div data-testid="ok">{service instanceof NostrService ? 'yes' : 'no'}</div>
}

describe('NostrProvider', () => {
  it('provides NostrService instance', () => {
    render(<NostrProvider><Consumer /></NostrProvider>)
    expect(screen.getByTestId('ok').textContent).toBe('yes')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/test/NostrContext.test.tsx
```

Expected: FAIL — `NostrContext` module not found.

- [ ] **Step 3: Create NostrContext**

Create `src/context/NostrContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useRef, type PropsWithChildren } from 'react'
import { EventStoreProvider, AccountsProvider } from 'applesauce-react'
import { NostrService } from '../services/NostrService'

interface NostrContextValue {
  service: NostrService
}

const NostrContext = createContext<NostrContextValue | null>(null)

export function NostrProvider({ children }: PropsWithChildren) {
  const serviceRef = useRef(new NostrService())
  const service = serviceRef.current

  useEffect(() => {
    service.connect()
    return () => { service.disconnect() }
  }, [service])

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
  const ctx = useContext(NostrContext)
  if (!ctx) throw new Error('useNostr must be used inside NostrProvider')
  return ctx
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/test/NostrContext.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context/NostrContext.tsx src/test/NostrContext.test.tsx
git commit -m "feat: add NostrProvider context"
```

---

## Task 3: Wrap app in NostrProvider + auth guard

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/router.tsx`

- [ ] **Step 1: Wrap app in NostrProvider**

Open `src/main.tsx`. Replace the current render call so `NostrProvider` wraps `RouterProvider`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { NostrProvider } from './context/NostrContext'
import { router } from './router'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NostrProvider>
      <RouterProvider router={router} />
    </NostrProvider>
  </StrictMode>
)
```

- [ ] **Step 2: Add auth guard to router**

Open `src/router.tsx`. Add a `ProtectedRoute` component and wrap the `/` index route. The full file should look like:

```tsx
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { LibraryScreen } from './screens/Library'
import { ComicDetailScreen } from './screens/ComicDetail'
import { ReaderScreen } from './screens/Reader'
import { UploadScreen } from './screens/Upload'
import { SettingsScreen } from './screens/Settings'
import { LoginScreen } from './screens/Login'

function ProtectedRoute() {
  const pubkey = useAuthStore((s) => s.pubkey)
  return pubkey ? <Outlet /> : <Navigate to="/login" replace />
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginScreen /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/', element: <LibraryScreen /> },
      { path: '/comic/:dTag', element: <ComicDetailScreen /> },
      { path: '/comic/:dTag/chapter/:chapterDTag', element: <ReaderScreen /> },
      { path: '/upload', element: <UploadScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
    ],
  },
])
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors (LoginScreen stub will be created in Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx src/router.tsx
git commit -m "feat: wrap app in NostrProvider, add auth guard"
```

---

## Task 4: Login screen — NIP-07 + nsec methods

**Files:**
- Create: `src/screens/Login/index.tsx`
- Test: `src/test/LoginScreen.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/test/LoginScreen.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LoginScreen } from '../screens/Login'

// Provide a minimal NostrContext
vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      accountManager: {
        addAccount: vi.fn(),
        setActive: vi.fn(),
      },
    },
  }),
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { setPubkey: (p: string) => void }) => unknown) =>
    sel({ setPubkey: vi.fn() }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('LoginScreen', () => {
  it('renders all four login methods', () => {
    render(<LoginScreen />, { wrapper: Wrapper })
    expect(screen.getByText(/browser extension/i)).toBeInTheDocument()
    expect(screen.getByText(/nsec/i)).toBeInTheDocument()
    expect(screen.getByText(/bunker/i)).toBeInTheDocument()
    expect(screen.getByText(/qr code/i)).toBeInTheDocument()
  })

  it('shows error when extension is missing', async () => {
    // window.nostr undefined by default in jsdom
    render(<LoginScreen />, { wrapper: Wrapper })
    fireEvent.click(screen.getByText(/browser extension/i))
    await waitFor(() =>
      expect(screen.getByText(/no extension detected/i)).toBeInTheDocument()
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/test/LoginScreen.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement LoginScreen**

Create `src/screens/Login/index.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExtensionSigner, PrivateKeySigner } from 'applesauce-signers'
import { ExtensionAccount, PrivateKeyAccount } from 'applesauce-accounts'
import { useNostr } from '../../context/NostrContext'
import { useAuthStore } from '../../stores/authStore'
import { QrCodeView } from './QrCodeView'

type Method = 'none' | 'nsec' | 'bunker' | 'qr'

export function LoginScreen() {
  const { service } = useNostr()
  const setPubkey = useAuthStore((s) => s.setPubkey)
  const navigate = useNavigate()
  const [activeMethod, setActiveMethod] = useState<Method>('none')
  const [nsecInput, setNsecInput] = useState('')
  const [bunkerInput, setBunkerInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleExtension() {
    setError(null)
    if (!window.nostr) {
      setError('No extension detected. Install Alby or nos2x.')
      return
    }
    setLoading(true)
    try {
      const signer = new ExtensionSigner()
      const pubkey = await signer.getPublicKey()
      const account = new ExtensionAccount(pubkey, signer)
      service.accountManager.addAccount(account)
      service.accountManager.setActive(account)
      setPubkey(pubkey)
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extension error')
    } finally {
      setLoading(false)
    }
  }

  async function handleNsec() {
    setError(null)
    setLoading(true)
    try {
      const account = PrivateKeyAccount.fromKey(nsecInput.trim())
      const pubkey = await account.signer.getPublicKey()
      sessionStorage.setItem('nsec', nsecInput.trim())
      setNsecInput('')
      service.accountManager.addAccount(account)
      service.accountManager.setActive(account)
      setPubkey(pubkey)
      navigate('/')
    } catch (e) {
      setError('Invalid nsec key.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold tracking-widest mb-1">漫 MANGATSU</h1>
      <p className="text-xs text-zinc-500 mb-8">decentralised manga reader</p>

      {error && (
        <div className="w-full max-w-sm mb-4 bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="w-full max-w-sm flex flex-col gap-3">
        {/* NIP-07 */}
        <button
          onClick={handleExtension}
          disabled={loading}
          className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 text-left text-sm"
        >
          ⚡ Browser Extension (NIP-07)
        </button>

        {/* nsec */}
        {activeMethod !== 'nsec' ? (
          <button
            onClick={() => setActiveMethod('nsec')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 text-left text-sm"
          >
            🔑 Paste nsec key
          </button>
        ) : (
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col gap-3">
            <p className="text-xs text-yellow-400">⚠ Your key is only stored for this session.</p>
            <input
              type="password"
              value={nsecInput}
              onChange={(e) => setNsecInput(e.target.value)}
              placeholder="nsec1..."
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-white placeholder:text-zinc-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleNsec}
                disabled={loading || !nsecInput}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                Login
              </button>
              <button
                onClick={() => { setActiveMethod('none'); setNsecInput('') }}
                className="px-3 py-2 text-sm text-zinc-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Bunker */}
        {activeMethod !== 'bunker' ? (
          <button
            onClick={() => setActiveMethod('bunker')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 text-left text-sm"
          >
            🔌 Bunker URI (NIP-46)
          </button>
        ) : (
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col gap-3">
            <input
              type="text"
              value={bunkerInput}
              onChange={(e) => setBunkerInput(e.target.value)}
              placeholder="bunker://..."
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-white placeholder:text-zinc-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleBunker(bunkerInput, service, setPubkey, navigate, setError, setLoading)}
                disabled={loading || !bunkerInput}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                {loading ? 'Connecting…' : 'Connect'}
              </button>
              <button
                onClick={() => { setActiveMethod('none'); setBunkerInput('') }}
                className="px-3 py-2 text-sm text-zinc-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* QR */}
        {activeMethod !== 'qr' ? (
          <button
            onClick={() => setActiveMethod('qr')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 text-left text-sm"
          >
            📷 QR Code
          </button>
        ) : (
          <QrCodeView
            onSuccess={(pubkey) => { setPubkey(pubkey); navigate('/') }}
            onCancel={() => setActiveMethod('none')}
          />
        )}
      </div>
    </div>
  )
}

async function handleBunker(
  uri: string,
  service: ReturnType<typeof useNostr>['service'],
  setPubkey: (p: string) => void,
  navigate: ReturnType<typeof useNavigate>,
  setError: (e: string | null) => void,
  setLoading: (v: boolean) => void,
) {
  const { NostrConnectSigner } = await import('applesauce-signers')
  const { NostrConnectAccount } = await import('applesauce-accounts')
  setError(null)
  setLoading(true)
  try {
    const signer = await NostrConnectSigner.fromBunkerURI(uri, { pool: service.relayPool as never })
    await signer.open()
    const pubkey = await signer.getPublicKey()
    const account = new NostrConnectAccount(pubkey, signer)
    service.accountManager.addAccount(account)
    service.accountManager.setActive(account)
    setPubkey(pubkey)
    navigate('/')
  } catch (e) {
    setError('Bunker connection failed. Check the URI.')
  } finally {
    setLoading(false)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/LoginScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/Login/index.tsx src/test/LoginScreen.test.tsx
git commit -m "feat: add login screen (NIP-07 + nsec + bunker)"
```

---

## Task 5: QR code login sub-view

**Files:**
- Create: `src/screens/Login/QrCodeView.tsx`
- Test: `src/test/QrCodeView.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/test/QrCodeView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QrCodeView } from '../screens/Login/QrCodeView'

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: { relayPool: {} },
  }),
}))

describe('QrCodeView', () => {
  it('renders a QR code svg', () => {
    render(<QrCodeView onSuccess={vi.fn()} onCancel={vi.fn()} />)
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('renders a cancel button', () => {
    render(<QrCodeView onSuccess={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/cancel/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/test/QrCodeView.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement QrCodeView**

Create `src/screens/Login/QrCodeView.tsx`:

```tsx
import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers'
import { NostrConnectAccount } from 'applesauce-accounts'
import { useNostr } from '../../context/NostrContext'

const CONNECT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol']

interface Props {
  onSuccess: (pubkey: string) => void
  onCancel: () => void
}

export function QrCodeView({ onSuccess, onCancel }: Props) {
  const { service } = useNostr()
  const [uri, setUri] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let signer: NostrConnectSigner
    let cancelled = false

    async function setup() {
      try {
        const localSigner = new PrivateKeySigner()
        signer = new NostrConnectSigner({
          relays: CONNECT_RELAYS,
          signer: localSigner,
          pool: service.relayPool as never,
        })
        const connectUri = await signer.getNostrConnectURI({ name: 'Mangatsu' })
        if (!cancelled) setUri(connectUri)
        await signer.open()
        if (cancelled) return
        const pubkey = await signer.getPublicKey()
        const account = new NostrConnectAccount(pubkey, signer)
        service.accountManager.addAccount(account)
        service.accountManager.setActive(account)
        onSuccess(pubkey)
      } catch (e) {
        if (!cancelled) setError('QR connection failed.')
      }
    }

    setup()
    return () => { cancelled = true }
  }, [service, onSuccess])

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col items-center gap-4">
      <p className="text-xs text-zinc-400 text-center">
        Scan with a Nostr signer app (e.g. Keychain, Amber)
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {uri ? (
        <div className="bg-white p-3 rounded-lg">
          <QRCode value={uri} size={200} />
        </div>
      ) : (
        <div className="w-[200px] h-[200px] bg-zinc-800 rounded-lg animate-pulse" />
      )}
      <button onClick={onCancel} className="text-sm text-zinc-400">
        Cancel
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/test/QrCodeView.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Login/QrCodeView.tsx src/test/QrCodeView.test.tsx
git commit -m "feat: add QR code login view"
```

---

## Task 6: subscribeToUserComics on NostrService

**Files:**
- Modify: `src/services/NostrService.ts`
- Test: `src/test/NostrService.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/test/NostrService.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { NostrService } from '../services/NostrService'

describe('NostrService.subscribeToUserComics', () => {
  it('returns a subscription object with unsubscribe', () => {
    const svc = new NostrService()
    const onEvent = vi.fn()
    const sub = svc.subscribeToUserComics('abc123', onEvent)
    expect(typeof sub.unsubscribe).toBe('function')
    sub.unsubscribe()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/test/NostrService.test.ts
```

Expected: FAIL — `subscribeToUserComics` not a function.

- [ ] **Step 3: Add subscribeToUserComics to NostrService**

Open `src/services/NostrService.ts` and add the method (keep existing code):

```ts
import { EventStore } from 'applesauce-core'
import { RelayPool } from 'applesauce-relay'
import { AccountManager } from 'applesauce-accounts'
import { EventFactory } from 'applesauce-factory'
import type { NostrEvent } from 'applesauce-core/helpers/event'

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
]

export class NostrService {
  eventStore = new EventStore()
  relayPool = new RelayPool()
  accountManager = new AccountManager()
  eventFactory = new EventFactory()

  async connect(relays: string[] = DEFAULT_RELAYS) {
    for (const url of relays) {
      this.relayPool.relay(url)
    }
  }

  async disconnect() {
    for (const [, relay] of this.relayPool.relays) {
      relay.close()
    }
  }

  get activeAccount() {
    return this.accountManager.active
  }

  subscribeToUserComics(
    pubkey: string,
    onEvent: (event: NostrEvent) => void,
  ): { unsubscribe: () => void } {
    const group = this.relayPool.group(DEFAULT_RELAYS)
    const sub = group.req([{ kinds: [30402], authors: [pubkey] }]).subscribe({
      next: (event) => {
        this.eventStore.add(event as NostrEvent)
        onEvent(event as NostrEvent)
      },
      error: () => {},
    })
    return { unsubscribe: () => sub.unsubscribe() }
  }
}

export const nostrService = new NostrService()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/test/NostrService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/NostrService.ts src/test/NostrService.test.ts
git commit -m "feat: add subscribeToUserComics to NostrService"
```

---

## Task 7: Library screen

**Files:**
- Modify: `src/screens/Library/index.tsx`
- Test: `src/test/LibraryScreen.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/test/LibraryScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LibraryScreen } from '../screens/Library'
import type { Comic, ReadingProgress } from '../types'

const mockComic: Comic = {
  id: '1', pubkey: 'abc', dTag: 'one-piece', title: 'One Piece',
  author: 'Oda', description: '', coverHash: 'hash1',
  blossomServer: 'https://blossom.example', tags: [], eventId: 'ev1',
}

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      subscribeToUserComics: (_: string, cb: (e: unknown) => void) => {
        return { unsubscribe: vi.fn() }
      },
    },
  }),
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string }) => unknown) =>
    sel({ pubkey: 'abc123' }),
}))

vi.mock('../stores/comicStore', () => ({
  useComicStore: (sel: (s: { comics: Record<string, Comic> }) => unknown) =>
    sel({ comics: { '1': mockComic } }),
}))

vi.mock('../stores/readStore', () => ({
  useReadStore: (sel: (s: { progress: Record<string, ReadingProgress> }) => unknown) =>
    sel({ progress: {} }),
}))

vi.mock('../stores/blossomStore', () => ({
  useBlossomStore: (sel: (s: { primaryServer: () => string | undefined }) => unknown) =>
    sel({ primaryServer: () => 'https://blossom.example' }),
}))

describe('LibraryScreen', () => {
  it('renders comic titles in the grid', () => {
    render(<LibraryScreen />, { wrapper: MemoryRouter })
    expect(screen.getByText('One Piece')).toBeInTheDocument()
  })

  it('does not show continue reading when no progress', () => {
    render(<LibraryScreen />, { wrapper: MemoryRouter })
    expect(screen.queryByText(/continue reading/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/test/LibraryScreen.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement LibraryScreen**

Replace `src/screens/Library/index.tsx`:

```tsx
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useNostr } from '../../context/NostrContext'
import { useAuthStore } from '../../stores/authStore'
import { useComicStore } from '../../stores/comicStore'
import { useReadStore } from '../../stores/readStore'
import { useBlossomStore } from '../../stores/blossomStore'
import type { Comic } from '../../types'

function coverUrl(hash: string, server: string | undefined) {
  if (!server || !hash) return null
  return `${server}/blob/${hash}`
}

export function LibraryScreen() {
  const { service } = useNostr()
  const pubkey = useAuthStore((s) => s.pubkey)
  const comics = useComicStore((s) => s.comics)
  const setComic = useComicStore((s) => s.setComic)
  const progress = useReadStore((s) => s.progress)
  const primaryServer = useBlossomStore((s) => s.primaryServer)

  useEffect(() => {
    if (!pubkey) return
    const sub = service.subscribeToUserComics(pubkey, (event) => {
      const titleTag = (event.tags as string[][]).find(([t]) => t === 'title')
      const dTag = (event.tags as string[][]).find(([t]) => t === 'd')
      const coverTag = (event.tags as string[][]).find(([t]) => t === 'cover')
      const authorTag = (event.tags as string[][]).find(([t]) => t === 'author')
      if (!dTag) return
      setComic({
        id: event.id ?? dTag[1],
        pubkey: event.pubkey,
        dTag: dTag[1],
        title: titleTag?.[1] ?? 'Untitled',
        author: authorTag?.[1] ?? '',
        description: '',
        coverHash: coverTag?.[1] ?? '',
        blossomServer: primaryServer() ?? '',
        tags: [],
        eventId: event.id ?? '',
      })
    })
    return () => sub.unsubscribe()
  }, [pubkey, service, setComic, primaryServer])

  const allComics = Object.values(comics)

  const latestProgress = Object.values(progress).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )[0]
  const continueComic = latestProgress
    ? allComics.find((c) => latestProgress.chapterDTag.startsWith(c.dTag))
    : null

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Library</h1>
        <Link to="/settings" className="text-zinc-400 text-sm">⚙</Link>
      </div>

      {continueComic && latestProgress && (
        <div className="mb-6">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Continue Reading</p>
          <Link
            to={`/comic/${continueComic.dTag}/chapter/${latestProgress.chapterDTag}`}
            className="flex gap-3 items-center bg-zinc-900 rounded-xl p-3"
          >
            <CoverImage comic={continueComic} server={primaryServer()} size="sm" />
            <div>
              <p className="font-semibold text-sm">{continueComic.title}</p>
              <p className="text-xs text-indigo-400 mt-1">
                p.{latestProgress.page} → Continue
              </p>
            </div>
          </Link>
        </div>
      )}

      {allComics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
          <p className="text-lg mb-2">No comics yet</p>
          <Link to="/upload" className="text-indigo-400 text-sm">Upload one →</Link>
        </div>
      ) : (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3">
            {continueComic ? 'All Comics' : ''}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {allComics.map((comic) => (
              <Link key={comic.id} to={`/comic/${comic.dTag}`} className="flex flex-col">
                <CoverImage comic={comic} server={primaryServer()} size="lg" />
                <p className="text-xs text-zinc-300 mt-1 leading-tight line-clamp-2">
                  {comic.title}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CoverImage({
  comic,
  server,
  size,
}: {
  comic: Comic
  server: string | undefined
  size: 'sm' | 'lg'
}) {
  const url = coverUrl(comic.coverHash, server)
  const cls =
    size === 'lg'
      ? 'w-full aspect-[2/3] rounded-lg object-cover bg-zinc-800'
      : 'w-10 h-14 rounded object-cover bg-zinc-800 flex-shrink-0'
  return url ? (
    <img src={url} alt={comic.title} className={cls} />
  ) : (
    <div className={cls} />
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/LibraryScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Type-check and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/Library/index.tsx src/test/LibraryScreen.test.tsx
git commit -m "feat: implement Library screen with continue-reading hero"
```

---

## Task 8: Smoke test + startup restoration

**Files:**
- Modify: `src/context/NostrContext.tsx`
- Modify: `src/test/smoke.test.ts`

- [ ] **Step 1: Add startup restoration to NostrProvider**

Open `src/context/NostrContext.tsx` and extend `NostrProvider` to restore nsec from sessionStorage on mount:

```tsx
import { createContext, useContext, useEffect, useRef, type PropsWithChildren } from 'react'
import { EventStoreProvider, AccountsProvider } from 'applesauce-react'
import { PrivateKeySigner } from 'applesauce-signers'
import { PrivateKeyAccount } from 'applesauce-accounts'
import { NostrService } from '../services/NostrService'
import { useAuthStore } from '../stores/authStore'

interface NostrContextValue {
  service: NostrService
}

const NostrContext = createContext<NostrContextValue | null>(null)

export function NostrProvider({ children }: PropsWithChildren) {
  const serviceRef = useRef(new NostrService())
  const service = serviceRef.current
  const pubkey = useAuthStore((s) => s.pubkey)
  const setPubkey = useAuthStore((s) => s.setPubkey)

  useEffect(() => {
    service.connect()
    return () => { service.disconnect() }
  }, [service])

  // Restore nsec session on page reload
  useEffect(() => {
    if (!pubkey) return
    const stored = sessionStorage.getItem('nsec')
    if (!stored) return
    try {
      const signer = PrivateKeySigner.fromKey(stored)
      const account = new PrivateKeyAccount(pubkey, signer)
      service.accountManager.addAccount(account)
      service.accountManager.setActive(account)
    } catch {
      setPubkey(null)
    }
  }, [pubkey, service, setPubkey])

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
  const ctx = useContext(NostrContext)
  if (!ctx) throw new Error('useNostr must be used inside NostrProvider')
  return ctx
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Final commit**

```bash
git add src/context/NostrContext.tsx
git commit -m "feat: restore nsec session on reload in NostrProvider"
```
