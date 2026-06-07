import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FeedScreen } from '../screens/Feed'
import type { Comic } from '../types'

const mockComics: Comic[] = [
  {
    id: 'ev1',
    pubkey: 'pubkey1',
    dTag: 'dragon-ball',
    publishedAt: 1700000000,
    title: 'Dragon Ball',
    author: 'Toriyama',
    authorPubkey: 'author-pubkey',
    description: 'A classic adventure comic.',
    coverHash: '',
    blossomServer: '',
    tags: ['action'],
    nsfw: false,
    eventId: 'ev1',
  },
  {
    id: 'ev2',
    pubkey: 'pubkey2',
    dTag: 'naruto',
    publishedAt: 1700000100,
    title: 'Naruto',
    author: '',
    authorPubkey: 'other-author-pubkey',
    description: 'Shonen ninja comic.',
    coverHash: '',
    blossomServer: '',
    tags: ['shonen'],
    nsfw: false,
    eventId: 'ev2',
  },
  {
    id: 'ev3',
    pubkey: 'pubkey3',
    dTag: 'adult-comic',
    publishedAt: 1700000200,
    title: 'Adult Comic',
    author: '',
    authorPubkey: 'adult-author',
    description: '',
    coverHash: '',
    blossomServer: '',
    tags: [],
    nsfw: true,
    eventId: 'ev3',
  },
]

function resolveAuthorPubkey(comic: Comic) {
  return comic.authorPubkey || comic.pubkey
}

function matchesQuery(comic: Comic, query: { tag?: string; author?: string; authors?: string[]; search?: string }) {
  if (query.tag && !comic.tags.includes(query.tag)) return false
  if (query.author && resolveAuthorPubkey(comic) !== query.author) return false
  if (query.authors && query.authors.length > 0 && !query.authors.includes(resolveAuthorPubkey(comic))) {
    return false
  }

  const search = (query.search ?? '').trim().toLowerCase()
  if (search) {
    const terms = search.split(/\s+/).filter(Boolean)
    const haystack = [
      comic.title,
      comic.author,
      comic.authorPubkey,
      comic.pubkey,
      comic.dTag,
      comic.description,
      ...comic.tags,
    ]
      .join(' ')
      .toLowerCase()

    for (const term of terms) {
      if (!haystack.includes(term)) return false
    }
  }

  return true
}

function sortComics(a: Comic, b: Comic) {
  const timeA = a.publishedAt ?? 0
  const timeB = b.publishedAt ?? 0
  if (timeB !== timeA) return timeB - timeA
  return a.title.localeCompare(b.title)
}

const mockPublishContactList = vi.fn().mockResolvedValue(undefined)

const mockComicIndex = {
  subscribe: vi.fn(() => () => {}),
  getSnapshot: vi.fn(() => 0),
  queryComics: vi.fn(async (query: { limit?: number; offset?: number; tag?: string; author?: string; authors?: string[]; search?: string }) => {
    const filtered = mockComics.filter((comic) => matchesQuery(comic, query)).sort(sortComics)
    const offset = query.offset ?? 0
    const limit = query.limit ?? 60
    return {
      items: filtered.slice(offset, offset + limit),
      hasMore: filtered.length > offset + limit,
    }
  }),
  listAuthors: vi.fn(async (query: { tag?: string; authors?: string[]; search?: string }) => {
    const filtered = mockComics.filter((comic) => matchesQuery(comic, query))
    const groups = new Map<
      string,
      {
        pubkey: string
        count: number
        latest: Comic
      }
    >()

    for (const comic of filtered) {
      const authorPubkey = resolveAuthorPubkey(comic)
      const existing = groups.get(authorPubkey)
      if (!existing) {
        groups.set(authorPubkey, { pubkey: authorPubkey, count: 1, latest: comic })
        continue
      }
      existing.count += 1
      if (sortComics(comic, existing.latest) < 0) {
        existing.latest = comic
      }
    }

    return [...groups.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.latest.title.localeCompare(b.latest.title)
    })
  }),
}

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      comicIndex: mockComicIndex,
      subscribeToGlobalComics: vi.fn(() => ({ unsubscribe: vi.fn() })),
      subscribeToContactList: vi.fn(() => ({ unsubscribe: vi.fn() })),
      subscribeToComicsByAuthors: vi.fn(() => ({ unsubscribe: vi.fn() })),
      fetchProfile: vi.fn(async (pubkey: string) =>
        pubkey === 'author-pubkey' ? { name: 'Akira Toriyama' } : null,
      ),
      publishContactList: mockPublishContactList,
    },
  }),
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string | null }) => unknown) =>
    sel({ pubkey: 'mypubkey' }),
}))

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: { showNsfw: boolean }) => unknown) =>
    sel({ showNsfw: false }),
}))

