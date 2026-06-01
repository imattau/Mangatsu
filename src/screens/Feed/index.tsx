import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore } from '@/stores/blossomStore'
import type { Comic } from '@/types'

// ---------------------------------------------------------------------------
// Helpers (same as LibraryScreen)
// ---------------------------------------------------------------------------

function parseTag(event: NostrEvent, name: string) {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

function parseAnyTag(event: NostrEvent, names: string[]) {
  for (const name of names) {
    const value = parseTag(event, name)
    if (value) return value
  }
  return ''
}

function parseComicEvent(event: NostrEvent, server: string | undefined): Comic | null {
  const dTag = parseTag(event, 'd')
  if (!dTag) return null
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: parseTag(event, 'title') || event.content || 'Untitled',
    author: parseTag(event, 'author'),
    description: parseTag(event, 'description') || event.content || '',
    coverHash: parseAnyTag(event, ['cover', 'cover_hash', 'image']),
    blossomServer: parseAnyTag(event, ['blossom', 'blossom_server']) || server || '',
    tags: event.tags.filter((t) => t[0] === 't').map((t) => t[1]).filter(Boolean),
    eventId: event.id,
  }
}

function coverUrl(hash: string, server: string | undefined) {
  if (!hash || !server) return null
  return `${server.replace(/\/$/, '')}/blob/${hash}`
}

function parseFollowedPubkeys(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === 'p').map((t) => t[1]).filter(Boolean)
}

const EMPTY_EVENTS: NostrEvent[] = []
type Tab = 'global' | 'follows'

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function FeedScreen() {
  const { service } = useNostr()
  const eventStore = useEventStore()
  const pubkey = useAuthStore((s) => s.pubkey)
  const primaryServer = useBlossomStore((s) => s.primaryServer)

  const [activeTab, setActiveTab] = useState<Tab>('global')
  const [followedPubkeys, setFollowedPubkeys] = useState<string[]>([])

  // Subscribe to global comics
  useEffect(() => {
    const sub = service.subscribeToGlobalComics()
    return () => sub.unsubscribe()
  }, [service])

  // Subscribe to contact list (kind 3)
  useEffect(() => {
    if (!pubkey) return
    const sub = service.subscribeToContactList(pubkey, (event) => {
      const follows = parseFollowedPubkeys(event)
      setFollowedPubkeys(follows)
    })
    return () => {
      sub.unsubscribe()
    }
  }, [pubkey, service])

  // Subscribe to follows' comics once we have the list
  useEffect(() => {
    if (followedPubkeys.length === 0) return
    const sub = service.subscribeToComicsByAuthors(followedPubkeys)
    return () => sub.unsubscribe()
  }, [followedPubkeys, service])

  // Reactive timelines
  const globalFilter = useMemo(() => [{ kinds: [30402], limit: 50 }], [])
  const globalTimeline$ = useMemo(
    () => eventStore.timeline(globalFilter),
    [eventStore, globalFilter],
  )
  const globalEvents = useObservableState(globalTimeline$) ?? EMPTY_EVENTS

  const followsFilter = useMemo(
    () => (followedPubkeys.length > 0 ? [{ kinds: [30402], authors: followedPubkeys }] : null),
    [followedPubkeys],
  )
  const followsTimeline$ = useMemo(
    () => (followsFilter ? eventStore.timeline(followsFilter) : of([])),
    [eventStore, followsFilter],
  )
  const followsEvents = useObservableState(followsTimeline$) ?? EMPTY_EVENTS

  const server = primaryServer()

  const globalComics = useMemo(
    () =>
      globalEvents.flatMap((e) => {
        const c = parseComicEvent(e, server)
        return c ? [c] : []
      }),
    [globalEvents, server],
  )

  const followsComics = useMemo(
    () =>
      followsEvents.flatMap((e) => {
        const c = parseComicEvent(e, server)
        return c ? [c] : []
      }),
    [followsEvents, server],
  )

  const activeComics = activeTab === 'global' ? globalComics : followsComics

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 py-4 text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header>
          <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Feed</h1>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-1">
          {(['global', 'follows'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 rounded-xl py-2 text-sm font-medium transition capitalize ${
                activeTab === tab
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'global' ? 'Global' : 'Follows'}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'follows' && followedPubkeys.length === 0 ? (
          <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
            <p className="text-lg font-medium text-zinc-100">No follows yet</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
              Follow people on Nostr to see their comics here.
            </p>
          </section>
        ) : activeComics.length === 0 ? (
          <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
            <p className="text-lg font-medium text-zinc-100">No comics found</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
              Comics will appear here as relays sync.
            </p>
          </section>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {activeComics.map((comic) => (
              <Link
                key={`${comic.pubkey}:${comic.dTag}`}
                to={`/comic/${comic.dTag}?pubkey=${comic.pubkey}`}
                className="group flex flex-col gap-2 rounded-2xl transition hover:-translate-y-0.5"
              >
                <ComicCover comic={comic} server={comic.blossomServer || server} />
                <div className="px-0.5">
                  <p className="text-sm font-medium leading-5 text-zinc-100 group-hover:text-white">
                    {comic.title}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ComicCover({ comic, server }: { comic: Comic; server: string | undefined }) {
  const url = coverUrl(comic.coverHash, server)
  const className =
    'aspect-[2/3] w-full rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'
  if (!url) return <div className={className} />
  return <img src={url} alt={comic.title} loading="lazy" className={className} />
}
