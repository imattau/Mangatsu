import { describe, it, expect } from 'vitest'
import { useRelayStore, DEFAULT_RELAYS } from '../stores/relayStore'

describe('relayStore', () => {
  it('returns defaults when no relays set', () => {
    useRelayStore.setState({ relays: [] })
    expect(useRelayStore.getState().activeRelays()).toEqual(DEFAULT_RELAYS)
  })

  it('returns user relays when set', () => {
    useRelayStore.setState({ relays: ['wss://custom.relay'] })
    expect(useRelayStore.getState().activeRelays()).toEqual(['wss://custom.relay'])
  })
})
