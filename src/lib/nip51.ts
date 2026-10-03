import { nip44 } from 'nostr-tools'

export function encodeLibraryList(aTags: string[]): string {
  return JSON.stringify(aTags)
}

export function decodeLibraryList(content: string): string[] {
  if (!content) return []
  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed)
      ? parsed.map(libraryEntryATag).filter((v): v is string => Boolean(v))
      : []
  } catch {
    return []
  }
}

/**
 * The comic address an entry refers to: Mangatsu writes plain `30040:…` strings, while
 * standard NIP-51 private items are tags such as `['a', '30040:…']`.
 */
export function libraryEntryATag(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  if (Array.isArray(entry) && entry[0] === 'a' && typeof entry[1] === 'string') return entry[1]
  return undefined
}

/** All entries of a decrypted library list, unknown ones included. Throws if it isn't a list. */
export function parseLibraryEntries(plaintext: string): unknown[] {
  if (!plaintext.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    parsed = undefined
  }
  if (!Array.isArray(parsed)) throw new Error('Your library list is in an unknown format, so it was left unchanged.')
  return parsed
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
