import { generateSecretKey, getPublicKey, nip04, nip47 } from 'nostr-tools'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { RelayPool } from 'applesauce-relay'
import type { Subscription } from 'rxjs'

interface NwcClientOptions {
  connectionString: string
  relayPool: RelayPool
}

type NwcResponse = {
  id?: string
  result?: unknown
  error?: string
}

export class NwcClient {
  private readonly relayPool: RelayPool
  private readonly pubkey: string
  private readonly relays: string[]
  private readonly secretKey: Uint8Array

  constructor({ connectionString, relayPool }: NwcClientOptions) {
    const parsed = nip47.parseConnectionString(connectionString)
    this.relayPool = relayPool
    this.pubkey = parsed.pubkey
    this.relays = parsed.relays
    this.secretKey = generateSecretKey()
  }

  async blockUntilReady(): Promise<void> {
    if (this.relays.length === 0) {
      throw new Error('No wallet relays configured')
    }
  }

  async payInvoice(invoice: string): Promise<void> {
    const request = await nip47.makeNwcRequestEvent(this.pubkey, this.secretKey, invoice)
    const responsePromise = this.waitForResponse(request.id)
    await this.relayPool.publish(this.relays, request)
    const response = await responsePromise
    if (response.error) {
      throw new Error(response.error)
    }
  }

  private waitForResponse(requestId: string): Promise<NwcResponse> {
    return new Promise((resolve, reject) => {
      const clientPubkey = getPublicKey(this.secretKey)
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error('NWC payment timed out'))
      }, 30_000)

      let subscription: Subscription | null = null
      const cleanup = () => {
        window.clearTimeout(timeout)
        subscription?.unsubscribe()
        subscription = null
      }

      const source$ = this.relayPool.subscription(
        this.relays,
        [{ kinds: [23195], '#p': [clientPubkey] }],
        { eventStore: null },
      )

      subscription = source$.subscribe({
        next: (event: NostrEvent) => {
          void this.handleResponseEvent(event, requestId)
            .then((response) => {
              if (!response) {
                return
              }
              cleanup()
              resolve(response)
            })
            .catch((error) => {
              cleanup()
              reject(error)
            })
        },
        error: (error) => {
          cleanup()
          reject(error instanceof Error ? error : new Error('NWC relay error'))
        },
      })
    })
  }

  private async handleResponseEvent(
    event: NostrEvent,
    requestId: string,
  ): Promise<NwcResponse | null> {
    try {
      const decrypted = nip04.decrypt(this.secretKey, this.pubkey, event.content)
      const response = JSON.parse(decrypted) as NwcResponse
      if (response.id !== requestId) {
        return null
      }
      return response
    } catch {
      return null
    }
  }
}
