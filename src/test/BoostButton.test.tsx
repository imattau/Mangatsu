import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { npubEncode } from 'nostr-tools/nip19'
import { BoostButton } from '@/components/BoostButton'
import type { Comic } from '@/types'

const mockSignEvent = vi.fn(async (template: object) => ({ ...template, id: 'boost-event', sig: 'sig', pubkey: 'pubkey' }))
const mockPublishEvent = vi.fn(async (_event?: unknown) => undefined)

vi.mock('@/context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      activeAccount: { signer: { signEvent: (template: unknown) => mockSignEvent(template as object) } },
      publishEvent: (event: unknown) => mockPublishEvent(event),
    },
  }),
}))

vi.mock('@/lib/boost', async () => {
  const actual = await vi.importActual<typeof import('@/lib/boost')>('@/lib/boost')
  return {
    ...actual,
    resolveComicBoostCoverUrl: vi.fn(async () => 'https://blossom.example/coverhash'),
  }
})

const comic: Comic = {
  id: 'comic-1',
  pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
  dTag: 'one-piece',
  title: 'One Piece',
  author: 'Eiichiro Oda',
  authorPubkey: '0000000000000000000000000000000000000000000000000000000000000001',
  description: 'Adventure',
  coverHash: 'coverhash',
  blossomServer: 'https://blossom.example',
  coverServer: 'https://blossom.example',
  coverServers: ['https://blossom.example'],
  tags: ['adventure', 'shonen'],
  eventId: 'event-1',
}

describe('BoostButton', () => {
  beforeEach(() => {
    mockSignEvent.mockClear()
    mockPublishEvent.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('publishes a boost note with the comic cover, author, tags and link', async () => {
    const user = userEvent.setup()
    render(
      <BoostButton
        comic={comic}
        comicUrl={`https://mangatsu.example/comic/one-piece?pubkey=${comic.pubkey}`}
        appOrigin="https://mangatsu.example"
        blossomServers={['https://blossom.example']}
      />,
    )

    await user.click(screen.getByRole('button', { name: /boost comic/i }))

    await waitFor(() => {
      expect(mockSignEvent).toHaveBeenCalledTimes(1)
      expect(mockPublishEvent).toHaveBeenCalledTimes(1)
    })

    expect(mockSignEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 1,
        created_at: expect.any(Number),
        content: [
          'https://blossom.example/coverhash',
          'Check out One Piece by Eiichiro Oda',
          `nostr:${npubEncode(comic.authorPubkey)}`,
          `https://mangatsu.example/comic/one-piece?pubkey=${comic.pubkey}`,
          '#adventure #shonen',
          'Get #mangatsu at https://mangatsu.example',
        ].join('\n'),
      tags: [
        [`r`, `https://mangatsu.example/comic/one-piece?pubkey=${comic.pubkey}`],
        ['image', 'https://blossom.example/coverhash', 'One Piece'],
        ['imeta', 'url https://blossom.example/coverhash', 'm image/webp', 'alt One Piece', `x ${comic.coverHash}`],
        ['p', comic.authorPubkey],
        ['t', 'adventure'],
        ['t', 'shonen'],
      ],
      }),
    )
  })
})
