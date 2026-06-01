# ComicDetail Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the ComicDetail screen — subscribes to kind 30403 chapter events filtered by comic dTag, parses chapters, populates `comicStore`, and renders a sorted chapter list with reading-progress badges.

**Architecture:** `ComicDetailScreen` mirrors the `LibraryScreen` reactive pattern. It uses `eventStore.timeline()` + `useObservableState()` from `applesauce-react` to get live kind 30403 events, persists parsed `Chapter` objects into `comicStore` via `setChapter()`, and reads cached chapters back via `chaptersForComic()`. Navigation to the Reader uses React Router params.

**Tech Stack:** applesauce-react (`useEventStore`, `useObservableState`), RxJS (`of`), Zustand (`comicStore`, `readStore`, `blossomStore`), React Router v7 (`useParams`, `Link`), Vitest + Testing Library

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/screens/ComicDetail/index.tsx` | Create | ComicDetail screen — chapter list + cover header |
| `src/services/NostrService.ts` | Modify | Add `subscribeToChapters(comicDTag)` method |
| `src/test/ComicDetailScreen.test.tsx` | Create | Unit tests for ComicDetail rendering |
| `src/test/NostrServiceChapters.test.ts` | Create | Unit test for `subscribeToChapters` |

---

## Task 1: Add `subscribeToChapters` to NostrService

**Files:**
- Modify: `src/services/NostrService.ts`
- Test: `src/test/NostrServiceChapters.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/test/NostrServiceChapters.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { NostrService } from '../services/NostrService'

