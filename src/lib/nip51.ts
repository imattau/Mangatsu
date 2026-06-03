import { nip44 } from 'nostr-tools'

export function encodeLibraryList(aTags: string[]): string {
  return JSON.stringify(aTags)
}

export function decodeLibraryList(content: string): string[] {
  if (!content) return []
  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export interface Nip44Signer {
  nip44?: {
    encrypt: (recipientPubkey: string, plaintext: string) => Promise<string>
    decrypt: (senderPubkey: string, ciphertext: string) => Promise<string>
  }
  getPublicKey?: () => Promise<string>
}

/**
 * Encrypt plaintext to self using NIP-44.
 * Uses window.nostr.nip44 (NIP-07 ext) if available, otherwise uses a raw conversationKey
 * derived from the provided secretKey (for nsec login).
 */
export async function encryptToSelf(
  plaintext: string,
  opts: { windowNostr?: Nip44Signer; secretKey?: Uint8Array; pubkey: string },
): Promise<string> {
  if (opts.windowNostr?.nip44 && opts.windowNostr?.getPublicKey) {
    return opts.windowNostr.nip44.encrypt(opts.pubkey, plaintext)
  }
  if (opts.secretKey) {
    const conversationKey = nip44.v2.utils.getConversationKey(opts.secretKey, opts.pubkey)
    return nip44.v2.encrypt(plaintext, conversationKey)
  }
  throw new Error('No signer available for NIP-44 encryption')
}

export async function decryptFromSelf(
  ciphertext: string,
  opts: { windowNostr?: Nip44Signer; secretKey?: Uint8Array; pubkey: string },
): Promise<string> {
  if (opts.windowNostr?.nip44 && opts.windowNostr?.getPublicKey) {
    return opts.windowNostr.nip44.decrypt(opts.pubkey, ciphertext)
  }
  if (opts.secretKey) {
    const conversationKey = nip44.v2.utils.getConversationKey(opts.secretKey, opts.pubkey)
    return nip44.v2.decrypt(ciphertext, conversationKey)
  }
  throw new Error('No signer available for NIP-44 decryption')
}
