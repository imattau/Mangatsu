// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY, NEVER, of, type Observable } from 'rxjs'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip44 } from 'nostr-tools'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { NostrService } from '../services/NostrService'
import { useRelayStore } from '../stores/relayStore'

// Throwaway key so the real EventStore accepts the fixtures and NIP-44 round-trips.
const SECRET = generateSecretKey()
const ME = getPublicKey(SECRET)
const CONVERSATION_KEY = nip44.v2.utils.getConversationKey(SECRET, ME)

const encrypt = (plaintext: string) => nip44.v2.encrypt(plaintext, CONVERSATION_KEY)
const decrypt = (ciphertext: string) => nip44.v2.decrypt(ciphertext, CONVERSATION_KEY)

function libraryList(entries: unknown[], createdAt: number, extraTags: string[][] = []): NostrEvent {
  return finalizeEvent(
    {
      kind: 30003,
      created_at: createdAt,
      tags: [['d', 'mangatsu-library'], ...extraTags],
      content: encrypt(JSON.stringify(entries)),
    },
    SECRET,
  )
}

function setup(relayResponse: Observable<NostrEvent>) {
  const service = new NostrService()
  const signEvent = vi.fn(async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
    ...template,
    id: 'signed',
    pubkey: ME,
    sig: 'sig',
  }))
  const signer = {
    signEvent,
    nip44: {
      encrypt: async (_pubkey: string, plaintext: string) => encrypt(plaintext),
      decrypt: async (_pubkey: string, ciphertext: string) => decrypt(ciphertext),
    },
  }
  vi.spyOn(service.accountManager, 'active', 'get').mockReturnValue({ pubkey: ME, signer } as never)
  const request = vi.fn(() => relayResponse)
  service.relayPool.request = request as never
  const publishEvent = vi.spyOn(service, 'publishEvent').mockResolvedValue([])
  return { service, signEvent, publishEvent, request }
}

function publishedEntries(signEvent: ReturnType<typeof setup>['signEvent']): unknown[] {
  const template = signEvent.mock.calls.at(-1)?.[0]
  return JSON.parse(decrypt(template?.content ?? ''))
}

beforeEach(() => {
  useRelayStore.setState({ relays: ['wss://relay.example'] })
})

afterEach(() => {
  vi.useRealTimers()
  useRelayStore.setState({ relays: [] })
})

describe('NostrService.setLibraryEntry', () => {
  it('adds a comic to the list on relays, keeping existing entries and tags', async () => {
    const existing = libraryList(
      ['30040:alice:moon', ['a', '30040:bob:sun'], ['t', 'favourite']],
      100,
      [['title', 'My library']],
    )
    const { service, signEvent, publishEvent, request } = setup(of(existing))

    const saved = await service.setLibraryEntry('30040:carol:star', true)

    expect(request).toHaveBeenCalledWith(['wss://relay.example'], [
      expect.objectContaining({ kinds: [30003], authors: [ME], '#d': ['mangatsu-library'] }),
    ])
    expect(saved).toEqual(['30040:alice:moon', '30040:bob:sun', '30040:carol:star'])
    expect(publishedEntries(signEvent)).toEqual([
      '30040:alice:moon',
      ['a', '30040:bob:sun'],
      ['t', 'favourite'],
      '30040:carol:star',
    ])
    expect(signEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30003,
        tags: [['d', 'mangatsu-library'], ['title', 'My library']],
      }),
    )
    expect(signEvent.mock.calls[0][0].created_at).toBeGreaterThan(100)
    expect(publishEvent).toHaveBeenCalledTimes(1)
  })

  it('removes a comic saved in either entry format', async () => {
    const existing = libraryList(['30040:alice:moon', ['a', '30040:bob:sun']], 100)
    const { service, signEvent } = setup(of(existing))

    expect(await service.setLibraryEntry('30040:bob:sun', false)).toEqual(['30040:alice:moon'])
    expect(publishedEntries(signEvent)).toEqual(['30040:alice:moon'])
  })

  it('does not publish when the list already matches', async () => {
    const existing = libraryList(['30040:alice:moon'], 100)
    const { service, publishEvent } = setup(of(existing))

    expect(await service.setLibraryEntry('30040:alice:moon', true)).toEqual(['30040:alice:moon'])
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('starts a new list when relays confirm there is none', async () => {
    const { service, signEvent } = setup(EMPTY)

    expect(await service.setLibraryEntry('30040:alice:moon', true)).toEqual(['30040:alice:moon'])
    expect(publishedEntries(signEvent)).toEqual(['30040:alice:moon'])
    expect(signEvent.mock.calls[0][0].tags).toEqual([['d', 'mangatsu-library']])
  })

  it('refuses to publish when the list cannot be loaded', async () => {
    vi.useFakeTimers()
    const { service, publishEvent } = setup(NEVER)

    const result = service.setLibraryEntry('30040:alice:moon', true)
    const assertion = expect(result).rejects.toThrow(/could not load your library/i)
    await vi.advanceTimersByTimeAsync(8000)
    await assertion
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('refuses to publish when the existing list cannot be decrypted', async () => {
    const existing = finalizeEvent(
      { kind: 30003, created_at: 100, tags: [['d', 'mangatsu-library']], content: 'not-ciphertext' },
      SECRET,
    )
    const { service, publishEvent } = setup(of(existing))

    await expect(service.setLibraryEntry('30040:alice:moon', true)).rejects.toThrow(/could not decrypt/i)
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('refuses to publish when the decrypted list is not an array', async () => {
    const existing = finalizeEvent(
      { kind: 30003, created_at: 100, tags: [['d', 'mangatsu-library']], content: encrypt('{"a":1}') },
      SECRET,
    )
    const { service, publishEvent } = setup(of(existing))

    await expect(service.setLibraryEntry('30040:alice:moon', true)).rejects.toThrow(/unknown format/i)
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('applies concurrent edits on top of each other', async () => {
    const { service, signEvent } = setup(EMPTY)
    // Feed each publish back into the store, as publishEvent does for real.
    vi.spyOn(service, 'publishEvent').mockImplementation(async (event) => {
      service.eventStore.add(finalizeEvent({ ...event, created_at: event.created_at }, SECRET))
      return []
    })

    await Promise.all([
      service.setLibraryEntry('30040:alice:moon', true),
      service.setLibraryEntry('30040:bob:sun', true),
    ])

    expect(publishedEntries(signEvent)).toEqual(['30040:alice:moon', '30040:bob:sun'])
  })
})
