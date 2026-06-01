# Reader Screen — Implementation Plan

**Goal:** Implement the `ReaderScreen` at `/comic/:dTag/chapter/:chapterId` — a full-featured webtoon-style (vertical scroll) manga reader with Intersection-Observer progress tracking, debounced Nostr kind-30301 publish, and prev/next chapter navigation.

**Architecture:** The screen is purely read-side. Chapter data flows from `comicStore` (already populated by `ComicDetailScreen`). Blossom hashes are resolved to HTTPS URLs using `blossomStore.primaryServer()` or the chapter's own `blossomServer`. Progress is written to `readStore` and asynchronously published to Nostr via `nostrService`.

**Tech stack:** React 18, TypeScript, Vite, react-router-dom v6, Zustand, Vitest + Testing Library, Tailwind CSS, Web APIs (IntersectionObserver, debounce via `setTimeout`).

---

## File Map

| Path | Action | Purpose |
|---|---|---|
| `src/screens/Reader/index.tsx` | Create | Screen component — layout, page list, header, nav |
| `src/screens/Reader/usePageObserver.ts` | Create | Encapsulates IntersectionObserver logic |
| `src/screens/Reader/useProgressPublisher.ts` | Create | Debounced Nostr kind-30301 publish |
| `src/test/ReaderScreen.test.tsx` | Create | Vitest + Testing Library tests |

---

## Shared Test Fixtures (used in every task)

These mocks go at the top of `src/test/ReaderScreen.test.tsx` and are established in Task 1. Later tasks add to the same file.

```typescript
// src/test/ReaderScreen.test.tsx
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Chapter, ReadingProgress } from '../types'

// ── Fixtures ────────────────────────────────────────────────────────────────

const mockChapter1: Chapter = {
  id: 'ch1',
  pubkey: 'abc',
  dTag: 'one-piece/chapter-1',
  parentDTag: 'one-piece',
  title: 'Romance Dawn',
  pageHashes: ['hash1', 'hash2', 'hash3'],
  blossomServer: 'https://blossom.example',
  publishedAt: 1700000000,
  eventId: 'ch1',
}

const mockChapter2: Chapter = {
  id: 'ch2',
  pubkey: 'abc',
  dTag: 'one-piece/chapter-2',
  parentDTag: 'one-piece',
  title: 'Luffy',
  pageHashes: ['hash4', 'hash5'],
  blossomServer: 'https://blossom.example',
  publishedAt: 1700001000,
  eventId: 'ch2',
}

let mockChapters: Chapter[] = [mockChapter1, mockChapter2]
let mockProgress: Record<string, ReadingProgress> = {}
let mockSetProgress = vi.fn()
let mockPrimaryServer = vi.fn(() => 'https://blossom.example')

vi.mock('../stores/comicStore', () => ({
  useComicStore: (sel: Parameters<typeof import('../stores/comicStore').useComicStore>[0]) =>
    sel({
      comics: {},
      chapters: {},
      setComic: vi.fn(),
      setChapter: vi.fn(),
      chaptersForComic: () => mockChapters,
    } as ReturnType<Parameters<typeof import('../stores/comicStore').useComicStore>[0]>),
}))

vi.mock('../stores/readStore', () => ({
  useReadStore: (sel: Parameters<typeof import('../stores/readStore').useReadStore>[0]) =>
    sel({ progress: mockProgress, setProgress: mockSetProgress }),
}))

vi.mock('../stores/blossomStore', () => ({
  useBlossomStore: (sel: Parameters<typeof import('../stores/blossomStore').useBlossomStore>[0]) =>
    sel({
      servers: [],
      cachedHashes: {},
      setServers: vi.fn(),
      setCachedHash: vi.fn(),
      primaryServer: mockPrimaryServer,
    }),
}))

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      eventFactory: { build: vi.fn().mockResolvedValue({ kind: 30301, tags: [], content: '', created_at: 0, pubkey: '' }) },
      accountManager: { active: { signer: { signEvent: vi.fn().mockResolvedValue({ sig: 'sig' }) } } },
      relayPool: { group: vi.fn().mockReturnValue({ publish: vi.fn() }) },
    },
  }),
}))

// ── Render helper ────────────────────────────────────────────────────────────

function renderReader(dTag = 'one-piece', chapterId = encodeURIComponent('one-piece/chapter-1')) {
  return render(
    <MemoryRouter initialEntries={[`/comic/${dTag}/chapter/${chapterId}`]}>
      <Routes>
        <Route path="/comic/:dTag/chapter/:chapterId" element={<ReaderScreen />} />
        <Route path="/comic/:dTag" element={<div data-testid="comic-detail" />} />
      </Routes>
    </MemoryRouter>,
  )
}
```

