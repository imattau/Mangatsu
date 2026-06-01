# Feed + BottomNav + Add to Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Feed screen (Follows/Global tabs), a persistent BottomNav bar, and "Add to Library" on ComicDetail for foreign comics.

**Architecture:** FeedScreen subscribes to kind 30402 events globally or filtered by kind-3 follows. BottomNav wraps ProtectedRoute children in router.tsx. ComicDetail reads a `?pubkey=` query param to load foreign comics and offer an "Add to Library" button. All new services go through the existing `NostrService` singleton pattern; all screens subscribe via `useObservableState` on `eventStore`.

**Tech Stack:** React + Vite, react-router-dom v6, applesauce-core/relay/react, zustand, TypeScript, Tailwind CSS, Vitest + @testing-library/react.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/services/NostrService.ts` | Modify | Add `subscribeToGlobalComics`, `subscribeToContactList`, `subscribeToComicsByAuthors` |
| `src/screens/Feed/index.tsx` | Create | FeedScreen with Follows/Global tabs |
| `src/components/BottomNav.tsx` | Create | Persistent bottom navigation bar |
| `src/components/AppLayout.tsx` | Create | Layout wrapper that renders `<Outlet />` above `<BottomNav />` |
| `src/screens/ComicDetail/index.tsx` | Modify | Read `?pubkey=` param, subscribe to foreign comic, show Add to Library button |
| `src/router.tsx` | Modify | Add `/feed` route; wrap ProtectedRoute children with AppLayout |
| `src/test/FeedScreen.test.tsx` | Create | Tests for FeedScreen |
| `src/test/BottomNav.test.tsx` | Create | Tests for BottomNav |

---

### Task 1: Extend NostrService with feed/contact subscriptions

**Files:**
- Modify: `src/services/NostrService.ts`

- [ ] **Step 1: Add three new subscription methods**

Replace the content after the existing `subscribeToChapters` method (before the closing `}` of the class) in `src/services/NostrService.ts`:

```typescript
  subscribeToGlobalComics(onEvent?: (event: NostrEvent) => void): Subscription {
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [30402], limit: 50 }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToContactList(
    pubkey: string,
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [3], authors: [pubkey], limit: 1 }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToComicsByAuthors(
    authors: string[],
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    if (authors.length === 0) {
      // Return a no-op subscription
      return { unsubscribe: () => {} } as Subscription
    }
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [30402], authors, limit: 50 }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToForeignComic(
    pubkey: string,
    dTag: string,
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [30402], authors: [pubkey], '#d': [dTag] }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  async publishEvent(event: NostrEvent): Promise<void> {
    await this.relayPool.publish(DEFAULT_RELAYS, event)
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors (or only pre-existing errors unrelated to NostrService).

- [ ] **Step 3: Commit**

```bash
cd /home/mattthomson/workspace/Mangatsu && git add src/services/NostrService.ts && git commit -m "feat: add global/contact/foreign comic subscriptions to NostrService"
```

---

### Task 2: Create BottomNav component + AppLayout

**Files:**
- Create: `src/components/BottomNav.tsx`
- Create: `src/components/AppLayout.tsx`

- [ ] **Step 1: Write the failing BottomNav test**

Create `src/test/BottomNav.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'

function Wrapper({ path = '/' }: { path?: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>
  )
}

describe('BottomNav', () => {
  it('renders Library and Feed nav items', () => {
    render(<Wrapper />)
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.getByText('Feed')).toBeInTheDocument()
  })

  it('Library link points to /', () => {
    render(<Wrapper />)
    const libraryLink = screen.getByText('Library').closest('a')
    expect(libraryLink).toHaveAttribute('href', '/')
  })

  it('Feed link points to /feed', () => {
    render(<Wrapper />)
    const feedLink = screen.getByText('Feed').closest('a')
    expect(feedLink).toHaveAttribute('href', '/feed')
  })

  it('Library tab is active on / route', () => {
    render(<Wrapper path="/" />)
    const libraryLink = screen.getByText('Library').closest('a')
    expect(libraryLink).toHaveClass('text-white')
  })

  it('Feed tab is active on /feed route', () => {
    render(<Wrapper path="/feed" />)
    const feedLink = screen.getByText('Feed').closest('a')
    expect(feedLink).toHaveClass('text-white')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test -- src/test/BottomNav.test.tsx 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module '../components/BottomNav'"

- [ ] **Step 3: Create BottomNav component**

Create `src/components/BottomNav.tsx`:

```tsx
import { Link, useLocation } from 'react-router-dom'

const TABS = [
  { label: 'Library', href: '/', icon: '📚' },
  { label: 'Feed', href: '/feed', icon: '🔍' },
]

export function BottomNav() {
  const { pathname } = useLocation()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
      {TABS.map(({ label, href, icon }) => {
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            to={href}
            className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs transition ${
              isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className="text-lg leading-none">{icon}</span>
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 4: Create AppLayout component**

Create `src/components/AppLayout.tsx`:

```tsx
import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function AppLayout() {
  return (
    <>
      <div className="pb-16">
        <Outlet />
      </div>
      <BottomNav />
    </>
  )
}
```

- [ ] **Step 5: Run BottomNav tests**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test -- src/test/BottomNav.test.tsx 2>&1 | tail -20
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/mattthomson/workspace/Mangatsu && git add src/components/BottomNav.tsx src/components/AppLayout.tsx src/test/BottomNav.test.tsx && git commit -m "feat: add BottomNav and AppLayout components"
```

---

### Task 3: Wire AppLayout and /feed route into router

**Files:**
- Modify: `src/router.tsx`

- [ ] **Step 1: Update router.tsx**

Replace the entire file content of `src/router.tsx`:

```tsx
/* eslint-disable react-refresh/only-export-components */
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { LoginScreen } from '@/screens/Login'
import { LibraryScreen } from '@/screens/Library'
import { ComicDetailScreen } from '@/screens/ComicDetail'
import { ReaderScreen } from '@/screens/Reader'
import { UploadScreen } from '@/screens/Upload'
import { SettingsScreen } from '@/screens/Settings'
import { FeedScreen } from '@/screens/Feed'
import { AppLayout } from '@/components/AppLayout'
import { useAuthStore } from '@/stores/authStore'

function ProtectedRoute() {
  const pubkey = useAuthStore((state) => state.pubkey)
  return pubkey ? <Outlet /> : <Navigate to="/login" replace />
}

function LoginRoute() {
  const pubkey = useAuthStore((state) => state.pubkey)
  return pubkey ? <Navigate to="/" replace /> : <LoginScreen />
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginRoute /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <LibraryScreen /> },
          { path: '/feed', element: <FeedScreen /> },
          { path: '/comic/:dTag', element: <ComicDetailScreen /> },
          { path: '/comic/:dTag/chapter/:chapterId', element: <ReaderScreen /> },
          { path: '/upload', element: <UploadScreen /> },
          { path: '/settings', element: <SettingsScreen /> },
        ],
      },
    ],
  },
])
```

- [ ] **Step 2: Create placeholder FeedScreen (so tsc doesn't fail)**

Create `src/screens/Feed/index.tsx` with a temporary stub:

```tsx
export function FeedScreen() {
  return <div>Feed</div>
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
cd /home/mattthomson/workspace/Mangatsu && git add src/router.tsx src/screens/Feed/index.tsx && git commit -m "feat: add /feed route and AppLayout wrapper to router"
```

---

### Task 4: Build FeedScreen (tests first)

**Files:**
- Create: `src/test/FeedScreen.test.tsx`
- Modify: `src/screens/Feed/index.tsx`

- [ ] **Step 1: Write failing FeedScreen tests**

Create `src/test/FeedScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FeedScreen } from '../screens/Feed'
import type { NostrEvent } from 'applesauce-core/helpers/event'