describe('NostrService.subscribeToChapters', () => {
  it('returns a subscription object with unsubscribe', () => {
    const svc = new NostrService()
    const sub = svc.subscribeToChapters('one-piece')
    expect(typeof sub.unsubscribe).toBe('function')
    sub.unsubscribe()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/test/NostrServiceChapters.test.ts
```

Expected: FAIL — `subscribeToChapters` is not a function.

- [ ] **Step 3: Add `subscribeToChapters` to NostrService**

Open `src/services/NostrService.ts` and add the method after `subscribeToUserComics`:

```ts
  subscribeToChapters(
    comicDTag: string,
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [30403], '#d': [`${comicDTag}/`] }],
      { eventStore: this.eventStore },
    )

    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/test/NostrServiceChapters.test.ts
```

Expected: PASS.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/NostrService.ts src/test/NostrServiceChapters.test.ts
git commit -m "feat: add subscribeToChapters to NostrService"
```

---

## Task 2: ComicDetail screen

**Files:**
- Create: `src/screens/ComicDetail/index.tsx`
- Test: `src/test/ComicDetailScreen.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/test/ComicDetailScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ComicDetailScreen } from '../screens/ComicDetail'
import type { Comic, Chapter, ReadingProgress } from '../types'

const mockComic: Comic = {
  id: 'ev1',
  pubkey: 'abc',
  dTag: 'one-piece',
  title: 'One Piece',
  author: 'Oda',
  description: '',
  coverHash: 'coverhash',
  blossomServer: 'https://blossom.example',
  tags: [],
  eventId: 'ev1',
}

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
  title: 'They Call Him "Straw Hat Luffy"',
  pageHashes: ['hash4', 'hash5'],
  blossomServer: 'https://blossom.example',
  publishedAt: 1700001000,
  eventId: 'ch2',
}

vi.mock('applesauce-react/hooks', () => ({
  useEventStore: () => ({ timeline: vi.fn(() => ({ subscribe: vi.fn() })) }),
  useObservableState: () => [],
}))

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      subscribeToChapters: vi.fn(() => ({ unsubscribe: vi.fn() })),
    },
  }),
}))

vi.mock('../stores/comicStore', () => ({
  useComicStore: (sel: (s: {
    comics: Record<string, Comic>
    chapters: Record<string, Chapter>
    setChapter: (c: Chapter) => void
    chaptersForComic: (dTag: string) => Chapter[]
  }) => unknown) =>
    sel({
      comics: { 'one-piece': mockComic },
      chapters: { 'one-piece/chapter-1': mockChapter1, 'one-piece/chapter-2': mockChapter2 },
      setChapter: vi.fn(),
      chaptersForComic: (_dTag: string) => [mockChapter1, mockChapter2],
    }),
}))

vi.mock('../stores/readStore', () => ({
  useReadStore: (sel: (s: { progress: Record<string, ReadingProgress> }) => unknown) =>
    sel({ progress: {} }),
}))

vi.mock('../stores/blossomStore', () => ({
  useBlossomStore: (sel: (s: { primaryServer: () => string | undefined }) => unknown) =>
    sel({ primaryServer: () => 'https://blossom.example' }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/comic/one-piece']}>
      <Routes>
        <Route path="/comic/:dTag" element={children} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ComicDetailScreen', () => {
  it('renders the comic title', () => {
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText('One Piece')).toBeInTheDocument()
  })

  it('renders chapter titles', () => {
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText('Romance Dawn')).toBeInTheDocument()
    expect(screen.getByText('They Call Him "Straw Hat Luffy"')).toBeInTheDocument()
  })

  it('renders page count for each chapter', () => {
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText('3 pages')).toBeInTheDocument()
    expect(screen.getByText('2 pages')).toBeInTheDocument()
  })

  it('renders chapter links pointing to reader route', () => {
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    const links = screen.getAllByRole('link')
    const chapterLinks = links.filter((l) =>
      l.getAttribute('href')?.includes('/chapter/'),
    )
    expect(chapterLinks).toHaveLength(2)
    expect(chapterLinks[0].getAttribute('href')).toBe(
      '/comic/one-piece/chapter/one-piece%2Fchapter-1',
    )
  })

  it('shows empty state when no chapters', () => {
    vi.mock('../stores/comicStore', () => ({
      useComicStore: (sel: (s: {
        comics: Record<string, Comic>
        chapters: Record<string, Chapter>
        setChapter: (c: Chapter) => void
        chaptersForComic: (dTag: string) => Chapter[]
      }) => unknown) =>
        sel({
          comics: { 'one-piece': mockComic },
          chapters: {},
          setChapter: vi.fn(),
          chaptersForComic: (_dTag: string) => [],
        }),
    }))
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText(/no chapters yet/i)).toBeInTheDocument()
  })

  it('shows Continue badge when reading progress exists for a chapter', () => {
    vi.mock('../stores/readStore', () => ({
      useReadStore: (sel: (s: { progress: Record<string, ReadingProgress> }) => unknown) =>
        sel({
          progress: {
            'one-piece/chapter-1': {
              id: 'p1',
              chapterDTag: 'one-piece/chapter-1',
              page: 4,
              updatedAt: 1700005000,
            },
          },
        }),
    }))
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText(/continue/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/test/ComicDetailScreen.test.tsx
```

Expected: FAIL — `ComicDetail` module not found.

- [ ] **Step 3: Implement ComicDetailScreen**

Create `src/screens/ComicDetail/index.tsx`:

```tsx
import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
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

function parsePageHashes(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === 'page')
    .map((tag) => {
      // page tag value may be "blossom://hash" or just a raw hash
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

/** Extract the chapter number from a dTag like "slug/chapter-3" → 3 */
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

// ---------------------------------------------------------------------------
// Filter factory
// ---------------------------------------------------------------------------

function chapterFilter(comicDTag: string) {
  return [{ kinds: [30403], '#d': [`${comicDTag}/`] }]
}

const EMPTY_EVENTS: NostrEvent[] = []

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function ComicDetailScreen() {
  const { dTag } = useParams<{ dTag: string }>()
  const { service } = useNostr()
  const eventStore = useEventStore()

  const comics = useComicStore((s) => s.comics)
  const setChapter = useComicStore((s) => s.setChapter)
  const chaptersForComic = useComicStore((s) => s.chaptersForComic)
  const progress = useReadStore((s) => s.progress)
  const primaryServer = useBlossomStore((s) => s.primaryServer)

  const comic: Comic | undefined = dTag ? comics[dTag] : undefined

  // Subscribe to relay for live chapter events
  useEffect(() => {
    if (!dTag) return
    const sub = service.subscribeToChapters(dTag)
    return () => sub.unsubscribe()
  }, [dTag, service])

  // Also wire eventStore.timeline so cached/arriving events populate the store
  const chapterTimeline$ = useMemo(
    () => (dTag ? eventStore.timeline(chapterFilter(dTag)) : of([])),
    [eventStore, dTag],
  )
  const liveChapterEvents = useObservableState(chapterTimeline$) ?? EMPTY_EVENTS

  useEffect(() => {
    if (!dTag) return
    for (const event of liveChapterEvents) {
      const chapter = parseChapterEvent(event, dTag)
      if (chapter) setChapter(chapter)
    }
  }, [liveChapterEvents, dTag, setChapter])

  // Read back from store (includes persisted data from previous sessions)
  const chapters = useMemo(() => {
    if (!dTag) return []
    return chaptersForComic(dTag).slice().sort(
      (a, b) => chapterNumber(a.dTag) - chapterNumber(b.dTag),
    )
  }, [chaptersForComic, dTag])

  const server = comic?.blossomServer || primaryServer()

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 py-4 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6">

        {/* Back navigation */}
        <Link
          to="/"
          className="self-start rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-white"
        >
          ← Library
        </Link>

        {/* Comic header */}
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
            </div>
          </header>
        ) : (
          <header>
            <div className="h-6 w-40 rounded bg-zinc-800 animate-pulse" />
          </header>
        )}

        {/* Chapter list */}
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/ComicDetailScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Type-check and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ComicDetail/index.tsx src/test/ComicDetailScreen.test.tsx
git commit -m "feat: implement ComicDetail screen with chapter list"
```

---

## Task 3: Wire ComicDetail into router

**Files:**
- Modify: `src/router.tsx`

- [ ] **Step 1: Confirm import exists**

Open `src/router.tsx`. The route `/comic/:dTag` already exists pointing to `<ComicDetailScreen />` from a stub. Update the import to point to the real screen if needed. The route itself should already be:

```tsx
{ path: '/comic/:dTag', element: <ComicDetailScreen /> },
```

If the import is from a stub path, update it:

```tsx
import { ComicDetailScreen } from './screens/ComicDetail'
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/router.tsx
git commit -m "chore: wire ComicDetail screen import in router"
```

---

## Task 4: Smoke-test the full flow

This is a manual verification step — no automated test required.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify routes**

1. Navigate to `/` — Library screen loads.
2. Click a comic tile — URL changes to `/comic/<dTag>`, ComicDetail header shows title + author.
3. If relays are live: chapters appear in ascending order within ~5 seconds.
4. If no chapters available: "No chapters yet" empty state shows.
5. Click a chapter row — URL changes to `/comic/<dTag>/chapter/<chapterDTag>` (Reader stub).
6. If reading progress exists for a chapter: "Continue" badge is visible on that row.

- [ ] **Step 3: Final type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.
