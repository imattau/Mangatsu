import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ReaderScreen } from '../screens/Reader'
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
const mockProgress: Record<string, ReadingProgress> = {}
let mockSetProgress = vi.fn()
let mockPrimaryServer = vi.fn(() => 'https://blossom.example')
let mockCachedHashes: Record<string, string> = {}

// Mutable nostr service stubs — replaced in publish tests
let mockBuildFn = vi.fn().mockResolvedValue({ kind: 30301, tags: [], content: '', created_at: 0, pubkey: '' })
let mockSignFn = vi.fn().mockResolvedValue({ sig: 'sig' })
let mockPublishFn = vi.fn()
let mockActiveAccount: { signer: { signEvent: ReturnType<typeof vi.fn> } } | null = {
  signer: { signEvent: mockSignFn },
}

vi.mock('../stores/comicStore', () => ({
  useComicStore: (sel: (s: {
    comics: Record<string, unknown>
    chapters: Record<string, Chapter>
    setComic: () => void
    setChapter: () => void
    chaptersForComic: (dTag: string) => Chapter[]
  }) => unknown) =>
    sel({
      comics: {},
      chapters: {},
      setComic: vi.fn(),
      setChapter: vi.fn(),
      chaptersForComic: () => mockChapters,
    }),
}))

vi.mock('../stores/readStore', () => ({
  useReadStore: (sel: (s: { progress: Record<string, ReadingProgress>; setProgress: (p: ReadingProgress) => void }) => unknown) =>
    sel({ progress: mockProgress, setProgress: mockSetProgress }),
}))

vi.mock('../stores/blossomStore', () => ({
  DEFAULT_BLOSSOM_SERVERS: ['https://blossom.primal.net', 'https://blossom.band', 'https://cdn.satellite.earth'],
  useBlossomStore: (sel: (s: {
    servers: unknown[]
    cachedHashes: Record<string, string>
    setServers: () => void
    setCachedHash: () => void
    primaryServer: () => string | undefined
  }) => unknown) =>
    sel({
      servers: [],
      cachedHashes: mockCachedHashes,
      setServers: vi.fn(),
      setCachedHash: vi.fn(),
      primaryServer: mockPrimaryServer,
    }),
}))

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      eventFactory: { build: (...args: unknown[]) => mockBuildFn(...args) },
      accountManager: { get active() { return mockActiveAccount } },
      relayPool: { group: vi.fn().mockReturnValue({ publish: (...args: unknown[]) => mockPublishFn(...args) }) },
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

// ── Tests ────────────────────────────────────────────────────────────────────

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

