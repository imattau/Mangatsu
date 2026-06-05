import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ComicDetailScreen } from '../screens/ComicDetail'
import type { Comic, Chapter, ReadingProgress } from '../types'

vi.mock('../lib/blossom', async () => {
  const actual = await vi.importActual<typeof import('../lib/blossom')>('../lib/blossom')
  return {
    ...actual,
    probeBlossomAssetExists: vi.fn(async () => true),
  }
})

const mockAreTargetsCached = vi.fn(async (..._args: any[]) => false)
const mockCacheTargetsForOffline = vi.fn(async (..._args: any[]) => undefined)
const mockRemoveTargetsFromOfflineCache = vi.fn(async (..._args: any[]) => undefined)

vi.mock('../lib/offline', () => ({
  comicOfflineTargets: () => [
    { key: 'Cover::coverhash', label: 'Cover', candidates: ['https://blossom.example/coverhash', 'https://blossom.backup/coverhash'] },
    { key: 'Romance Dawn page 1::hash1', label: 'Romance Dawn page 1', candidates: ['https://blossom.example/hash1', 'https://blossom.backup/hash1'] },
  ],
  areTargetsCached: (...args: any[]) => mockAreTargetsCached(...args),
  cacheTargetsForOffline: (...args: any[]) => mockCacheTargetsForOffline(...args),
  removeTargetsFromOfflineCache: (...args: any[]) => mockRemoveTargetsFromOfflineCache(...args),
}))

const mockComic: Comic = {
  id: 'ev1',
  pubkey: 'abc',
  dTag: 'one-piece',
  title: 'One Piece',
  author: 'Oda',
  authorPubkey: 'author-pubkey',
  description: '',
  coverHash: 'coverhash',
  blossomServer: 'https://blossom.example',
  tags: ['action', 'adventure'],
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

// Mutable state for mocks
let mockChapters: Chapter[] = [mockChapter1, mockChapter2]
let mockProgress: Record<string, ReadingProgress> = {}
const mockEventFactoryBuild = vi.fn(async (template: object) => ({ ...template, id: 'delete-event', sig: 'sig', pubkey: 'abc' }))
const mockPublishEvent = vi.fn(async () => undefined)
const mockPublishLibraryList = vi.fn(async () => undefined)
const mockChaptersForComic = vi.fn(() => mockChapters)
const mockSetComic = vi.fn()
const mockRemoveChapter = vi.fn()
let mockSavedATags = ['30040:abc:one-piece']
const mockRemoveFromLibrary = vi.fn()
const mockRemoveProgressForChapter = vi.fn()

vi.mock('applesauce-react/hooks', () => ({
  useEventStore: () => ({ timeline: vi.fn(() => ({ subscribe: vi.fn() })) }),
  useObservableState: () => [],
}))

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      eventFactory: { build: mockEventFactoryBuild },
      subscribeToChapters: vi.fn(() => ({ unsubscribe: vi.fn() })),
      publishEvent: mockPublishEvent,
      publishLibraryList: mockPublishLibraryList,
    },
  }),
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string | null }) => unknown) =>
    sel({ pubkey: 'abc' }),
}))

vi.mock('../stores/comicStore', () => ({
  useComicStore: (sel: (s: {
    comics: Record<string, Comic>
      chapters: Record<string, Chapter>
      setComic: (comic: Comic) => void
      setChapter: (c: Chapter) => void
      removeComic: (comicDTag: string) => void
      removeChapter: (chapterDTag: string) => void
      removeChaptersForComic: (comicDTag: string) => void
      chaptersForComic: (dTag: string) => Chapter[]
  }) => unknown) =>
    sel({
      comics: { 'one-piece': mockComic },
      chapters: {},
      setComic: mockSetComic,
      setChapter: vi.fn(),
      removeComic: vi.fn(),
      removeChapter: mockRemoveChapter,
      removeChaptersForComic: vi.fn(),
      chaptersForComic: mockChaptersForComic,
    }),
}))

vi.mock('../stores/libraryStore', () => ({
  useLibraryStore: (sel: (s: {
    savedATags: string[]
    add: (aTag: string) => void
    remove: (aTag: string) => void
    isIn: (aTag: string) => boolean
  }) => unknown) =>
    sel({
      savedATags: mockSavedATags,
      add: vi.fn(),
      remove: mockRemoveFromLibrary,
      isIn: (aTag: string) => mockSavedATags.includes(aTag),
    }),
}))

