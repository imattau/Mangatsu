import { decodeProfilePointer, isHex, isHexKey } from 'applesauce-core/helpers'
import { getEventHash, verifyEvent, type EventTemplate, type NostrEvent } from 'applesauce-core/helpers/event'
import { BaseAccount } from 'applesauce-accounts'
import type { SerializedAccount } from 'applesauce-accounts'
import type { ISigner } from 'applesauce-signers'

/**
 * NIP-55 (Amber) signer for the Tauri Android app.
 *
 * applesauce-signers' AmberClipboardSigner launches the signer app via
 * `window.open('intent://...#Intent;scheme=nostrsigner;...;end')`, which is
 * a browser-specific syntax Chrome resolves specially. Tauri's Android
 * WebView doesn't do that resolution and fails with ERR_UNKNOWN_URL_SCHEME.
 *
 * Launching the plain `nostrsigner:` scheme via Tauri's stock opener plugin
 * gets past that, but Amber then rejects the request as malformed: per
 * https://github.com/nostr-protocol/nips/blob/master/55.md, Amber only
 * parses request parameters from the URL's own query string when the
 * launching Intent carries the `Browser.EXTRA_APPLICATION_ID` extra — the
 * marker a real browser sets when it resolves an `intent://` link. Without
 * it, Amber assumes a native-app request and looks for parameters as Intent
 * extras instead, finds none, and rejects it. Tauri's opener plugin has no
 * way to attach that extra, so this uses a small custom plugin
 * (tauri-plugin-amber-opener, see src-tauri/tauri-plugin-amber-opener) that
 * builds the Intent with it — then reads the result back from the clipboard
 * the same way, once the app regains focus.
 */
function buildNostrSignerUri(content: string | null, params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value)
  }
  const base = content ? `nostrsigner:${encodeURIComponent(content)}` : 'nostrsigner:'
  return `${base}?${search.toString()}`
}

interface PendingRequest {
  resolve: (value: string) => void
  reject: (reason: unknown) => void
}

export class TauriAmberSigner implements ISigner {
  pubkey?: string
  verifyEvent = verifyEvent
  nip04: { encrypt: (pubkey: string, plaintext: string) => Promise<string>; decrypt: (pubkey: string, ciphertext: string) => Promise<string> }
  nip44: { encrypt: (pubkey: string, plaintext: string) => Promise<string>; decrypt: (pubkey: string, ciphertext: string) => Promise<string> }

  private pendingRequest: PendingRequest | null = null

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.nip04 = { encrypt: this.nip04Encrypt.bind(this), decrypt: this.nip04Decrypt.bind(this) }
    this.nip44 = { encrypt: this.nip44Encrypt.bind(this), decrypt: this.nip44Decrypt.bind(this) }
  }

  private onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return
    if (!this.pendingRequest) return
    setTimeout(() => {
      // navigator.clipboard.readText() is gated by the WebView's own
      // permission model (often denied there even though the page never
      // prompts for it) — Tauri's native clipboard plugin reads the OS
      // clipboard directly instead.
      import('@tauri-apps/plugin-clipboard-manager')
        .then(({ readText }) => readText())
        .then((result) => this.pendingRequest?.resolve(result ?? ''))
        .catch((error) => this.pendingRequest?.reject(error))
    }, 200)
  }

  /** Removes any event listeners created */
  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
  }

  private async request(uri: string): Promise<string> {
    if (this.pendingRequest) {
      this.pendingRequest.reject(new Error('Canceled'))
      this.pendingRequest = null
    }
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await new Promise<string>((resolve, reject) => {
      this.pendingRequest = { resolve, reject }
      invoke('plugin:amber-opener|open_amber_url', { url: uri }).catch(reject)
    })
    if (result.length === 0) throw new Error('Empty clipboard')
    return result
  }

  async getPublicKey(): Promise<string> {
    if (this.pubkey) return this.pubkey
    const uri = buildNostrSignerUri(null, {
      type: 'get_public_key',
      compressionType: 'none',
      returnType: 'signature',
    })
    const result = await this.request(uri)
    if (isHexKey(result)) {
      this.pubkey = result
      return result
    }
    if (result.startsWith('npub') || result.startsWith('nprofile')) {
      const pubkey = decodeProfilePointer(result)?.pubkey
      if (!pubkey) throw new Error('Expected npub from clipboard')
      this.pubkey = pubkey
      return pubkey
    }
    throw new Error('Expected clipboard to have pubkey')
  }

  async signEvent(draft: EventTemplate & { pubkey?: string }): Promise<NostrEvent> {
    const pubkey = draft.pubkey || this.pubkey
    if (!pubkey) throw new Error('Unknown signer pubkey')
    const draftWithId = { ...draft, id: getEventHash({ ...draft, pubkey }) }
    const uri = buildNostrSignerUri(JSON.stringify(draftWithId), {
      type: 'sign_event',
      compressionType: 'none',
      returnType: 'signature',
    })
    const sig = await this.request(uri)
    if (!isHex(sig)) throw new Error('Expected hex signature')
    const event = { ...draftWithId, sig, pubkey }
    if (!verifyEvent(event)) throw new Error('Invalid signature')
    return event
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return this.request(
      buildNostrSignerUri(plaintext, { type: 'nip04_encrypt', pubKey: pubkey, compressionType: 'none', returnType: 'signature' }),
    )
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return this.request(
      buildNostrSignerUri(ciphertext, { type: 'nip04_decrypt', pubKey: pubkey, compressionType: 'none', returnType: 'signature' }),
    )
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return this.request(
      buildNostrSignerUri(plaintext, { type: 'nip44_encrypt', pubKey: pubkey, compressionType: 'none', returnType: 'signature' }),
    )
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return this.request(
      buildNostrSignerUri(ciphertext, { type: 'nip44_decrypt', pubKey: pubkey, compressionType: 'none', returnType: 'signature' }),
    )
  }
}

/** An account for the Tauri Android app's Amber (NIP-55) integration */
export class TauriAmberAccount extends BaseAccount<TauriAmberSigner, void, unknown> {
  static readonly type = 'tauri-amber'

  toJSON() {
    return this.saveCommonFields({ signer: undefined })
  }

  static fromJSON(json: SerializedAccount<void, unknown>): TauriAmberAccount {
    const account = new TauriAmberAccount(json.pubkey, new TauriAmberSigner())
    return BaseAccount.loadCommonFields(account, json)
  }
}