describe('ReaderScreen — page rendering', () => {
  beforeEach(() => {
    mockChapters = [mockChapter1, mockChapter2]
    mockPrimaryServer = vi.fn(() => 'https://blossom.example')
    mockCachedHashes = {}

    class MockImage {
      onload: null | (() => void) = null
      onerror: null | (() => void) = null

      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }

    vi.stubGlobal('Image', MockImage)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200 } as Response)),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders one img per page hash', async () => {
    renderReader()
    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(mockChapter1.pageHashes.length)
    })
  })

  it('resolves page URLs via chapter blossomServer', async () => {
    renderReader()
    await waitFor(() => {
      const images = screen.getAllByRole('img')
      expect(images[0]).toHaveAttribute('src', 'https://blossom.example/hash1')
      expect(images[1]).toHaveAttribute('src', 'https://blossom.example/hash2')
      expect(images[2]).toHaveAttribute('src', 'https://blossom.example/hash3')
    })
  })

  it('chooses the fastest available blossom server for a page', async () => {
    mockChapters = [
      {
        ...mockChapter1,
        blossomServer: 'https://slow.example',
        pageServerLists: [
          ['https://slow.example', 'https://fast.example'],
          ['https://slow.example'],
          ['https://slow.example'],
        ],
        pageServers: ['https://slow.example', 'https://slow.example', 'https://slow.example'],
      },
      mockChapter2,
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('https://fast.example/')) {
          return { ok: true, status: 200 } as Response
        }
        if (url.startsWith('https://slow.example/')) {
          await new Promise((resolve) => setTimeout(resolve, 25))
          return { ok: true, status: 200 } as Response
        }
        return { ok: false, status: 404 } as Response
      }),
    )

    renderReader()

    await waitFor(() => {
      const images = screen.getAllByRole('img')
      expect(images[0]).toHaveAttribute('src', 'https://fast.example/hash1')
    })
  })

  it('eager loads cached pages and lazily loads uncached pages', () => {
    mockCachedHashes = { hash2: 'blob://cached-hash2' }
    renderReader()
    const images = screen.getAllByRole('img')
    expect(images[0]).toHaveAttribute('loading', 'eager')
    expect(images[1]).toHaveAttribute('loading', 'eager')
    expect(images[2]).toHaveAttribute('loading', 'lazy')
  })

  it('preloads the next uncached page', () => {
    const preloaded: string[] = []
    class MockImage {
      set src(value: string) {
        preloaded.push(value)
      }
    }

    vi.stubGlobal('Image', MockImage)
    try {
      renderReader()
      expect(preloaded).toContain('https://blossom.example/hash2')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ignores cached URLs from a different Blossom server', async () => {
    mockCachedHashes = { hash1: 'https://old.example/hash1' }
    mockChapters = [{ ...mockChapter1, blossomServer: 'https://new.example' }, mockChapter2]
    renderReader()
    await waitFor(() => {
      const images = screen.getAllByRole('img')
      expect(images[0]).toHaveAttribute('src', 'https://new.example/hash1')
    })
  })

  it('restores the saved page on entry', async () => {
    mockProgress['one-piece/chapter-1'] = {
      id: 'progress-1',
      chapterDTag: 'one-piece/chapter-1',
      page: 2,
      updatedAt: 1700000000,
    }
    const scrollIntoView = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    })

    try {
      renderReader()

      await waitFor(() => {
        const images = screen.getAllByRole('img')
        expect(images[1]).toHaveAttribute('src', 'https://blossom.example/hash2')
        expect(scrollIntoView).toHaveBeenCalled()
        expect(screen.getByText('2 / 3')).toBeInTheDocument()
      })
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        value: original,
        configurable: true,
      })
      delete mockProgress['one-piece/chapter-1']
    }
  })

  it('falls back to primaryServer when chapter has no blossomServer', async () => {
    mockChapters = [
      { ...mockChapter1, blossomServer: '' },
      mockChapter2,
    ]
    mockPrimaryServer = vi.fn(() => 'https://fallback.example')
    renderReader()
    await waitFor(() => {
      const images = screen.getAllByRole('img')
      expect(images[0]).toHaveAttribute('src', 'https://fallback.example/hash1')
    })
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

describe('ReaderScreen — progress tracking', () => {
  let observerCallback: IntersectionObserverCallback
  let observedElements: Element[]
  let mockDisconnect: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockChapters = [mockChapter1, mockChapter2]
    observedElements = []
    mockDisconnect = vi.fn()

    const _observedElements = observedElements
    const _mockDisconnect = mockDisconnect
    class FakeIO {
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb
      }
      observe(el: Element) { _observedElements.push(el) }
      unobserve = vi.fn()
      disconnect = _mockDisconnect
    }
    vi.stubGlobal('IntersectionObserver', FakeIO)
    mockSetProgress = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockSetProgress = vi.fn()
  })

  it('calls setProgress when a page becomes visible', async () => {
    renderReader()
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

describe('ReaderScreen — Nostr progress publish', () => {
  let observerCallback: IntersectionObserverCallback
  let observedElements: Element[]

  beforeEach(() => {
    vi.useFakeTimers()
    mockChapters = [mockChapter1, mockChapter2]
    observedElements = []
    mockPublishFn = vi.fn()
    mockSignFn = vi.fn().mockResolvedValue({ kind: 30301, sig: 'sig', tags: [], content: '', pubkey: '', id: '', created_at: 0 })
    mockBuildFn = vi.fn().mockResolvedValue({ kind: 30301, tags: [], content: '', pubkey: '', created_at: 0 })
    mockActiveAccount = { signer: { signEvent: mockSignFn } }

    const _observedElements = observedElements
    class FakeIO2 {
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb
      }
      observe(el: Element) { _observedElements.push(el) }
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('IntersectionObserver', FakeIO2)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    mockBuildFn = vi.fn().mockResolvedValue({ kind: 30301, tags: [], content: '', created_at: 0, pubkey: '' })
    mockActiveAccount = { signer: { signEvent: mockSignFn } }
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
    expect(mockBuildFn).not.toHaveBeenCalled()
    // Advance timers past debounce
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(mockBuildFn).toHaveBeenCalledWith(
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
})

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
    expect(header!.compareDocumentPosition(main!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(main!.compareDocumentPosition(nav!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('enables snap scrolling on the page container', () => {
    const { container } = renderReader()
    const main = container.querySelector('main')
    expect(main).toHaveClass('snap-y', 'snap-mandatory', 'overflow-y-auto')
    expect(screen.getAllByRole('img')[0]).toHaveClass('snap-start', 'snap-always')
  })
})
