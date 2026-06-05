import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LibraryScreen } from '../screens/Library'
import { useLibraryStore } from '../stores/libraryStore'
import { usePublishQueueStore } from '../stores/publishQueueStore'

const mockPublishEvent = vi.fn(async () => undefined)
const mockForeignComicEvent = {
  id: 'foreign-ev',
  pubkey: 'author-pubkey',
  kind: 30040,
  created_at: 1700000000,
  content: '',
  tags: [
    ['d', 'foreign-comic'],
    ['title', 'Foreign Comic'],
    ['cover', 'coverhash', 'https://blossom.example'],
  ],
} as const
const mockComic = {
  id: 'comic-1',
  pubkey: 'pubkey',
  dTag: 'comic-1',
  title: 'Comic One',
  author: '',
  description: '',
  coverHash: '',
  blossomServer: '',
  coverServer: '',
  tags: [],
  eventId: 'comic-1',
}
let mockComics: Record<string, typeof mockComic> = {}
let mockProgress: Record<string, { id: string; chapterDTag: string; page: number; updatedAt: number }> = {}
const mockService = {
  relayPool: { status$: {} },
  publishEvent: mockPublishEvent,
  subscribeToForeignComic: vi.fn(() => ({ unsubscribe: vi.fn() })),
}

vi.mock('applesauce-react/hooks', () => ({
  useEventStore: () => ({
    timeline: vi.fn((filters: Array<{ kinds?: number[]; authors?: string[]; '#d'?: string[] }>) => ({
      filters,
    })),
  }),
  useObservableState: (observable: { filters?: Array<{ kinds?: number[]; authors?: string[]; '#d'?: string[] }> }) => {
    const filter = observable?.filters?.[0]
    if (
      filter?.kinds?.includes(30040) &&
      filter.authors?.[0] === 'author-pubkey' &&
      filter['#d']?.[0] === 'foreign-comic'
    ) {
      return [mockForeignComicEvent]
    }
    return []
  },
}))

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({ service: mockService, refreshSync: vi.fn(), isRefreshing: false, syncGeneration: 0 }),
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string | null }) => unknown) =>
    sel({ pubkey: 'pubkey' }),
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

vi.mock('../stores/comicStore', () => ({
  useComicStore: (
    sel: (s: {
      comics: Record<string, typeof mockComic>
      chapters: Record<string, never>
      setComic: () => void
      setChapter: () => void
      chaptersForComic: () => never[]
    }) => unknown,
  ) =>
    sel({
      comics: mockComics,
      chapters: {},
      setComic: vi.fn(),
      setChapter: vi.fn(),
      chaptersForComic: () => [],
    }),
}))

vi.mock('../components/BlossomImage', () => ({
  BlossomImage: ({ alt }: { alt: string }) => <img alt={alt} data-testid="blossom-image" />,
}))

vi.mock('../stores/readStore', () => ({
  useReadStore: (sel: (s: { progress: typeof mockProgress }) => unknown) =>
    sel({ progress: mockProgress }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('LibraryScreen queued publishes', () => {
  beforeEach(() => {
    mockPublishEvent.mockClear()
    mockService.subscribeToForeignComic.mockClear()
    usePublishQueueStore.getState().clearDrafts()
    useLibraryStore.getState().setAll([])
    mockComics = {}
    mockProgress = {}
  })

  it('shows queued comics in the library with retry action', () => {
    usePublishQueueStore.getState().queueDraft({
      comicDTag: 'queued-comic',
      title: 'Queued Comic',
      createdAt: 123,
      events: [{ id: 'comic-event' } as never],
    }, 'relay rejected the event')

    render(<LibraryScreen />, { wrapper: Wrapper })

    expect(screen.getByText('Queued Comic')).toBeInTheDocument()
    expect(screen.getByText(/queued for publish/i)).toBeInTheDocument()
    expect(screen.getByText(/last publish error/i)).toBeInTheDocument()
    expect(screen.queryByText(/no comics yet/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry publish/i })).toBeInTheDocument()
  })

  it('keeps the upload comic action visible when comics already exist', () => {
    mockComics = {
      'comic-1': mockComic,
      'foreign-comic': {
        ...mockComic,
        id: 'foreign-1',
        pubkey: 'author-pubkey',
        dTag: 'foreign-comic',
        title: 'Foreign Comic',
      },
    }

    render(<LibraryScreen />, { wrapper: Wrapper })

    expect(screen.getByRole('link', { name: /upload a comic/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByText('Comic One')).toBeInTheDocument()
    expect(screen.queryByText('Foreign Comic')).not.toBeInTheDocument()
    expect(screen.getByText('1 total')).toBeInTheDocument()
  })

  it('encodes the continue-reading chapter path', () => {
    mockComics = { 'comic-1': mockComic }
    mockProgress = {
      'comic-1/chapter-1': {
        id: 'p1',
        chapterDTag: 'comic-1/chapter-1',
        page: 2,
        updatedAt: 1700000000,
      },
    }

    render(<LibraryScreen />, { wrapper: Wrapper })

    expect(screen.getByRole('link', { name: /continue/i })).toHaveAttribute(
      'href',
      '/comic/comic-1/chapter/comic-1%2Fchapter-1',
    )
  })

  it('retries queued comics and clears them on success', async () => {
    usePublishQueueStore.getState().queueDraft({
      comicDTag: 'queued-comic',
      title: 'Queued Comic',
      createdAt: 123,
      events: [{ id: 'comic-event' } as never, { id: 'chapter-event' } as never],
    }, 'relay rejected the event')

    const user = userEvent.setup()
    render(<LibraryScreen />, { wrapper: Wrapper })

    await user.click(screen.getByRole('button', { name: /retry publish/i }))

    await waitFor(() => {
      expect(mockPublishEvent).toHaveBeenCalledTimes(2)
      expect(usePublishQueueStore.getState().draftsByComicDTag['queued-comic']).toBeUndefined()
    })
  })

  it('renders saved library entries before comic metadata has hydrated', () => {
    useLibraryStore.getState().setAll(['30040:author-pubkey:foreign-comic'])

    render(<LibraryScreen />, { wrapper: Wrapper })

    expect(screen.getByText('Foreign Comic')).toBeInTheDocument()
    expect(screen.getByAltText('Foreign Comic')).toBeInTheDocument()
    expect(screen.queryByText(/loading from library sync/i)).not.toBeInTheDocument()
  })

  it('subscribes to missing saved comics so metadata can hydrate', () => {
    useLibraryStore.getState().setAll(['30040:author-pubkey:foreign-comic'])

    render(<LibraryScreen />, { wrapper: Wrapper })

    expect(mockService.subscribeToForeignComic).toHaveBeenCalledWith(
      'author-pubkey',
      'foreign-comic',
      expect.any(Function),
    )
  })

  it('renders saved comic title and cover from the event store on a fresh device', () => {
    useLibraryStore.getState().setAll(['30040:author-pubkey:foreign-comic'])

    render(<LibraryScreen />, { wrapper: Wrapper })

    expect(screen.getByText('Foreign Comic')).toBeInTheDocument()
    expect(screen.getByAltText('Foreign Comic')).toBeInTheDocument()
    expect(screen.queryByText(/loading from library sync/i)).not.toBeInTheDocument()
  })
})
