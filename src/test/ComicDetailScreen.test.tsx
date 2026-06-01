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

// Mutable state for mocks
let mockChapters: Chapter[] = [mockChapter1, mockChapter2]
let mockProgress: Record<string, ReadingProgress> = {}

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
      chapters: {},
      setChapter: vi.fn(),
      chaptersForComic: () => mockChapters,
    }),
}))

vi.mock('../stores/readStore', () => ({
  useReadStore: (sel: (s: { progress: Record<string, ReadingProgress> }) => unknown) =>
    sel({ progress: mockProgress }),
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
      l.getAttribute('href')?.includes('/chapter/'),
    )
    expect(chapterLinks).toHaveLength(2)
    expect(chapterLinks[0].getAttribute('href')).toBe(
      '/comic/one-piece/chapter/one-piece%2Fchapter-1',
    )
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
})
