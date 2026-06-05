import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { createCommentTagsForEvent } from 'applesauce-common/helpers'
import { ComicCommentsSection } from '../components/ComicComments'
import type { Comic } from '../types'

const mockSubscribeToComicComments = vi.fn(() => ({ unsubscribe: vi.fn() }))
const mockPublishEvent = vi.fn(async () => undefined)
const mockFetchProfile = vi.fn(async (pubkey: string) => {
  const profiles: Record<string, { name: string; picture: string }> = {
    'root-author': { name: 'Manga Fan', picture: 'https://example.com/root.png' },
    'reply-author': { name: 'Reply Bird', picture: 'https://example.com/reply.png' },
    'current-user': { name: 'Current User', picture: 'https://example.com/current.png' },
  }
  return profiles[pubkey] ?? null
})
const mockCommentFactory = vi.fn(async (parent: NostrEvent, content: string) => ({
  kind: 1111,
  content,
  tags: createCommentTagsForEvent(parent),
  created_at: Math.floor(Date.now() / 1000),
}))
const mockSignEvent = vi.fn(async (template: object) => ({
  ...(template as Record<string, unknown>),
  id: 'signed-comment',
  sig: 'sig',
  pubkey: 'current-user',
}))

const mockComic: Comic = {
  id: 'comic-event',
  pubkey: 'comic-author',
  dTag: 'one-piece',
  title: 'One Piece',
  author: 'Eiichiro Oda',
  authorPubkey: 'comic-author',
  description: '',
  coverHash: 'coverhash',
  blossomServer: 'https://blossom.example',
  tags: ['adventure'],
  eventId: 'comic-event',
}

const comicEvent: NostrEvent = {
  id: 'comic-event',
  kind: 30040,
  pubkey: 'comic-author',
  created_at: 1700000000,
  content: '',
  tags: [
    ['d', 'one-piece'],
    ['title', 'One Piece'],
  ],
  sig: 'sig',
}

const rootComment: NostrEvent = {
  id: 'comment-1',
  kind: 1111,
  pubkey: 'root-author',
  created_at: 1700001000,
  content: 'Root comment',
  tags: createCommentTagsForEvent(comicEvent),
  sig: 'sig',
}

const replyComment: NostrEvent = {
  id: 'comment-2',
  kind: 1111,
  pubkey: 'reply-author',
  created_at: 1700002000,
  content: 'Reply comment',
  tags: createCommentTagsForEvent(rootComment),
  sig: 'sig',
}

const mockCommentEvents = [rootComment, replyComment]

vi.mock('applesauce-react/hooks', () => ({
  useEventStore: () => ({
    timeline: vi.fn(() => ({ subscribe: vi.fn() })),
    getEvent: vi.fn(() => comicEvent),
  }),
  useObservableState: () => mockCommentEvents,
}))

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      activeAccount: { signer: { signEvent: mockSignEvent } },
      eventFactory: { comment: mockCommentFactory },
      subscribeToComicComments: mockSubscribeToComicComments,
      publishEvent: mockPublishEvent,
      fetchProfile: mockFetchProfile,
    },
    syncGeneration: 0,
  }),
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string | null }) => unknown) =>
    sel({ pubkey: 'current-user' }),
}))

vi.mock('../stores/relayStore', () => ({
  DEFAULT_RELAYS: [],
  useRelayStore: (sel: (s: { relays: string[] }) => unknown) => sel({ relays: [] }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('ComicCommentsSection', () => {
  beforeEach(() => {
    mockSubscribeToComicComments.mockClear()
    mockPublishEvent.mockClear()
    mockFetchProfile.mockClear()
    mockCommentFactory.mockClear()
    mockSignEvent.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders threaded comments with author profiles', async () => {
    render(<ComicCommentsSection comic={mockComic} comicEvent={comicEvent} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('Manga Fan')).toBeInTheDocument()
      expect(screen.getByText('Reply Bird')).toBeInTheDocument()
    })

    expect(screen.getByText('Root comment')).toBeInTheDocument()
    expect(screen.getByText('Reply comment')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manga Fan' })).toHaveAttribute(
      'href',
      '/feed?author=root-author',
    )
  })

  it('publishes a reply against the selected comment target', async () => {
    const user = userEvent.setup()
    render(<ComicCommentsSection comic={mockComic} comicEvent={comicEvent} />, { wrapper: Wrapper })

    await user.click(screen.getAllByRole('button', { name: /reply/i })[0])
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox'), 'Nice chapter.')
    await user.click(screen.getByRole('button', { name: /post comment/i }))

    expect(mockCommentFactory).toHaveBeenCalledWith(rootComment, 'Nice chapter.')
    expect(mockSignEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 1111,
        content: 'Nice chapter.',
      }),
    )
    expect(mockPublishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'signed-comment',
        pubkey: 'current-user',
      }),
    )
  })
})
