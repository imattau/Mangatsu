import { EventStore } from 'applesauce-core'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { createReplaceableAddress } from 'applesauce-core/helpers/event'
import { RelayPool } from 'applesauce-relay'
import type { PublishResponse } from 'applesauce-relay'
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
    for (const relay of Array.from(this.relayPool.relays.values())) {
      this.relayPool.remove(relay, true)
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
      [{ kinds: [30040], authors: [pubkey] }],
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
    pubkey: string,
    _comicDTag: string,
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    const source$ = this.relayPool.subscription(
      this.getRelays(),
      [{ kinds: [30041], authors: [pubkey] }],
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
      [{ kinds: [30040], limit: 50 }],
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
      [{ kinds: [30040], authors, limit: 50 }],
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
      [{ kinds: [30040], authors: [pubkey], '#d': [dTag] }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToComicComments(
    pubkey: string,
    dTag: string,
    onEvent?: (event: NostrEvent) => void,
  ): Subscription {
    const source$ = this.relayPool.subscription(
      this.getRelays(),
      [
        {
          kinds: [1111],
          '#A': [createReplaceableAddress(30040, pubkey, dTag)],
          limit: 100,
        },
      ],
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

  async fetchProfile(
    pubkey: string,
  ): Promise<{ lud16?: string; lud06?: string; name?: string; display_name?: string; picture?: string } | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        sub.unsubscribe()
        resolve(null)
      }, 5000)

      const source$ = this.relayPool.subscription(
        this.getRelays(),
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        { eventStore: this.eventStore },
      )

      const sub = source$.subscribe({
        next: (event) => {
          clearTimeout(timeout)
          sub.unsubscribe()
          try {
            const profile = JSON.parse(event.content) as {
              lud16?: string
              lud06?: string
              name?: string
              display_name?: string
              picture?: string
            }
            resolve(profile)
          } catch {
            resolve(null)
          }
        },
      })
    })
  }

  async publishEvent(event: NostrEvent): Promise<PublishResponse[]> {
    const responses = await this.relayPool.publish(this.getRelays(), event)
    const accepted = responses.filter((response) => response.ok)
    if (accepted.length === 0) {
      const details = responses.length > 0
        ? responses.map((response) => `${response.from}: ${response.message ?? 'rejected'}`).join('; ')
        : 'No relay responses'
      throw new Error(`Failed to publish event: ${details}`)
    }

    this.eventStore.add(event)
    return responses
  }

  subscribeToLibraryList(
    pubkey: string,
    onEvent: (event: NostrEvent) => void,
  ): { unsubscribe: () => void } {
    const source$ = this.relayPool.subscription(
      this.getRelays(),
      [{ kinds: [30003], authors: [pubkey], '#d': ['mangatsu-library'] }],
      { eventStore: this.eventStore },
    )
    const sub = source$.subscribe({
      next: (event) => {
        this.eventStore.add(event)
        onEvent(event)
      },
    })
    return { unsubscribe: () => sub.unsubscribe() }
  }

  async publishLibraryList(
    aTags: string[],
    opts: { secretKey?: Uint8Array; pubkey: string },
  ): Promise<void> {
    const { encodeLibraryList, encryptToSelf } = await import('@/lib/nip51')
    const plaintext = encodeLibraryList(aTags)
    const windowNostr = typeof window !== 'undefined'
      ? (window as unknown as { nostr?: import('@/lib/nip51').Nip44Signer }).nostr
      : undefined
    const content = await encryptToSelf(plaintext, {
      windowNostr,
      secretKey: opts.secretKey,
      pubkey: opts.pubkey,
    })
    const template = {
      kind: 30003 as const,
      content,
      tags: [['d', 'mangatsu-library']],
    }
    const signed = await this.eventFactory.build(template)
    if (signed) await this.publishEvent(signed as NostrEvent)
  }

  async publishBlossomServerList(serverUrls: string[]): Promise<void> {
    const account = this.accountManager.active
    if (!account) return

    const template = {
      kind: 10063,
      tags: serverUrls.map((url) => ['server', url]),
      content: '',
      created_at: Math.floor(Date.now() / 1000),
    }

    const signed = await account.signer.signEvent(template)
    await this.publishEvent(signed)
  }
}

export const nostrService = new NostrService()
