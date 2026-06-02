import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { NostrService } from '../services/NostrService'
import { useRelayStore } from '../stores/relayStore'

const event: NostrEvent = {
  id: 'event-id',
  pubkey: 'pubkey',
  kind: 30040,
  created_at: 1700000000,
  tags: [['d', 'test-comic']],
  content: '',
  sig: 'sig',
}

afterEach(() => {
  useRelayStore.setState({ relays: [] })
})

describe('NostrService.publishEvent', () => {
  it('disconnect removes relays so reconnect can recreate them', async () => {
    useRelayStore.setState({ relays: ['wss://relay.example'] })
    const service = new NostrService()

    await service.connect()
    expect(service.relayPool.relays.size).toBe(1)

    await service.disconnect()
    expect(service.relayPool.relays.size).toBe(0)

    await service.connect()
    expect(service.relayPool.relays.size).toBe(1)
  })

  it('stores locally only after at least one relay accepts the event', async () => {
    useRelayStore.setState({ relays: ['wss://relay.example'] })
    const service = new NostrService()
    const add = vi.fn()
    const publish = vi.fn(async () => [{ ok: true, from: 'wss://relay.example' }])
    service.eventStore.add = add as never
    service.relayPool.publish = publish as never

    const responses = await service.publishEvent(event)

    expect(publish).toHaveBeenCalledWith(['wss://relay.example'], event)
    expect(add).toHaveBeenCalledWith(event)
    expect(responses).toEqual([{ ok: true, from: 'wss://relay.example' }])
  })

  it('throws when no relay accepts the event', async () => {
    useRelayStore.setState({ relays: ['wss://relay.example'] })
    const service = new NostrService()
    const add = vi.fn()
    const publish = vi.fn(async () => [{ ok: false, from: 'wss://relay.example', message: 'duplicate' }])
    service.eventStore.add = add as never
    service.relayPool.publish = publish as never

    await expect(service.publishEvent(event)).rejects.toThrow(/Failed to publish event/i)
    expect(add).not.toHaveBeenCalled()
  })
})