// Minimal mock comic events
const mockComicEvent: NostrEvent = {
  id: 'ev1',
  pubkey: 'pubkey1',
  kind: 30402,
  created_at: 1700000000,
  tags: [
    ['d', 'dragon-ball'],
    ['title', 'Dragon Ball'],
    ['author', 'Toriyama'],
  ],
  content: '',
  sig: 'sig1',
}

let mockObservableState: NostrEvent[] | null = []

vi.mock('applesauce-react/hooks', () => ({
  useEventStore: () => ({
    timeline: vi.fn(() => ({ subscribe: vi.fn() })),
    replaceable: vi.fn(() => ({ subscribe: vi.fn() })),
  }),
  useObservableState: () => mockObservableState,
}))

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      subscribeToGlobalComics: vi.fn(() => ({ unsubscribe: vi.fn() })),
      subscribeToContactList: vi.fn(() => ({ unsubscribe: vi.fn() })),
      subscribeToComicsByAuthors: vi.fn(() => ({ unsubscribe: vi.fn() })),
    },
  }),
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string | null }) => unknown) =>
    sel({ pubkey: 'mypubkey' }),
}))

vi.mock('../stores/blossomStore', () => ({
  useBlossomStore: (sel: (s: { primaryServer: () => string | undefined }) => unknown) =>
    sel({ primaryServer: () => 'https://blossom.example' }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('FeedScreen', () => {
  beforeEach(() => {
    mockObservableState = []
  })

  it('renders Global and Follows tabs', () => {
    render(<FeedScreen />, { wrapper: Wrapper })
    expect(screen.getByText('Global')).toBeInTheDocument()
    expect(screen.getByText('Follows')).toBeInTheDocument()
  })

  it('shows empty state when no global comics', () => {
    mockObservableState = []
    render(<FeedScreen />, { wrapper: Wrapper })
    expect(screen.getByText(/no comics found/i)).toBeInTheDocument()
  })

  it('shows comic title in global tab when events present', () => {
    mockObservableState = [mockComicEvent]
    render(<FeedScreen />, { wrapper: Wrapper })
    expect(screen.getByText('Dragon Ball')).toBeInTheDocument()
  })

  it('clicking Follows tab shows follows empty state when no contacts', async () => {
    mockObservableState = []
    const user = userEvent.setup()
    render(<FeedScreen />, { wrapper: Wrapper })
    await user.click(screen.getByText('Follows'))
    expect(
      screen.getByText(/follow people on nostr/i),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test -- src/test/FeedScreen.test.tsx 2>&1 | tail -25
```

Expected: FAIL (stub renders `<div>Feed</div>` not matching expectations).

- [ ] **Step 3: Implement FeedScreen**

Replace `src/screens/Feed/index.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore } from '@/stores/blossomStore'
import type { Comic } from '@/types'

// ---------------------------------------------------------------------------
// Helpers (same as LibraryScreen)
// ---------------------------------------------------------------------------

function parseTag(event: NostrEvent, name: string) {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

function parseAnyTag(event: NostrEvent, names: string[]) {
  for (const name of names) {
    const value = parseTag(event, name)
    if (value) return value
  }
  return ''
}

function parseComicEvent(event: NostrEvent, server: string | undefined): Comic | null {
  const dTag = parseTag(event, 'd')
  if (!dTag) return null
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: parseTag(event, 'title') || event.content || 'Untitled',
    author: parseTag(event, 'author'),
    description: parseTag(event, 'description') || event.content || '',
    coverHash: parseAnyTag(event, ['cover', 'cover_hash', 'image']),
    blossomServer: parseAnyTag(event, ['blossom', 'blossom_server']) || server || '',
    tags: event.tags.filter((t) => t[0] === 't').map((t) => t[1]).filter(Boolean),
    eventId: event.id,
  }
}

function coverUrl(hash: string, server: string | undefined) {
  if (!hash || !server) return null
  return `${server.replace(/\/$/, '')}/blob/${hash}`
}

function parseFollowedPubkeys(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === 'p').map((t) => t[1]).filter(Boolean)
}

const EMPTY_EVENTS: NostrEvent[] = []
type Tab = 'global' | 'follows'

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function FeedScreen() {
  const { service } = useNostr()
  const eventStore = useEventStore()
  const pubkey = useAuthStore((s) => s.pubkey)
  const primaryServer = useBlossomStore((s) => s.primaryServer)

  const [activeTab, setActiveTab] = useState<Tab>('global')
  const [followedPubkeys, setFollowedPubkeys] = useState<string[]>([])
  const [contactsLoaded, setContactsLoaded] = useState(false)

  // Subscribe to global comics
  useEffect(() => {
    const sub = service.subscribeToGlobalComics()
    return () => sub.unsubscribe()
  }, [service])

  // Subscribe to contact list (kind 3)
  useEffect(() => {
    if (!pubkey) return
    const sub = service.subscribeToContactList(pubkey, (event) => {
      const follows = parseFollowedPubkeys(event)
      setFollowedPubkeys(follows)
      setContactsLoaded(true)
    })
    // Mark contacts loaded after a short window even if no event arrives
    const timer = setTimeout(() => setContactsLoaded(true), 3000)
    return () => {
      sub.unsubscribe()
      clearTimeout(timer)
    }
  }, [pubkey, service])

  // Subscribe to follows' comics once we have the list
  useEffect(() => {
    if (followedPubkeys.length === 0) return
    const sub = service.subscribeToComicsByAuthors(followedPubkeys)
    return () => sub.unsubscribe()
  }, [followedPubkeys, service])

  // Reactive timelines
  const globalFilter = useMemo(() => [{ kinds: [30402], limit: 50 }], [])
  const globalTimeline$ = useMemo(
    () => eventStore.timeline(globalFilter),
    [eventStore, globalFilter],
  )
  const globalEvents = useObservableState(globalTimeline$) ?? EMPTY_EVENTS

  const followsFilter = useMemo(
    () => followedPubkeys.length > 0 ? [{ kinds: [30402], authors: followedPubkeys }] : null,
    [followedPubkeys],
  )
  const followsTimeline$ = useMemo(
    () => (followsFilter ? eventStore.timeline(followsFilter) : of([])),
    [eventStore, followsFilter],
  )
  const followsEvents = useObservableState(followsTimeline$) ?? EMPTY_EVENTS

  const server = primaryServer()

  const globalComics = useMemo(
    () => globalEvents.flatMap((e) => {
      const c = parseComicEvent(e, server)
      return c ? [c] : []
    }),
    [globalEvents, server],
  )

  const followsComics = useMemo(
    () => followsEvents.flatMap((e) => {
      const c = parseComicEvent(e, server)
      return c ? [c] : []
    }),
    [followsEvents, server],
  )

  const activeComics = activeTab === 'global' ? globalComics : followsComics

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 py-4 text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header>
          <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Feed</h1>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-1">
          {(['global', 'follows'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 rounded-xl py-2 text-sm font-medium transition capitalize ${
                activeTab === tab
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'global' ? 'Global' : 'Follows'}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'follows' && contactsLoaded && followedPubkeys.length === 0 ? (
          <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
            <p className="text-lg font-medium text-zinc-100">No follows yet</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
              Follow people on Nostr to see their comics here.
            </p>
          </section>
        ) : activeComics.length === 0 ? (
          <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
            <p className="text-lg font-medium text-zinc-100">No comics found</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
              Comics will appear here as relays sync.
            </p>
          </section>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {activeComics.map((comic) => (
              <Link
                key={`${comic.pubkey}:${comic.dTag}`}
                to={`/comic/${comic.dTag}?pubkey=${comic.pubkey}`}
                className="group flex flex-col gap-2 rounded-2xl transition hover:-translate-y-0.5"
              >
                <ComicCover comic={comic} server={comic.blossomServer || server} />
                <div className="px-0.5">
                  <p className="text-sm font-medium leading-5 text-zinc-100 group-hover:text-white">
                    {comic.title}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ComicCover({ comic, server }: { comic: Comic; server: string | undefined }) {
  const url = coverUrl(comic.coverHash, server)
  const className =
    'aspect-[2/3] w-full rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'
  if (!url) return <div className={className} />
  return <img src={url} alt={comic.title} loading="lazy" className={className} />
}
```

- [ ] **Step 4: Run FeedScreen tests**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test -- src/test/FeedScreen.test.tsx 2>&1 | tail -25
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/mattthomson/workspace/Mangatsu && git add src/screens/Feed/index.tsx src/test/FeedScreen.test.tsx && git commit -m "feat: implement FeedScreen with Global and Follows tabs"
```

---

### Task 5: Extend ComicDetail with foreign pubkey + Add to Library

**Files:**
- Modify: `src/screens/ComicDetail/index.tsx`

- [ ] **Step 1: Update ComicDetailScreen**

Replace `src/screens/ComicDetail/index.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useComicStore } from '@/stores/comicStore'
import { useReadStore } from '@/stores/readStore'
import { useBlossomStore } from '@/stores/blossomStore'
import type { Chapter, Comic } from '@/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTag(event: NostrEvent, name: string): string {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

function parseAnyTag(event: NostrEvent, names: string[]): string {
  for (const name of names) {
    const value = parseTag(event, name)
    if (value) return value
  }
  return ''
}

function parsePageHashes(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === 'page')
    .map((tag) => {
      const raw = tag[1] ?? ''
      return raw.startsWith('blossom://') ? raw.slice('blossom://'.length) : raw
    })
    .filter(Boolean)
}

function parseChapterEvent(event: NostrEvent, comicDTag: string): Chapter | null {
  const dTag = parseTag(event, 'd')
  if (!dTag || !dTag.startsWith(`${comicDTag}/`)) return null
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    parentDTag: comicDTag,
    title: parseTag(event, 'title') || dTag,
    pageHashes: parsePageHashes(event),
    blossomServer: parseTag(event, 'blossom'),
    publishedAt: event.created_at ?? 0,
    eventId: event.id,
  }
}

function parseComicEvent(event: NostrEvent, server: string | undefined): Comic | null {
  const dTag = parseTag(event, 'd')
  if (!dTag) return null
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: parseTag(event, 'title') || event.content || 'Untitled',
    author: parseTag(event, 'author'),
    description: parseTag(event, 'description') || event.content || '',
    coverHash: parseAnyTag(event, ['cover', 'cover_hash', 'image']),
    blossomServer: parseAnyTag(event, ['blossom', 'blossom_server']) || server || '',
    tags: event.tags.filter((t) => t[0] === 't').map((t) => t[1]).filter(Boolean),
    eventId: event.id,
  }
}

function chapterNumber(dTag: string): number {
  const match = dTag.match(/(\d+(?:\.\d+)?)$/)
  return match ? parseFloat(match[1]) : 0
}

function chapterLabel(dTag: string): string {
  const num = chapterNumber(dTag)
  return num > 0 ? `Chapter ${num}` : dTag.split('/').pop() ?? dTag
}

function coverUrl(hash: string, server: string | undefined): string | null {
  if (!hash || !server) return null
  return `${server.replace(/\/$/, '')}/blob/${hash}`
}

const EMPTY_EVENTS: NostrEvent[] = []

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function ComicDetailScreen() {
  const { dTag } = useParams<{ dTag: string }>()
  const [searchParams] = useSearchParams()
  const foreignPubkey = searchParams.get('pubkey')

  const { service } = useNostr()
  const eventStore = useEventStore()

  const myPubkey = useAuthStore((s) => s.pubkey)
  const comics = useComicStore((s) => s.comics)
  const setComic = useComicStore((s) => s.setComic)
  const setChapter = useComicStore((s) => s.setChapter)
  const chaptersForComic = useComicStore((s) => s.chaptersForComic)
  const progress = useReadStore((s) => s.progress)
  const primaryServer = useBlossomStore((s) => s.primaryServer)

  const [addedToLibrary, setAddedToLibrary] = useState(false)
  const [adding, setAdding] = useState(false)

  // Comic from store (own or previously cached)
  const storedComic: Comic | undefined = dTag ? comics[dTag] : undefined

  // Subscribe to foreign comic if pubkey param is present and we don't have it stored
  useEffect(() => {
    if (!dTag || !foreignPubkey) return
    const sub = service.subscribeToForeignComic(foreignPubkey, dTag)
    return () => sub.unsubscribe()
  }, [dTag, foreignPubkey, service])

  // Subscribe to chapters
  useEffect(() => {
    if (!dTag) return
    const sub = service.subscribeToChapters(dTag)
    return () => sub.unsubscribe()
  }, [dTag, service])

  // Live foreign comic event from eventStore
  const foreignComicFilter = useMemo(
    () =>
      dTag && foreignPubkey
        ? [{ kinds: [30402], authors: [foreignPubkey], '#d': [dTag] }]
        : null,
    [dTag, foreignPubkey],
  )
  const foreignTimeline$ = useMemo(
    () => (foreignComicFilter ? eventStore.timeline(foreignComicFilter) : of([])),
    [eventStore, foreignComicFilter],
  )
  const foreignEvents = useObservableState(foreignTimeline$) ?? EMPTY_EVENTS

  const foreignComic: Comic | null = useMemo(() => {
    for (const event of foreignEvents) {
      const c = parseComicEvent(event, primaryServer())
      if (c) return c
    }
    return null
  }, [foreignEvents, primaryServer])

  const comic: Comic | undefined = storedComic ?? foreignComic ?? undefined

  // Chapter live events
  const chapterFilter = useMemo(
    () => (dTag ? [{ kinds: [30403], '#d': [`${dTag}/`] }] : null),
    [dTag],
  )
  const chapterTimeline$ = useMemo(
    () => (chapterFilter ? eventStore.timeline(chapterFilter) : of([])),
    [eventStore, chapterFilter],
  )
  const liveChapterEvents = useObservableState(chapterTimeline$) ?? EMPTY_EVENTS

  useEffect(() => {
    if (!dTag) return
    for (const event of liveChapterEvents) {
      const chapter = parseChapterEvent(event, dTag)
      if (chapter) setChapter(chapter)
    }
  }, [liveChapterEvents, dTag, setChapter])

  const chapters = useMemo(() => {
    if (!dTag) return []
    return chaptersForComic(dTag)
      .slice()
      .sort((a, b) => chapterNumber(a.dTag) - chapterNumber(b.dTag))
  }, [chaptersForComic, dTag])

  const server = comic?.blossomServer || primaryServer()

  const isForeign =
    foreignPubkey !== null && foreignPubkey !== myPubkey

  async function handleAddToLibrary() {
    if (!comic || !dTag) return
    setAdding(true)
    try {
      // Build tags for the new event copying comic metadata
      const tags: string[][] = [
        ['d', comic.dTag],
        ['title', comic.title],
      ]
      if (comic.author) tags.push(['author', comic.author])
      if (comic.description) tags.push(['description', comic.description])
      if (comic.coverHash) tags.push(['cover', comic.coverHash])
      if (comic.blossomServer) tags.push(['blossom', comic.blossomServer])
      for (const tag of comic.tags) {
        tags.push(['t', tag])
      }

      const template = { kind: 30402 as const, tags, content: '' }
      const signed = await service.eventFactory.build(template)
      if (signed) {
        await service.publishEvent(signed as NostrEvent)
        setComic({ ...comic, pubkey: myPubkey ?? comic.pubkey })
        setAddedToLibrary(true)
      }
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 py-4 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6">

        <Link
          to="/"
          className="self-start rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-white"
        >
          ← Library
        </Link>

        {comic ? (
          <header className="flex gap-4 items-end">
            <CoverImage hash={comic.coverHash} server={server} title={comic.title} />
            <div className="flex-1 min-w-0">
              <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">
                {comic.author || 'Unknown author'}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight leading-tight">
                {comic.title}
              </h1>
              <p className="mt-1 text-sm text-zinc-400">
                {chapters.length} chapter{chapters.length !== 1 ? 's' : ''}
              </p>
              {isForeign && !addedToLibrary && (
                <button
                  onClick={() => void handleAddToLibrary()}
                  disabled={adding}
                  className="mt-3 rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
                >
                  {adding ? 'Adding…' : 'Add to Library'}
                </button>
              )}
              {addedToLibrary && (
                <p className="mt-3 text-sm text-emerald-400">Added to your library</p>
              )}
            </div>
          </header>
        ) : (
          <header>
            <div className="h-6 w-40 rounded bg-zinc-800 animate-pulse" />
          </header>
        )}

        {chapters.length === 0 ? (
          <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
            <p className="text-lg font-medium text-zinc-100">No chapters yet</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
              Chapters will appear here once your relays sync this comic.
            </p>
          </section>
        ) : (
          <section className="space-y-2">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Chapters</p>
            <ul className="flex flex-col gap-2">
              {chapters.map((chapter) => {
                const chapterProgress = progress[chapter.dTag]
                return (
                  <li key={chapter.dTag}>
                    <Link
                      to={`/comic/${dTag}/chapter/${encodeURIComponent(chapter.dTag)}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 transition hover:border-zinc-600 hover:bg-zinc-900/80"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-zinc-500">{chapterLabel(chapter.dTag)}</p>
                        <p className="mt-0.5 truncate text-sm font-medium text-zinc-100">
                          {chapter.title}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-600">
                          {chapter.pageHashes.length} page{chapter.pageHashes.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {chapterProgress && (
                          <span className="rounded-full bg-indigo-500/20 border border-indigo-500/40 px-2.5 py-1 text-xs font-medium text-indigo-300">
                            Continue
                          </span>
                        )}
                        <svg
                          className="h-4 w-4 text-zinc-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CoverImage({
  hash,
  server,
  title,
}: {
  hash: string
  server: string | undefined
  title: string
}) {
  const url = coverUrl(hash, server)
  const className =
    'aspect-[2/3] w-20 flex-shrink-0 rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'
  if (!url) return <div className={className} />
  return <img src={url} alt={title} loading="lazy" className={className} />
}
```

- [ ] **Step 2: Update ComicDetailScreen mock in test to include new deps**

The existing `src/test/ComicDetailScreen.test.tsx` mocks `useNostr` returning `subscribeToChapters`. We need to also mock `subscribeToForeignComic` and `publishEvent`. Open `src/test/ComicDetailScreen.test.tsx` and update the `useNostr` mock:

```typescript
vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      subscribeToChapters: vi.fn(() => ({ unsubscribe: vi.fn() })),
      subscribeToForeignComic: vi.fn(() => ({ unsubscribe: vi.fn() })),
      publishEvent: vi.fn(),
      eventFactory: { build: vi.fn() },
    },
  }),
}))
```

Also update `useAuthStore` mock to include `pubkey`:

```typescript
vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string | null }) => unknown) =>
    sel({ pubkey: 'abc' }),
}))
```

And update the `useComicStore` mock to include `setComic`:

```typescript
vi.mock('../stores/comicStore', () => ({
  useComicStore: (sel: (s: {
    comics: Record<string, Comic>
    chapters: Record<string, Chapter>
    setComic: (c: Comic) => void
    setChapter: (c: Chapter) => void
    chaptersForComic: (dTag: string) => Chapter[]
  }) => unknown) =>
    sel({
      comics: { 'one-piece': mockComic },
      chapters: {},
      setComic: vi.fn(),
      setChapter: vi.fn(),
      chaptersForComic: () => mockChapters,
    }),
}))
```

- [ ] **Step 3: Run all tests**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test 2>&1 | tail -30
```

Expected: All tests pass.

- [ ] **Step 4: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 5: Lint**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm run lint 2>&1 | tail -20
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd /home/mattthomson/workspace/Mangatsu && git add src/screens/ComicDetail/index.tsx src/test/ComicDetailScreen.test.tsx && git commit -m "feat: support foreign pubkey + Add to Library in ComicDetailScreen"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test 2>&1 | tail -30
```

Expected: All tests pass with no failures.

- [ ] **Step 2: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1
```

Expected: No output (no errors).

- [ ] **Step 3: Lint**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm run lint 2>&1
```

Expected: No errors.

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered in Task |
|---|---|
| Feed screen at /feed | Task 3, 4 |
| Global tab – kind 30402 limit 50 | Task 1, 4 |
| Follows tab – kind 3 contact list then kind 30402 by authors | Task 1, 4 |
| No follows empty state | Task 4 |
| 3-column cover grid | Task 4 |
| Tap comic → /comic/:dTag?pubkey= | Task 4 |
| Empty state per tab | Task 4 |
| ComicDetail reads ?pubkey= | Task 5 |
| Subscribe to foreign kind 30402 | Task 1, 5 |
| Add to Library button when foreign | Task 5 |
| Add to Library publishes kind 30402 | Task 5 |
| BottomNav with Library + Feed | Task 2 |
| Active tab highlighted | Task 2 |
| BottomNav inside ProtectedRoute | Task 3 |
| /feed route added | Task 3 |
| FeedScreen tests | Task 4 |
| BottomNav tests | Task 2 |
| All tests pass | Task 6 |
| tsc --noEmit passes | Task 6 |
| npm run lint passes | Task 6 |

**Type consistency:** `parseComicEvent`, `parseTag`, `parseAnyTag`, `Comic`, `Chapter` — all defined consistently across tasks. `subscribeToForeignComic` added in Task 1 and used in Task 5. `publishEvent` added in Task 1 and used in Task 5. `setComic` already exists in comicStore.

**Placeholder scan:** No TBDs, no "add appropriate handling" without code.