> **Note:** Add `import { ReaderScreen } from '../screens/Reader'` once the file exists (Task 2).

---

## Tasks

### Task 1 — Test file scaffolding + empty-state test

**Objective:** Establish the test file with fixtures and verify that an empty state (chapter not found) renders correctly.

#### Step 1 — Failing test

Create `src/test/ReaderScreen.test.tsx` with the shared fixtures above (minus the `ReaderScreen` import, which does not exist yet). Add this first describe block:

```typescript
// Temporary stub so imports don't crash before Task 2
vi.mock('../screens/Reader', () => ({
  ReaderScreen: () => <div data-testid="reader-stub" />,
}))

describe('ReaderScreen — not found', () => {
  it('renders stub without crashing', () => {
    render(
      <MemoryRouter initialEntries={['/comic/foo/chapter/bar']}>
        <Routes>
          <Route path="/comic/:dTag/chapter/:chapterId" element={<ReaderScreen />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('reader-stub')).toBeInTheDocument()
  })
})
```

Run: `npm test -- src/test/ReaderScreen.test.tsx` — should pass (stub mock).

#### Step 2 — Implement empty state in the real component

Create `src/screens/Reader/index.tsx`:

```typescript
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useComicStore } from '@/stores/comicStore'
import { useReadStore } from '@/stores/readStore'
import { useBlossomStore } from '@/stores/blossomStore'

function resolvePageUrl(hash: string, server: string): string {
  return `${server.replace(/\/$/, '')}/blob/${hash}`
}

function chapterNumber(dTag: string): number {
  const match = dTag.match(/(\d+(?:\.\d+)?)$/)
  return match ? parseFloat(match[1]) : 0
}

export function ReaderScreen() {
  const { dTag, chapterId } = useParams<{ dTag: string; chapterId: string }>()
  const chapterDTag = chapterId ? decodeURIComponent(chapterId) : ''

  const chaptersForComic = useComicStore((s) => s.chaptersForComic)
  const primaryServer = useBlossomStore((s) => s.primaryServer)

  const allChapters = useMemo(
    () =>
      dTag
        ? chaptersForComic(dTag)
            .slice()
            .sort((a, b) => chapterNumber(a.dTag) - chapterNumber(b.dTag))
        : [],
    [chaptersForComic, dTag],
  )

  const chapter = allChapters.find((c) => c.dTag === chapterDTag)
  const chapterIndex = allChapters.findIndex((c) => c.dTag === chapterDTag)
  const prevChapter = chapterIndex > 0 ? allChapters[chapterIndex - 1] : null
  const nextChapter =
    chapterIndex >= 0 && chapterIndex < allChapters.length - 1
      ? allChapters[chapterIndex + 1]
      : null

  const server = chapter?.blossomServer || primaryServer() || ''
  const pageUrls = useMemo(
    () => (chapter ? chapter.pageHashes.map((h) => resolvePageUrl(h, server)) : []),
    [chapter, server],
  )

  if (!chapter) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="text-center">
          <p className="text-lg font-medium text-zinc-100">Chapter not found</p>
          {dTag && (
            <Link
              to={`/comic/${dTag}`}
              className="mt-4 inline-block text-sm text-indigo-400 hover:text-indigo-300"
            >
              ← Back to comic
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur">
        <Link
          to={`/comic/${dTag}`}
          className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-white"
        >
          ← Back
        </Link>
        <div className="flex-1 min-w-0 text-center">
          <p className="truncate text-sm font-medium">{chapter.title}</p>
        </div>
        <PageCounter current={1} total={pageUrls.length} />
      </header>

      {/* Pages */}
      <main className="mx-auto max-w-2xl">
        {pageUrls.map((url, idx) => (
          <img
            key={url}
            src={url}
            alt={`Page ${idx + 1}`}
            className="block w-full"
            loading={idx === 0 ? 'eager' : 'lazy'}
          />
        ))}
      </main>

      {/* Chapter navigation */}
      <nav className="flex items-center justify-between border-t border-zinc-800 px-4 py-6">
        {prevChapter ? (
          <Link
            to={`/comic/${dTag}/chapter/${encodeURIComponent(prevChapter.dTag)}`}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm transition hover:border-zinc-500"
          >
            ← Prev
          </Link>
        ) : (
          <span />
        )}
        {nextChapter ? (
          <Link
            to={`/comic/${dTag}/chapter/${encodeURIComponent(nextChapter.dTag)}`}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm transition hover:border-zinc-500"
          >
            Next →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  )
}

function PageCounter({ current, total }: { current: number; total: number }) {
  return (
    <span className="flex-shrink-0 rounded-full bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400">
      {current} / {total}
    </span>
  )
}
```

