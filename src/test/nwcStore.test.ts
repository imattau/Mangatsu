import { describe, it, expect, beforeEach } from 'vitest'
import { useNwcStore } from '../stores/nwcStore'

describe('nwcStore', () => {
  beforeEach(() => {
    useNwcStore.setState({ connectionString: null })
  })

  it('starts with null connectionString', () => {
    expect(useNwcStore.getState().connectionString).toBeNull()
  })

  it('sets a connection string', () => {
    const uri = 'nostr+walletconnect://pubkey?relay=wss://relay.example&secret=abc123'
    useNwcStore.getState().setConnectionString(uri)
    expect(useNwcStore.getState().connectionString).toBe(uri)
  })

  it('clears the connection string', () => {
    useNwcStore.getState().setConnectionString('nostr+walletconnect://something')
    useNwcStore.getState().setConnectionString(null)
    expect(useNwcStore.getState().connectionString).toBeNull()
  })
})
