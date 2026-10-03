// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NEVER, concat, of } from 'rxjs'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { NostrService, SEARCH_RELAYS } from '../services/NostrService'

function profile(pubkey: string, content: Record<string, unknown>, createdAt = 100): NostrEvent {
  return { id: `${pubkey}-${createdAt}`, pubkey, kind: 0, created_at: createdAt, tags: [], content: JSON.stringify(content), sig: '' }
}

describe('NostrService.searchProfiles', () => {
  it('sends a NIP-50 search to the search relays only', async () => {
    const service = new NostrService()
    const request = vi.fn(() => of<NostrEvent>())
    service.relayPool.request = request as never

    await service.searchProfiles('  alice ')

    expect(request).toHaveBeenCalledWith(SEARCH_RELAYS, [expect.objectContaining({ kinds: [0], search: 'alice' })])
  })

  it('keeps the newest profile per author and puts text matches first', async () => {
    const service = new NostrService()
    service.relayPool.request = vi.fn(() =>
      of(
        profile('bob', { name: 'Bob', about: 'friends with alice' }),
        profile('alice', { name: 'old name' }, 100),
        profile('alice', { display_name: 'Alice', nip05: 'alice@example.com', picture: 'https://img/a.png' }, 200),
        profile('carol', { name: 'Carol', nip05: 'carol@alice.dev' }),
        profile('empty', {}),
      ),
    ) as never

    const results = await service.searchProfiles('alice')

    expect(results).toEqual([
      { pubkey: 'alice', displayName: 'Alice', nip05: 'alice@example.com', picture: 'https://img/a.png' },
      { pubkey: 'carol', displayName: 'Carol', nip05: 'carol@alice.dev', picture: undefined },
      { pubkey: 'bob', displayName: 'Bob', nip05: undefined, picture: undefined },
    ])
  })

  it('returns what arrived before the timeout when a relay never finishes', async () => {
    vi.useFakeTimers()
    const service = new NostrService()
    service.relayPool.request = vi.fn(() => concat(of(profile('alice', { name: 'Alice' })), NEVER)) as never

    const result = service.searchProfiles('alice')
    await vi.advanceTimersByTimeAsync(5000)

    expect(await result).toEqual([expect.objectContaining({ pubkey: 'alice' })])
    vi.useRealTimers()
  })

  it('returns nothing for a blank query without contacting relays', async () => {
    const service = new NostrService()
    const request = vi.fn()
    service.relayPool.request = request as never

    expect(await service.searchProfiles('   ')).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })
})
