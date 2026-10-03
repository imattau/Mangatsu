import { EventStore } from 'applesauce-core'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { createReplaceableAddress } from 'applesauce-core/helpers/event'
import { RelayPool } from 'applesauce-relay'
import type { PublishResponse } from 'applesauce-relay'
import { AccountManager } from 'applesauce-accounts'
import { EventFactory } from 'applesauce-factory'
import { EMPTY, catchError, lastValueFrom, takeUntil, tap, timer, toArray, type Subscription } from 'rxjs'
import { useRelayStore, DEFAULT_RELAYS } from '@/stores/relayStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { parseComicEvent } from '@/lib/comic'
import { ComicIndex } from '@/services/ComicIndex'

const CONTACT_LIST_TIMEOUT_MS = 8000

export class NostrService {
  eventStore = new EventStore()
  relayPool = new RelayPool()
  accountManager = new AccountManager()
  eventFactory = new EventFactory()
  comicIndex = new ComicIndex()
  private contactListQueue: Promise<unknown> = Promise.resolve()

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

  private ingestEvent(event: NostrEvent) {
    this.eventStore.add(event)
    if (event.kind === 30040 && event.tags.some((tag) => tag[0] === 'L' && tag[1] === 'com.mangatsu')) {
      const server = useBlossomStore.getState().primaryServer()
      const comic = parseComicEvent(event, server)
      if (comic) {
        void this.comicIndex.upsertComic(comic)
      }
    }
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
        this.ingestEvent(event)
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
        this.ingestEvent(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToGlobalComics(onEvent?: (event: NostrEvent) => void): Subscription {
    const source$ = this.relayPool.subscription(
      this.getRelays(),
      [{ kinds: [30040] }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.ingestEvent(event)
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
        this.ingestEvent(event)
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
      [{ kinds: [30040], authors }],
      { eventStore: this.eventStore },
    )
    return source$.subscribe({
      next: (event) => {
        this.ingestEvent(event)
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
        this.ingestEvent(event)
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
        this.ingestEvent(event)
        onEvent?.(event)
      },
    })
  }

  subscribeToUserLists(
    pubkey: string,
    onRelays: (urls: string[]) => void,
    onBlossomServers: (urls: string[]) => void,
  ): { unsubscribe: () => void } {
    // Always include the bootstrap/indexer relays (DEFAULT_RELAYS, e.g.
    // purplepag.es) alongside whatever relay list is currently cached.
    // Otherwise, once any relay list is cached, this app only ever asks
    // those same relays again — if the user updates their relay list from
    // another device/app and it doesn't reach one of those, this app would
    // never see the change.
    const queryRelays = Array.from(new Set([...this.getRelays(), ...DEFAULT_RELAYS]))
    const source$ = this.relayPool.subscription(
      queryRelays,
      [{ kinds: [10002, 10063], authors: [pubkey] }],
      { eventStore: this.eventStore },
    )

    const sub = source$.subscribe({
      next: (event) => {
        this.ingestEvent(event)
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

    this.ingestEvent(event)
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
        this.ingestEvent(event)
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

  /**
   * Follow or unfollow one pubkey, returning the resulting follow list.
   *
   * Kind 3 is replaceable, so whatever we publish replaces the user's contact list in
   * every client. Build the new event from the latest list on relays and change only
   * the one `p` tag — never from local UI state, which may be stale or not yet loaded,
   * and never dropping relay hints, petnames, other tags or content.
   */
  setFollow(targetPubkey: string, follow: boolean): Promise<string[]> {
    // Run one at a time so concurrent toggles each build on the previous result.
    const run = this.contactListQueue.then(() => this.applyFollow(targetPubkey, follow))
    this.contactListQueue = run.catch(() => undefined)
    return run
  }

  private async applyFollow(targetPubkey: string, follow: boolean): Promise<string[]> {
    const account = this.accountManager.active
    if (!account) throw new Error('Sign in to follow authors')

    const base = await this.loadLatestContactList(account.pubkey)
    const baseTags = base?.tags ?? []
    const isFollowing = baseTags.some((tag) => tag[0] === 'p' && tag[1] === targetPubkey)

    let tags = baseTags
    if (follow && !isFollowing) {
      tags = [...baseTags, ['p', targetPubkey]]
    } else if (!follow && isFollowing) {
      tags = baseTags.filter((tag) => !(tag[0] === 'p' && tag[1] === targetPubkey))
    }

    if (tags !== baseTags) {
      const signed = await account.signer.signEvent({
        kind: 3,
        tags,
        content: base?.content ?? '',
        created_at: Math.max(Math.floor(Date.now() / 1000), (base?.created_at ?? 0) + 1),
      })
      await this.publishEvent(signed)
    }

    return tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])
  }

  /**
   * Newest kind 3 for `pubkey` from relays or the local store. Throws if relays could not
   * be reached and nothing is cached: we can't tell "no contact list" from "not loaded",
   * and guessing wrong would wipe the user's follows.
   */
  private async loadLatestContactList(pubkey: string): Promise<NostrEvent | undefined> {
    const cached = this.eventStore.getReplaceable(3, pubkey)
    let timedOut = false
    let failed = false
    const fetched = await lastValueFrom(
      this.relayPool
        .request(this.getRelays(), [{ kinds: [3], authors: [pubkey], limit: 1 }])
        .pipe(
          takeUntil(
            timer(CONTACT_LIST_TIMEOUT_MS).pipe(
              tap(() => {
                timedOut = true
              }),
            ),
          ),
          catchError(() => {
            failed = true
            return EMPTY
          }),
          toArray(),
        ),
    )

    const newest = [cached, ...fetched]
      .filter((event): event is NostrEvent => Boolean(event))
      .sort((a, b) => b.created_at - a.created_at)[0]

    if (newest) {
      this.eventStore.add(newest)
      return newest
    }
    if (timedOut || failed) {
      throw new Error('Could not load your contact list from relays. Try again.')
    }
    return undefined
  }
}

export const nostrService = new NostrService()
