import { NostrConnectSigner } from 'applesauce-signers'

export const REMOTE_SIGNER_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
]

const REMOTE_SIGNER_KINDS = [
  0,
  1,
  3,
  5,
  1111,
  24242,
  30003,
  30040,
  30041,
  30301,
  10063,
]

export function buildRemoteSignerRelays(relays: string[] = []) {
  return Array.from(new Set([...relays, ...REMOTE_SIGNER_RELAYS]))
}

export function buildRemoteSignerPermissions() {
  return NostrConnectSigner.buildSigningPermissions(REMOTE_SIGNER_KINDS)
}
