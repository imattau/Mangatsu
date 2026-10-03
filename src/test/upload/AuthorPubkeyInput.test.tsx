import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorPubkeyInput } from '../../screens/Upload/AuthorPubkeyInput'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

const mockSearchProfiles = vi.fn()
const mockQueryProfile = vi.fn()

vi.mock('nostr-tools/nip05', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nostr-tools/nip05')>()),
  queryProfile: (name: string) => mockQueryProfile(name),
}))

vi.mock('../../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      eventStore: {},
      searchProfiles: mockSearchProfiles,
      relayPool: { subscription: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) },
    },
    syncGeneration: 0,
  }),
}))

async function search(query: string) {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<AuthorPubkeyInput value="" onChange={onChange} />)
  await user.click(screen.getByRole('button', { name: /search by name/i }))
  await user.type(screen.getByRole('searchbox'), query)
  return { user, onChange }
}

describe('AuthorPubkeyInput search', () => {
  beforeEach(() => {
    mockSearchProfiles.mockReset()
    mockQueryProfile.mockReset()
  })

  it('searches relays and fills in the chosen author', async () => {
    mockSearchProfiles.mockResolvedValue([
      { pubkey: ALICE, displayName: 'Alice', nip05: 'alice@example.com' },
    ])
    const { user, onChange } = await search('alice')

    await user.click(await screen.findByRole('button', { name: /alice/i }))

    expect(mockSearchProfiles).toHaveBeenCalledWith('alice')
    expect(mockQueryProfile).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith(ALICE, 'Alice')
  })

  it('says when nothing matched', async () => {
    mockSearchProfiles.mockResolvedValue([])
    await search('nobody')

    expect(await screen.findByText(/no profiles found for "nobody"/i)).toBeInTheDocument()
  })

  it('puts the NIP-05 owner first when the query is an address', async () => {
    mockQueryProfile.mockResolvedValue({ pubkey: BOB, relays: [] })
    mockSearchProfiles.mockResolvedValue([{ pubkey: ALICE, displayName: 'Alice' }])
    await search('bob@example.com')

    const options = await screen.findAllByRole('button', { name: /bob@example.com|alice/i })
    expect(options[0]).toHaveTextContent('bob@example.com')
    expect(options[1]).toHaveTextContent('Alice')
  })
})