vi.mock('../stores/blossomStore', () => ({
  DEFAULT_BLOSSOM_SERVERS: [
    'https://blossom.primal.net',
    'https://blossom.band',
    'https://cdn.satellite.earth',
  ],
  useBlossomStore: (
    sel: (s: {
      servers: { url: string }[]
      primaryServer: () => string | undefined
      cachedHashes: Record<string, string>
    }) => unknown,
  ) => sel({ servers: [], primaryServer: () => 'https://blossom.example', cachedHashes: {} }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter initialEntries={['/feed']}>{children}</MemoryRouter>
}

describe('FeedScreen', () => {
  beforeEach(() => {
    mockPublishContactList.mockClear()
    mockComicIndex.queryComics.mockClear()
    mockComicIndex.listAuthors.mockClear()
  })

  it('renders Global and Follows tabs', () => {
    render(<FeedScreen />, { wrapper: Wrapper })
    expect(screen.getByText('Global')).toBeInTheDocument()
    expect(screen.getByText('Follows')).toBeInTheDocument()
  })

  it('shows empty state when no comics match', async () => {
    render(
      <MemoryRouter initialEntries={['/feed?tag=missing']}>
        <FeedScreen />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/no comics found/i)).toBeInTheDocument()
  })

  it('shows comic title in global tab when index results are present', async () => {
    render(<FeedScreen />, { wrapper: Wrapper })
    expect(await screen.findByText('Adult Comic')).toBeInTheDocument()
    expect(screen.getByText('Naruto')).toBeInTheDocument()
    expect(screen.getByText('Dragon Ball')).toBeInTheDocument()
  })

  it('filters comics by tag query param', async () => {
    render(
      <MemoryRouter initialEntries={['/feed?tag=action']}>
        <FeedScreen />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Dragon Ball')).toBeInTheDocument()
    expect(screen.queryByText('Naruto')).not.toBeInTheDocument()
    expect(screen.getByText('action')).toBeInTheDocument()
  })

  it('shows author names and filters comics by author query param', async () => {
    render(
      <MemoryRouter initialEntries={['/feed']}>
        <FeedScreen />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Akira Toriyama')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /by akira toriyama/i }))

    expect(screen.getByText(/author:/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('Akira Toriyama').length).toBeGreaterThan(0))
    expect(screen.queryByText('Naruto')).not.toBeInTheDocument()
  })

  it('shows the author directory on the authors tab', async () => {
    const user = userEvent.setup()
    render(<FeedScreen />, { wrapper: Wrapper })

    await user.click(screen.getByRole('button', { name: /authors/i }))

    expect(await screen.findByRole('button', { name: /akira toriyama/i })).toBeInTheDocument()
  })

  it('clicking Follows tab shows follows empty state when no contacts', async () => {
    const user = userEvent.setup()
    render(<FeedScreen />, { wrapper: Wrapper })
    await user.click(screen.getByText('Follows'))
    expect(await screen.findByText(/follow people on nostr/i)).toBeInTheDocument()
  })

  it('shows NSFW label on cover when comic is nsfw and showNsfw is false', async () => {
    render(<FeedScreen />, { wrapper: Wrapper })
    expect(await screen.findByText('Adult Comic')).toBeInTheDocument()
    expect(screen.getByText('NSFW')).toBeInTheDocument()
  })

  it('allows following and unfollowing authors on the authors tab', async () => {
    const user = userEvent.setup()
    render(<FeedScreen />, { wrapper: Wrapper })

    await user.click(screen.getByRole('button', { name: /authors/i }))

    const authorCard = screen.getByRole('button', { name: /akira toriyama/i }).parentElement?.parentElement
    expect(authorCard).toBeTruthy()
    const followBtn = within(authorCard as HTMLElement).getByRole('button', { name: /^follow$/i })
    expect(followBtn).toBeInTheDocument()

    await user.click(followBtn)
    expect(mockPublishContactList).toHaveBeenCalledWith(['author-pubkey'])

    expect(screen.getByRole('button', { name: /^unfollow$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^unfollow$/i }))
    expect(mockPublishContactList).toHaveBeenLastCalledWith([])
  })

  it('searches by title and tags', async () => {
    const user = userEvent.setup()
    render(<FeedScreen />, { wrapper: Wrapper })

    const search = screen.getByPlaceholderText(/search title/i)
    await user.type(search, 'ninja')

    expect(await screen.findByText('Naruto')).toBeInTheDocument()
    expect(screen.queryByText('Dragon Ball')).not.toBeInTheDocument()
  })
})
