// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY, NEVER, of, throwError, type Observable } from 'rxjs'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { NostrService } from '../services/NostrService'
import { useRelayStore } from '../stores/relayStore'

// Throwaway key so the real EventStore accepts the fixtures (it verifies signatures).
const SECRET = generateSecretKey()
const ME = getPublicKey(SECRET)

function contactList(tags: string[][], createdAt: number, content = ''): NostrEvent {
  return finalizeEvent({ kind: 3, created_at: createdAt, tags, content }, SECRET)
}

function setup(relayResponse: Observable<NostrEvent>) {
  const service = new NostrService()
  const signEvent = vi.fn(async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
    ...template,
    id: 'signed',
    pubkey: ME,
    sig: 'sig',
  }))
  vi.spyOn(service.accountManager, 'active', 'get').mockReturnValue({ pubkey: ME, signer: { signEvent } } as never)
  service.relayPool.request = vi.fn(() => relayResponse) as never
  const publishEvent = vi.spyOn(service, 'publishEvent').mockResolvedValue([])
  return { service, signEvent, publishEvent }
}

beforeEach(() => {
  useRelayStore.setState({ relays: ['wss://relay.example'] })
})

afterEach(() => {
  vi.useRealTimers()
  useRelayStore.setState({ relays: [] })
})

describe('NostrService.setFollow', () => {
  it('adds a follow while keeping relay hints, petnames, other tags and content', async () => {
    const existing = contactList(
      [
        ['p', 'alice', 'wss://alice.relay', 'Alice'],
        ['t', 'manga'],
      ],
      100,
      '{"wss://relay.example":{"read":true,"write":true}}',
    )
    const { service, signEvent, publishEvent } = setup(of(existing))

    const follows = await service.setFollow('bob', true)

    expect(follows).toEqual(['alice', 'bob'])
    expect(signEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 3,
        content: existing.content,
        tags: [['p', 'alice', 'wss://alice.relay', 'Alice'], ['t', 'manga'], ['p', 'bob']],
      }),
    )
    expect(publishEvent).toHaveBeenCalledTimes(1)
  })

  it('removes only the unfollowed pubkey', async () => {
    const existing = contactList(
      [
        ['p', 'alice', 'wss://alice.relay', 'Alice'],
        ['p', 'bob'],
      ],
      100,
    )
    const { service, signEvent } = setup(of(existing))

    expect(await service.setFollow('bob', false)).toEqual(['alice'])
    expect(signEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [['p', 'alice', 'wss://alice.relay', 'Alice']] }),
    )
  })

  it('builds on the newest list when relays have a newer one than the local store', async () => {
    const { service, signEvent } = setup(of(contactList([['p', 'alice'], ['p', 'carol']], 200)))
    service.eventStore.add(contactList([['p', 'alice']], 100))

    await service.setFollow('bob', true)

    expect(signEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [['p', 'alice'], ['p', 'carol'], ['p', 'bob']] }),
    )
  })

  it('does not publish when the follow state is already as requested', async () => {
    const { service, publishEvent } = setup(of(contactList([['p', 'bob']], 100)))

    expect(await service.setFollow('bob', true)).toEqual(['bob'])
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('starts a new list when relays confirm the user has none', async () => {
    const { service, signEvent } = setup(EMPTY)

    expect(await service.setFollow('bob', true)).toEqual(['bob'])
    expect(signEvent).toHaveBeenCalledWith(expect.objectContaining({ tags: [['p', 'bob']], content: '' }))
  })

  it('refuses to publish when relays time out and nothing is cached', async () => {
    vi.useFakeTimers()
    const { service, publishEvent } = setup(NEVER)

    const result = service.setFollow('bob', true)
    const assertion = expect(result).rejects.toThrow(/could not load your contact list/i)
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('refuses to publish when the relay request fails and nothing is cached', async () => {
    const { service, publishEvent } = setup(throwError(() => new Error('socket closed')))

    await expect(service.setFollow('bob', true)).rejects.toThrow(/could not load your contact list/i)
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('falls back to the cached list when relays fail', async () => {
    const { service, signEvent } = setup(throwError(() => new Error('socket closed')))
    service.eventStore.add(contactList([['p', 'alice']], 100))

    await service.setFollow('bob', true)

    expect(signEvent).toHaveBeenCalledWith(expect.objectContaining({ tags: [['p', 'alice'], ['p', 'bob']] }))
  })

  it('runs concurrent toggles one after another so neither change is lost', async () => {
    const { service, signEvent } = setup(EMPTY)
    service.eventStore.add(contactList([['p', 'alice']], 100))
    // Each publish lands in the store, as publishEvent does after a relay accepts it.
    vi.spyOn(service, 'publishEvent').mockImplementation(async (event) => {
      service.eventStore.add(finalizeEvent({ ...event, created_at: event.created_at }, SECRET))
      return []
    })

    const [first, second] = await Promise.all([service.setFollow('bob', true), service.setFollow('carol', true)])

    expect(first).toEqual(['alice', 'bob'])
    expect(second).toEqual(['alice', 'bob', 'carol'])
    expect(signEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: [['p', 'alice'], ['p', 'bob'], ['p', 'carol']] }),
    )
  })
})

function serverList(tags: string[][], createdAt: number): NostrEvent {
  return finalizeEvent({ kind: 10063, created_at: createdAt, tags, content: '' }, SECRET)
}

describe('NostrService.setBlossomServer', () => {
  it('adds a server to the existing list instead of replacing it', async () => {
    const { service, signEvent } = setup(of(serverList([['server', 'https://a.example']], 100)))

    expect(await service.setBlossomServer('https://b.example', true)).toEqual([
      'https://a.example',
      'https://b.example',
    ])
    expect(signEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 10063, tags: [['server', 'https://a.example'], ['server', 'https://b.example']] }),
    )
  })

  it('removes a server, matching despite a trailing slash', async () => {
    const { service, signEvent } = setup(
      of(serverList([['server', 'https://a.example/'], ['server', 'https://b.example']], 100)),
    )

    expect(await service.setBlossomServer('https://a.example', false)).toEqual(['https://b.example'])
    expect(signEvent).toHaveBeenCalledWith(expect.objectContaining({ tags: [['server', 'https://b.example']] }))
  })

  it('does not publish a duplicate server', async () => {
    const { service, publishEvent } = setup(of(serverList([['server', 'https://a.example']], 100)))

    expect(await service.setBlossomServer('https://A.example/', true)).toEqual(['https://a.example'])
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('refuses to publish when the list cannot be loaded', async () => {
    const { service, publishEvent } = setup(throwError(() => new Error('socket closed')))

    await expect(service.setBlossomServer('https://b.example', true)).rejects.toThrow(
      /could not load your blossom server list/i,
    )
    expect(publishEvent).not.toHaveBeenCalled()
  })
})
