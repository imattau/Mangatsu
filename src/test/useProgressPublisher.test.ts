import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProgressPublisher } from '../screens/Reader/useProgressPublisher'

const build = vi.fn(async (template: object) => ({ ...template, created_at: 1 }))
const signEvent = vi.fn(async (template: object) => ({ ...template, id: 'id', pubkey: 'me', sig: 'sig' }))
const publishEvent = vi.fn(async () => [])
const group = vi.fn()

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      accountManager: { active: { pubkey: 'me', signer: { signEvent } } },
      eventFactory: { build },
      publishEvent,
      relayPool: { group },
    },
  }),
}))

describe('useProgressPublisher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    build.mockClear()
    signEvent.mockClear()
    publishEvent.mockReset().mockResolvedValue([])
    group.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("publishes the latest page to the user's relays after a pause", async () => {
    const { rerender } = renderHook(({ page }) => useProgressPublisher('comic/chapter-1', page), {
      initialProps: { page: 1 },
    })
    rerender({ page: 2 })
    rerender({ page: 3 })

    await vi.advanceTimersByTimeAsync(2000)

    expect(publishEvent).toHaveBeenCalledTimes(1)
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30301,
        tags: [
          ['d', 'comic/chapter-1'],
          ['page', '3'],
        ],
      }),
    )
    // publishEvent picks the user's relays; nothing goes to a separate hard-coded set.
    expect(group).not.toHaveBeenCalled()
  })

  it('ignores publish failures', async () => {
    publishEvent.mockRejectedValue(new Error('Failed to publish event'))
    renderHook(() => useProgressPublisher('comic/chapter-1', 4))

    await vi.advanceTimersByTimeAsync(2000)

    expect(publishEvent).toHaveBeenCalledTimes(1)
  })
})
