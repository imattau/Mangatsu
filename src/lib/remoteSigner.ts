import { NostrConnectSigner } from 'applesauce-signers'

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

export function buildRemoteSignerPermissions() {
  return NostrConnectSigner.buildSigningPermissions(REMOTE_SIGNER_KINDS)
}