vi.mock('../stores/readStore', () => ({
  useReadStore: (
    sel: (s: {
      progress: Record<string, ReadingProgress>
      removeProgressForComic: (comicDTag: string) => void
      removeProgressForChapter: (chapterDTag: string) => void
    }) => unknown,
  ) =>
    sel({
      progress: mockProgress,
      removeProgressForComic: vi.fn(),
      removeProgressForChapter: mockRemoveProgressForChapter,
    }),
}))

vi.mock('../stores/blossomStore', () => ({
  DEFAULT_BLOSSOM_SERVERS: ['https://blossom.primal.net', 'https://blossom.band', 'https://cdn.satellite.earth'],
  useBlossomStore: (
    sel: (s: {
      servers: { url: string }[]
      primaryServer: () => string | undefined
      cachedHashes: Record<string, string>
    }) => unknown,
  ) => sel({ servers: [], primaryServer: () => 'https://blossom.example', cachedHashes: {} }),
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
  beforeEach(() => {
    mockEventFactoryBuild.mockClear()
    mockPublishEvent.mockClear()
    mockPublishLibraryList.mockClear()
    mockChaptersForComic.mockClear()
    mockSetComic.mockClear()
    mockRemoveChapter.mockClear()
    mockRemoveFromLibrary.mockClear()
    mockRemoveProgressForChapter.mockClear()
    mockSavedATags = ['30040:abc:one-piece']
    mockAreTargetsCached.mockClear()
    mockCacheTargetsForOffline.mockClear()
    mockRemoveTargetsFromOfflineCache.mockClear()

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

  it('renders the comic title', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText('One Piece')).toBeInTheDocument()
  })

  it('renders chapter titles', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText('Romance Dawn')).toBeInTheDocument()
    expect(screen.getByText('They Call Him "Straw Hat Luffy"')).toBeInTheDocument()
  })

  it('renders page count for each chapter', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText('3 pages')).toBeInTheDocument()
    expect(screen.getByText('2 pages')).toBeInTheDocument()
  })

  it('renders chapter links pointing to reader route', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    const links = screen.getAllByRole('link')
    const chapterLinks = links.filter((l) =>
      l.getAttribute('href')?.includes('/chapter/') && !l.getAttribute('href')?.endsWith('/edit'),
    )
    expect(chapterLinks).toHaveLength(2)
    expect(chapterLinks[0].getAttribute('href')).toBe(
      '/comic/one-piece/chapter/one-piece%2Fchapter-1',
    )
  })

  it('shows an edit details action for the comic owner', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })

    expect(screen.getByRole('link', { name: /edit details/i })).toHaveAttribute(
      'href',
      '/comic/one-piece/edit',
    )
  })

  it('renders clickable metadata tags that open a filtered feed', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })

    const tagLink = screen.getByRole('link', { name: '#action' })
    expect(tagLink).toHaveAttribute('href', '/feed?tag=action')
  })

  it('shows empty state when no chapters', () => {
    mockChapters = []
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText(/no chapters yet/i)).toBeInTheDocument()
  })

  it('shows Continue badge when reading progress exists for a chapter', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {
      'one-piece/chapter-1': {
        id: 'p1',
        chapterDTag: 'one-piece/chapter-1',
        page: 4,
        updatedAt: 1700005000,
      },
    }
    render(<ComicDetailScreen />, { wrapper: Wrapper })
    expect(screen.getByText(/continue/i)).toBeInTheDocument()
  })

  it('shows a delete action for owned comics and publishes a delete request', async () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    try {
      render(<ComicDetailScreen />, { wrapper: Wrapper })

      await user.click(screen.getByRole('button', { name: /delete comic/i }))

      expect(mockEventFactoryBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 5,
          content: expect.stringContaining('Deleted from Mangatsu'),
          tags: expect.arrayContaining([
            ['a', '30040:abc:one-piece'],
            ['k', '30040'],
            ['a', '30041:abc:one-piece/chapter-1'],
            ['a', '30041:abc:one-piece/chapter-2'],
            ['k', '30041'],
          ]),
        }),
      )
      expect(mockPublishEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 5, pubkey: 'abc' }),
      )
      expect(mockRemoveFromLibrary).toHaveBeenCalledWith('30040:abc:one-piece')
      expect(mockPublishLibraryList).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ pubkey: 'abc' }),
      )
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('hydrates the shared comic store when detail resolves a comic', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })

    expect(mockSetComic).toHaveBeenCalledWith(
      expect.objectContaining({
        dTag: 'one-piece',
        title: 'One Piece',
      }),
    )
  })

  it('shows an add chapter action for owned comics', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })

    expect(screen.getByRole('link', { name: /add chapter/i })).toHaveAttribute(
      'href',
      '/comic/one-piece/upload',
    )
  })

  it('shows chapter edit and delete actions for owned comics', () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    render(<ComicDetailScreen />, { wrapper: Wrapper })

    expect(screen.getByRole('link', { name: /edit chapter romance dawn/i })).toHaveAttribute(
      'href',
      '/comic/one-piece/chapter/one-piece%2Fchapter-1/edit',
    )
    expect(screen.getByRole('button', { name: /delete chapter romance dawn/i })).toBeInTheDocument()
  })

  it('deletes a chapter and removes local progress state', async () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {
      'one-piece/chapter-1': {
        id: 'p1',
        chapterDTag: 'one-piece/chapter-1',
        page: 4,
        updatedAt: 1700005000,
      },
    }
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    try {
      render(<ComicDetailScreen />, { wrapper: Wrapper })

      await user.click(screen.getByRole('button', { name: /delete chapter romance dawn/i }))

      expect(mockEventFactoryBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 5,
          tags: expect.arrayContaining([
            ['a', '30041:abc:one-piece/chapter-1'],
            ['k', '30041'],
          ]),
        }),
      )
      expect(mockPublishEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 5, pubkey: 'abc' }),
      )
      expect(mockRemoveChapter).toHaveBeenCalledWith('one-piece/chapter-1')
      expect(mockRemoveProgressForChapter).toHaveBeenCalledWith('one-piece/chapter-1')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('can cache a comic for offline reading', async () => {
    mockChapters = [mockChapter1, mockChapter2]
    mockProgress = {}
    const user = userEvent.setup()

    render(<ComicDetailScreen />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /make comic available offline/i })).toBeEnabled()
    })

    const button = screen.getByRole('button', { name: /make comic available offline/i })
    await user.click(button)

    expect(mockCacheTargetsForOffline).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'Cover::coverhash',
          candidates: expect.arrayContaining([
            'https://blossom.example/coverhash',
            'https://blossom.backup/coverhash',
          ]),
        }),
        expect.objectContaining({
          key: 'Romance Dawn page 1::hash1',
          candidates: expect.arrayContaining([
            'https://blossom.example/hash1',
            'https://blossom.backup/hash1',
          ]),
        }),
      ]),
      expect.any(Function),
    )
  })

  it('lists blossom servers in the detail view', () => {
    mockComic.coverServers = ['https://good.example', 'https://bad.example']
    mockChapters = [
      {
        ...mockChapter1,
        pageServers: ['https://good.example', 'https://bad.example', 'https://good.example'],
        pageServerLists: [
          ['https://good.example', 'https://bad.example'],
          ['https://good.example'],
          ['https://good.example', 'https://bad.example'],
        ],
        blossomServer: 'https://good.example',
      },
      {
        ...mockChapter2,
        pageServers: ['https://good.example', 'https://good.example'],
        pageServerLists: [
          ['https://good.example', 'https://bad.example'],
          ['https://good.example'],
        ],
        blossomServer: 'https://good.example',
      },
    ]
    mockProgress = {}

    class MockImage {
      onload: null | (() => void) = null
      onerror: null | (() => void) = null

      set src(value: string) {
        queueMicrotask(() => {
          if (value.includes('bad.example')) {
            this.onerror?.()
          } else {
            this.onload?.()
          }
        })
      }
    }

    vi.stubGlobal('Image', MockImage)

    try {
      render(<ComicDetailScreen />, { wrapper: Wrapper })

      expect(screen.getByText('Blossom servers')).toBeInTheDocument()
      expect(screen.getByText('https://good.example')).toBeInTheDocument()
      expect(screen.getByText('https://bad.example')).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
      mockComic.coverServers = undefined
    }
  })
})