Also create `src/screens/Reader/usePageObserver.ts` (stub for now):

```typescript
// Stub — implemented in Task 3
export function usePageObserver(_refs: React.RefObject<HTMLImageElement | null>[], _onVisible: (idx: number) => void) {
  // no-op stub
}
```

And `src/screens/Reader/useProgressPublisher.ts` (stub):

```typescript
// Stub — implemented in Task 4
export function useProgressPublisher(_chapterDTag: string, _currentPage: number) {
  // no-op stub
}
```

#### Step 3 — Update test file to import real component and test empty state

Remove the `vi.mock('../screens/Reader', ...)` stub. Add real import and proper tests:

```typescript
import { ReaderScreen } from '../screens/Reader'

describe('ReaderScreen — chapter not found', () => {
  beforeEach(() => {
    mockChapters = []
  })
  afterEach(() => {
    mockChapters = [mockChapter1, mockChapter2]
  })

  it('shows "Chapter not found" when chapterId does not match', () => {
    renderReader('one-piece', 'one-piece%2Fchapter-99')
    expect(screen.getByText('Chapter not found')).toBeInTheDocument()
  })

  it('shows back link to comic detail', () => {
    renderReader('one-piece', 'one-piece%2Fchapter-99')
    expect(screen.getByRole('link', { name: /back to comic/i })).toHaveAttribute(
      'href',
      '/comic/one-piece',
    )
  })
})
```

Run: `npm test -- src/test/ReaderScreen.test.tsx` — all pass.

#### Step 4 — Commit

```
git add src/screens/Reader/index.tsx src/screens/Reader/usePageObserver.ts src/screens/Reader/useProgressPublisher.ts src/test/ReaderScreen.test.tsx
git commit -m "feat: add Reader screen scaffold with empty state"
```

---

### Task 2 — Page list rendering + URL resolution + header

**Objective:** Verify pages render as `<img>` tags with correctly-resolved Blossom URLs; verify the header shows chapter title and back button.

#### Step 1 — Failing tests

Add to `src/test/ReaderScreen.test.tsx`:

```typescript
describe('ReaderScreen — page rendering', () => {
  beforeEach(() => {
    mockChapters = [mockChapter1, mockChapter2]
    mockPrimaryServer = vi.fn(() => 'https://blossom.example')
  })

  it('renders one img per page hash', () => {
    renderReader()
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(mockChapter1.pageHashes.length)
  })

  it('resolves page URLs via chapter blossomServer', () => {
    renderReader()
    const images = screen.getAllByRole('img')
    expect(images[0]).toHaveAttribute('src', 'https://blossom.example/blob/hash1')
    expect(images[1]).toHaveAttribute('src', 'https://blossom.example/blob/hash2')
    expect(images[2]).toHaveAttribute('src', 'https://blossom.example/blob/hash3')
  })

  it('falls back to primaryServer when chapter has no blossomServer', () => {
    mockChapters = [
      { ...mockChapter1, blossomServer: '' },
      mockChapter2,
    ]
    mockPrimaryServer = vi.fn(() => 'https://fallback.example')
    renderReader()
    const images = screen.getAllByRole('img')
    expect(images[0]).toHaveAttribute('src', 'https://fallback.example/blob/hash1')
  })

  it('shows chapter title in header', () => {
    renderReader()
    expect(screen.getByText('Romance Dawn')).toBeInTheDocument()
  })

  it('shows back button linking to comic detail', () => {
    renderReader()
    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute(
      'href',
      '/comic/one-piece',
    )
  })
})
```

Run test — should fail (component exists but `blossomServer: ''` fallback path may need verification).

#### Step 2 — Ensure implementation handles fallback

