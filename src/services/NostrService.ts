import { EventStore } from 'applesauce-core'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { RelayPool } from 'applesauce-relay'
import { AccountManager } from 'applesauce-accounts'
import { EventFactory } from 'applesauce-factory'
import type { Subscription } from 'rxjs'

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
]

export class NostrService {
  eventStore = new EventStore()
  relayPool = new RelayPool()
  accountManager = new AccountManager()
  eventFactory = new EventFactory()

  async connect(relays: string[] = DEFAULT_RELAYS) {
    for (const url of relays) {
      this.relayPool.relay(url)
    }
  }

  async disconnect() {
    for (const [, relay] of this.relayPool.relays) {
      relay.close()
    }
  }

  get activeAccount() {
    return this.accountManager.active
  }

  subscribeToUserComics(
    pubkey: string,
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [30402], authors: [pubkey] }],
      { eventStore: this.eventStore },
    )

    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToChapters(
    comicDTag: string,
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [30403], '#d': [`${comicDTag}/`] }],
      { eventStore: this.eventStore },
    )

    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToGlobalComics(onEvent?: (event: NostrEvent) => void): Subscription {
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [30402], limit: 50 }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToContactList(
    pubkey: string,
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [3], authors: [pubkey], limit: 1 }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToComicsByAuthors(
    authors: string[],
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    if (authors.length === 0) {
      return { unsubscribe: () => {} } as Subscription
    }
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [30402], authors, limit: 50 }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToForeignComic(
    pubkey: string,
    dTag: string,
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    const source$ = this.relayPool.subscription(
      DEFAULT_RELAYS,
      [{ kinds: [30402], authors: [pubkey], '#d': [dTag] }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  async publishEvent(event: NostrEvent): Promise<void> {
    await this.relayPool.publish(DEFAULT_RELAYS, event)
  }
}

export const nostrService = new NostrService()
