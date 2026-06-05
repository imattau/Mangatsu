import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FeedScreen } from '../screens/Feed'
import type { NostrEvent } from 'applesauce-core/helpers/event'

// Minimal mock comic events
const mockComicEvent: NostrEvent = {
  id: 'ev1',
  pubkey: 'pubkey1',
  kind: 30040,
  created_at: 1700000000,
  tags: [
    ['d', 'dragon-ball'],
    ['title', 'Dragon Ball'],
    ['author', 'Toriyama'],
    ['author_pubkey', 'author-pubkey'],
    ['L', 'com.mangatsu'],
    ['t', 'action'],
  ],
  content: '',
  sig: 'sig1',
}

const mockOtherComicEvent: NostrEvent = {
  id: 'ev2',
  pubkey: 'pubkey2',
  kind: 30040,
  created_at: 1700000100,
  tags: [
    ['d', 'naruto'],
    ['title', 'Naruto'],
    ['author_pubkey', 'other-author-pubkey'],
    ['L', 'com.mangatsu'],
    ['t', 'shonen'],
  ],
  content: '',
  sig: 'sig2',
}

let mockObservableState: NostrEvent[] | null = []
let mockShowNsfw = false

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
      fetchProfile: vi.fn(async (pubkey: string) =>
        pubkey === 'author-pubkey' ? { name: 'Akira Toriyama' } : null,
      ),
    },
  }),
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string | null }) => unknown) =>
    sel({ pubkey: 'mypubkey' }),
}))

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: { showNsfw: boolean }) => unknown) =>
    sel({ showNsfw: mockShowNsfw }),
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
  return <MemoryRouter initialEntries={['/feed']}>{children}</MemoryRouter>
}

describe('FeedScreen', () => {
  beforeEach(() => {
    mockObservableState = []
    mockShowNsfw = false
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

  it('filters comics by tag query param', () => {
    mockObservableState = [mockComicEvent, mockOtherComicEvent]
    render(
      <MemoryRouter initialEntries={['/feed?tag=action']}>
        <FeedScreen />
      </MemoryRouter>,
    )

    expect(screen.getByText('Dragon Ball')).toBeInTheDocument()
    expect(screen.queryByText('Naruto')).not.toBeInTheDocument()
    expect(screen.getByText('action')).toBeInTheDocument()
  })

  it('shows author names and filters comics by author query param', async () => {
    mockObservableState = [mockComicEvent, mockOtherComicEvent]
    render(
      <MemoryRouter initialEntries={['/feed']}>
        <FeedScreen />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Akira Toriyama')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /by akira toriyama/i }))

    expect(screen.getByText(/author:/i)).toBeInTheDocument()
    expect(screen.getAllByText('Akira Toriyama').length).toBeGreaterThan(0)
    expect(screen.queryByText('Naruto')).not.toBeInTheDocument()
  })

  it('shows the author directory on the authors tab', async () => {
    mockObservableState = [mockComicEvent, mockOtherComicEvent]
    const user = userEvent.setup()
    render(<FeedScreen />, { wrapper: Wrapper })

    await user.click(screen.getByRole('button', { name: /authors/i }))

    expect(await screen.findByRole('button', { name: /akira toriyama/i })).toBeInTheDocument()
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

  it('shows NSFW label on cover when comic has content-warning and showNsfw is false', () => {
    const nsfwEvent: NostrEvent = {
      id: 'ev-nsfw',
      pubkey: 'pubkey1',
      kind: 30040,
      created_at: 1700000000,
      tags: [
        ['d', 'adult-comic'],
        ['title', 'Adult Comic'],
        ['L', 'com.mangatsu'],
        ['content-warning', 'NSFW'],
      ],
      content: '',
      sig: 'sig-nsfw',
    }
    mockObservableState = [nsfwEvent]
    mockShowNsfw = false
    render(<FeedScreen />, { wrapper: Wrapper })
    expect(screen.getByText('Adult Comic')).toBeInTheDocument()
    expect(screen.getByText('NSFW')).toBeInTheDocument()
  })

  it('does not show NSFW label when showNsfw is true', () => {
    const nsfwEvent: NostrEvent = {
      id: 'ev-nsfw',
      pubkey: 'pubkey1',
      kind: 30040,
      created_at: 1700000000,
      tags: [
        ['d', 'adult-comic'],
        ['title', 'Adult Comic'],
        ['L', 'com.mangatsu'],
        ['content-warning', 'NSFW'],
      ],
      content: '',
      sig: 'sig-nsfw',
    }
    mockObservableState = [nsfwEvent]
    mockShowNsfw = true
    render(<FeedScreen />, { wrapper: Wrapper })
    expect(screen.getByText('Adult Comic')).toBeInTheDocument()
    expect(screen.queryByText('NSFW')).not.toBeInTheDocument()
  })
})