The `resolvePageUrl` + `server` logic from Task 1 already handles this. If tests pass immediately, that is correct. Confirm by running:

```
npm test -- src/test/ReaderScreen.test.tsx
npx tsc --noEmit
```

#### Step 3 — Commit

```
git add src/screens/Reader/index.tsx src/test/ReaderScreen.test.tsx
git commit -m "feat: Reader renders page images with Blossom URL resolution"
```

---

### Task 3 — Prev/Next chapter navigation

**Objective:** Verify prev/next links are present/absent correctly based on position in chapter list.

#### Step 1 — Failing tests

```typescript
describe('ReaderScreen — chapter navigation', () => {
  beforeEach(() => {
    mockChapters = [mockChapter1, mockChapter2]
  })

  it('shows Next but no Prev on first chapter', () => {
    renderReader('one-piece', encodeURIComponent('one-piece/chapter-1'))
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute(
      'href',
      `/comic/one-piece/chapter/${encodeURIComponent('one-piece/chapter-2')}`,
    )
    expect(screen.queryByRole('link', { name: /prev/i })).not.toBeInTheDocument()
  })

  it('shows Prev but no Next on last chapter', () => {
    renderReader('one-piece', encodeURIComponent('one-piece/chapter-2'))
    expect(screen.getByRole('link', { name: /prev/i })).toHaveAttribute(
      'href',
      `/comic/one-piece/chapter/${encodeURIComponent('one-piece/chapter-1')}`,
    )
    expect(screen.queryByRole('link', { name: /next/i })).not.toBeInTheDocument()
  })

  it('shows both Prev and Next for a middle chapter', () => {
    const chapter3: Chapter = {
      ...mockChapter2,
      id: 'ch3',
      dTag: 'one-piece/chapter-3',
      title: 'Ch3',
      eventId: 'ch3',
    }
    mockChapters = [mockChapter1, mockChapter2, chapter3]
    renderReader('one-piece', encodeURIComponent('one-piece/chapter-2'))
    expect(screen.getByRole('link', { name: /prev/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /next/i })).toBeInTheDocument()
  })
})
```

Run — expect pass (logic already in Task 1 implementation).

#### Step 2 — Commit

```
git add src/test/ReaderScreen.test.tsx
git commit -m "test: verify prev/next chapter navigation links in ReaderScreen"
```

---

### Task 4 — IntersectionObserver progress tracking (`usePageObserver`)

**Objective:** Implement `usePageObserver`. As each `<img>` enters the viewport, call `onVisible(index)`. Wire it into `ReaderScreen` to update `readStore.setProgress` and drive the `PageCounter`.

#### Step 1 — Failing tests

Add to test file:

```typescript
describe('ReaderScreen — progress tracking', () => {
  let observerCallback: IntersectionObserverCallback
  let observedElements: Element[]
  let mockDisconnect: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockChapters = [mockChapter1, mockChapter2]
    observedElements = []
    mockDisconnect = vi.fn()

    // Fake IntersectionObserver
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn((cb: IntersectionObserverCallback) => {
        observerCallback = cb
        return {
          observe: (el: Element) => observedElements.push(el),
          unobserve: vi.fn(),
          disconnect: mockDisconnect,
        }
      }),
    )
    mockSetProgress = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockSetProgress = vi.fn()
  })

  it('calls setProgress when a page becomes visible', async () => {
    renderReader()
    // Simulate page index 1 (0-based) becoming visible
    act(() => {
      observerCallback(
        [{ isIntersecting: true, target: observedElements[1] } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(mockSetProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'one-piece/chapter-1',
        chapterDTag: 'one-piece/chapter-1',
        page: 2,
      }),
    )
  })

  it('updates page counter display when page becomes visible', async () => {
    renderReader()
    act(() => {
      observerCallback(
        [{ isIntersecting: true, target: observedElements[2] } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('disconnects observer on unmount', () => {
    const { unmount } = renderReader()
    unmount()
    expect(mockDisconnect).toHaveBeenCalled()
  })
})
```

Run — fail (stub `usePageObserver` is a no-op).

#### Step 2 — Implement `usePageObserver`

Replace `src/screens/Reader/usePageObserver.ts`:

