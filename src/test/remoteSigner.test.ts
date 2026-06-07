import { describe, expect, it } from 'vitest'
import { buildRemoteSignerPermissions, buildRemoteSignerRelays } from '../lib/remoteSigner'

describe('remote signer permissions', () => {
  it('includes the event kinds Mangatsu signs with remote accounts', () => {
    expect(buildRemoteSignerPermissions()).toEqual(
      expect.arrayContaining([
        expect.stringContaining(':0'),
        expect.stringContaining(':1'),
        expect.stringContaining(':3'),
        expect.stringContaining(':5'),
        expect.stringContaining(':1111'),
        expect.stringContaining(':24242'),
        expect.stringContaining(':30003'),
        expect.stringContaining(':30040'),
        expect.stringContaining(':30041'),
        expect.stringContaining(':30301'),
        expect.stringContaining(':10063'),
      ]),
    )
  })

  it('includes fallback relays for remote signer connections', () => {
    expect(buildRemoteSignerRelays(['wss://relay.damus.io'])).toEqual([
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://nos.lol',
      'wss://relay.nostr.band',
    ])
  })
})
