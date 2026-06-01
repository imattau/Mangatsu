import { EventStore } from 'applesauce-core'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { RelayPool } from 'applesauce-relay'
import { AccountManager } from 'applesauce-accounts'
import { EventFactory } from 'applesauce-factory'
import type { Subscription } from 'rxjs'
import { useRelayStore, DEFAULT_RELAYS } from '@/stores/relayStore'

export class NostrService {
  eventStore = new EventStore()
  relayPool = new RelayPool()
  accountManager = new AccountManager()
  eventFactory = new EventFactory()

  private getRelays(): string[] {
    const { relays } = useRelayStore.getState()
    return relays.length > 0 ? relays : DEFAULT_RELAYS
  }

  async connect(relays?: string[]) {
    const urls = relays ?? this.getRelays()
    for (const url of urls) {
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
      this.getRelays(),
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
      this.getRelays(),
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
      this.getRelays(),
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
      this.getRelays(),
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
      this.getRelays(),
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
      this.getRelays(),
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

  subscribeToUserLists(
    pubkey: string,
    onRelays: (urls: string[]) => void,
    onBlossomServers: (urls: string[]) => void,
  ): { unsubscribe: () => void } {
    const source$ = this.relayPool.subscription(
      this.getRelays(),
      [{ kinds: [10002, 10063], authors: [pubkey] }],
      { eventStore: this.eventStore },
    )

    const sub = source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        if (event.kind === 10002) {
          const urls = event.tags
            .filter((t) => t[0] === 'r' && typeof t[1] === 'string')
            .map((t) => t[1])
          if (urls.length > 0) onRelays(urls)
        } else if (event.kind === 10063) {
          const urls = event.tags
            .filter((t) => t[0] === 'server' && typeof t[1] === 'string')
            .map((t) => t[1])
          if (urls.length > 0) onBlossomServers(urls)
        }
      },
    })

    return { unsubscribe: () => sub.unsubscribe() }
  }

  async publishEvent(event: NostrEvent): Promise<void> {
    await this.relayPool.publish(this.getRelays(), event)
  }
}

export const nostrService = new NostrService()