```typescript
import { useEffect, useRef } from 'react'

export function usePageObserver(
  refs: React.RefObject<HTMLImageElement | null>[],
  onVisible: (index: number) => void,
) {
  // Keep a stable reference to the callback to avoid re-creating the observer
  const onVisibleRef = useRef(onVisible)
  useEffect(() => {
    onVisibleRef.current = onVisible
  })

  useEffect(() => {
    if (refs.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = refs.findIndex((r) => r.current === entry.target)
            if (idx !== -1) onVisibleRef.current(idx)
          }
        }
      },
      { threshold: 0.5 },
    )

    const elements: HTMLImageElement[] = []
    for (const ref of refs) {
      if (ref.current) {
        observer.observe(ref.current)
        elements.push(ref.current)
      }
    }

    return () => {
      observer.disconnect()
    }
  }, [refs])
}
```

#### Step 3 — Wire `usePageObserver` into `ReaderScreen`

Update `src/screens/Reader/index.tsx` — add state and refs, wire observer, update `PageCounter`:

```typescript
// Add to imports
import { useMemo, useRef, useState, useCallback } from 'react'
import { usePageObserver } from './usePageObserver'
import { useReadStore } from '@/stores/readStore'

// Inside ReaderScreen, after computing pageUrls:
const [currentPage, setCurrentPage] = useState(1)
const setProgress = useReadStore((s) => s.setProgress)

// One ref per page — must be stable across renders
const pageRefs = useMemo(
  () => pageUrls.map(() => ({ current: null } as React.RefObject<HTMLImageElement | null>)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [pageUrls.length],
)

const handleVisible = useCallback(
  (idx: number) => {
    const page = idx + 1
    setCurrentPage(page)
    if (!chapterDTag) return
    setProgress({
      id: chapterDTag,
      chapterDTag,
      page,
      updatedAt: Date.now(),
    })
  },
  [chapterDTag, setProgress],
)

usePageObserver(pageRefs, handleVisible)
```

Update the JSX `<img>` to attach refs:

```tsx
{pageUrls.map((url, idx) => (
  <img
    key={url}
    ref={(el) => { pageRefs[idx].current = el }}
    src={url}
    alt={`Page ${idx + 1}`}
    className="block w-full"
    loading={idx === 0 ? 'eager' : 'lazy'}
  />
))}
```

Update `<PageCounter current={currentPage} total={pageUrls.length} />`.

#### Step 4 — Run tests and type-check

```
npm test -- src/test/ReaderScreen.test.tsx
npx tsc --noEmit
```

All tests pass.

#### Step 5 — Commit

```
git add src/screens/Reader/index.tsx src/screens/Reader/usePageObserver.ts src/test/ReaderScreen.test.tsx
git commit -m "feat: track reading progress with IntersectionObserver in ReaderScreen"
```

---

### Task 5 — Nostr progress publish (`useProgressPublisher`)

**Objective:** After progress updates, debounce 2 seconds and publish a kind-30301 event to Nostr.

#### Step 1 — Failing tests

```typescript
describe('ReaderScreen — Nostr progress publish', () => {
  let mockBuild: ReturnType<typeof vi.fn>
  let mockSign: ReturnType<typeof vi.fn>
  let mockPublish: ReturnType<typeof vi.fn>
  let observerCallback: IntersectionObserverCallback
  let observedElements: Element[]

  beforeEach(() => {
    vi.useFakeTimers()
    mockChapters = [mockChapter1, mockChapter2]
    observedElements = []
    mockPublish = vi.fn()
    mockSign = vi.fn().mockResolvedValue({ kind: 30301, sig: 'sig', tags: [], content: '', pubkey: '', id: '', created_at: 0 })
    mockBuild = vi.fn().mockResolvedValue({ kind: 30301, tags: [], content: '', pubkey: '', created_at: 0 })

    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn((cb: IntersectionObserverCallback) => {
        observerCallback = cb
        return {
          observe: (el: Element) => observedElements.push(el),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        }
      }),
    )

    vi.mock('../context/NostrContext', () => ({
      useNostr: () => ({
        service: {
          eventFactory: { build: mockBuild },
          accountManager: { active: { signer: { signEvent: mockSign } } },
          relayPool: { group: vi.fn().mockReturnValue({ publish: mockPublish }) },
        },
      }),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('publishes kind-30301 after 2s debounce when page changes', async () => {
    renderReader()
    act(() => {
      observerCallback(
        [{ isIntersecting: true, target: observedElements[1] } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    // Not yet published
    expect(mockBuild).not.toHaveBeenCalled()
    // Advance timers past debounce
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(mockBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30301,
        tags: expect.arrayContaining([
          ['d', 'one-piece/chapter-1'],
          ['page', '2'],
        ]),
        content: '',
      }),
    )
  })

  it('does not publish if no active account', async () => {
    vi.mock('../context/NostrContext', () => ({
      useNostr: () => ({
        service: {
          eventFactory: { build: mockBuild },
          accountManager: { active: null },
          relayPool: { group: vi.fn().mockReturnValue({ publish: mockPublish }) },
        },
      }),
    }))
    renderReader()
    act(() => {
      observerCallback(
        [{ isIntersecting: true, target: observedElements[0] } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(mockBuild).not.toHaveBeenCalled()
  })
})
```

