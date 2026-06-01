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
