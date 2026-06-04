import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LibraryScreen } from '../screens/Library'
import { useLibraryStore } from '../stores/libraryStore'
import { usePublishQueueStore } from '../stores/publishQueueStore'

const mockPublishEvent = vi.fn(async () => undefined)
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
}

vi.mock('applesauce-react/hooks', () => ({
  useEventStore: () => ({
    timeline: vi.fn(() => ({})),
  }),
  useObservableState: () => [],
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
    mockComics = { 'comic-1': mockComic }

    render(<LibraryScreen />, { wrapper: Wrapper })

    expect(screen.getByRole('link', { name: /upload a comic/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument()
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

    expect(screen.getByText('foreign-comic')).toBeInTheDocument()
    expect(screen.getByText(/loading from library sync/i)).toBeInTheDocument()
    expect(screen.queryByText(/loading saved comics/i)).not.toBeInTheDocument()
  })
})