Run — fail (stub is no-op).

#### Step 2 — Implement `useProgressPublisher`

Replace `src/screens/Reader/useProgressPublisher.ts`:

```typescript
import { useEffect, useRef } from 'react'
import { useNostr } from '@/context/NostrContext'

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
]

const DEBOUNCE_MS = 2000

export function useProgressPublisher(chapterDTag: string, currentPage: number) {
  const { service } = useNostr()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!chapterDTag || currentPage < 1) return

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      const account = service.accountManager.active
      if (!account) return

      try {
        const template = await service.eventFactory.build({
          kind: 30301,
          tags: [
            ['d', chapterDTag],
            ['page', String(currentPage)],
          ],
          content: '',
        })
        const signed = await account.signer.signEvent(template)
        service.relayPool.group(DEFAULT_RELAYS).publish(signed)
      } catch {
        // Silently ignore publish failures — progress is already saved locally
      }
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [chapterDTag, currentPage, service])
}
```

#### Step 3 — Wire into `ReaderScreen`

Add to `src/screens/Reader/index.tsx`:

```typescript
import { useProgressPublisher } from './useProgressPublisher'

// Inside ReaderScreen, after handleVisible:
useProgressPublisher(chapterDTag, currentPage)
```

#### Step 4 — Run tests and type-check

```
npm test -- src/test/ReaderScreen.test.tsx
npx tsc --noEmit
```

#### Step 5 — Commit

```
git add src/screens/Reader/index.tsx src/screens/Reader/useProgressPublisher.ts src/test/ReaderScreen.test.tsx
git commit -m "feat: publish Nostr kind-30301 progress events with 2s debounce"
```

---

### Task 6 — Final integration, polish, and full test run

**Objective:** Run the full test suite, fix any type errors, and verify the complete screen renders correctly end-to-end.

#### Step 1 — Full test suite

```bash
npm test
npx tsc --noEmit
npm run lint
```

Fix any errors that arise.

#### Step 2 — Final snapshot / smoke test

Add one final test that mounts the screen with a real chapter and asserts the overall structure:

```typescript
describe('ReaderScreen — integration smoke', () => {
  beforeEach(() => {
    mockChapters = [mockChapter1, mockChapter2]
  })

  it('renders header, pages, and nav in correct order', () => {
    const { container } = renderReader()
    const header = container.querySelector('header')
    const main = container.querySelector('main')
    const nav = container.querySelector('nav')
    expect(header).not.toBeNull()
    expect(main).not.toBeNull()
    expect(nav).not.toBeNull()
    // header before main before nav
    expect(header!.compareDocumentPosition(main!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(main!.compareDocumentPosition(nav!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
```

#### Step 3 — Commit

```
git add src/test/ReaderScreen.test.tsx
git commit -m "test: add integration smoke test for ReaderScreen layout"
```

---

## Execution Checklist

- [ ] Task 1: Test scaffold + empty state
- [ ] Task 2: Page rendering + URL resolution
- [ ] Task 3: Prev/Next chapter nav
- [ ] Task 4: IntersectionObserver + progress tracking
- [ ] Task 5: Nostr kind-30301 publish
- [ ] Task 6: Full suite + lint + type-check

## Key Invariants

- Never build Nostr events manually — always use `service.eventFactory.build(...)`.
- `blossom://` hashes are stored; HTTP URLs are resolved at render time only.
- Progress publish is fire-and-forget; failures are swallowed so reader UX is unaffected.
- The `usePageObserver` hook owns the `IntersectionObserver` lifecycle entirely; `ReaderScreen` only passes refs and a callback.
- Refs array length is stable across re-renders (keyed by `pageUrls.length`), so the observer is not recreated on every render.
