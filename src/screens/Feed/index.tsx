import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { HeaderNav } from '@/components/HeaderNav'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { DEFAULT_RELAYS, useRelayStore } from '@/stores/relayStore'
import type { Comic } from '@/types'
import { BlossomImage } from '@/components/BlossomImage'

// ---------------------------------------------------------------------------
// Helpers (same as LibraryScreen)
// ---------------------------------------------------------------------------

function parseTag(event: NostrEvent, name: string) {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

function parseTagTail(event: NostrEvent, name: string, startIndex: number) {
  const tag = event.tags.find((entry) => entry[0] === name)
  return tag ? tag.slice(startIndex).filter(Boolean) : []
}

function parseAnyTag(event: NostrEvent, names: string[]) {
  for (const name of names) {
    const value = parseTag(event, name)
    if (value) return value
  }
  return ''
}

function isMangatsuEvent(event: NostrEvent) {
  return event.tags.some((tag) => tag[0] === 'L' && tag[1] === 'com.mangatsu')
}

function parseComicEvent(event: NostrEvent, server: string | undefined): Comic | null {
  const dTag = parseTag(event, 'd')
  if (!dTag) return null
  const coverServers = [
    ...parseTagTail(event, 'cover', 2),
    ...parseTagTail(event, 'image', 2),
  ]
  const coverServer = coverServers[0] || ''
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: parseTag(event, 'title') || event.content || 'Untitled',
    author: parseTag(event, 'author'),
    description: parseTag(event, 'description') || event.content || '',
    coverHash: parseAnyTag(event, ['cover', 'cover_hash', 'image']),
    blossomServer: parseAnyTag(event, ['blossom', 'blossom_server']) || coverServer || server || '',
    coverServer,
    coverServers,
    tags: event.tags.filter((t) => t[0] === 't').map((t) => t[1]).filter(Boolean),
    eventId: event.id,
  }
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
  const { service, syncGeneration } = useNostr()
  const eventStore = useEventStore()
  const [searchParams] = useSearchParams()
  const pubkey = useAuthStore((s) => s.pubkey)
  const primaryServer = useBlossomStore((s) => s.primaryServer)
  const relayUrls = useRelayStore((s) => s.relays)
  const activeRelayUrls = useMemo(
    () => (relayUrls.length > 0 ? relayUrls : DEFAULT_RELAYS),
    [relayUrls],
  )
  const relayKey = useMemo(() => activeRelayUrls.join('\u0000'), [activeRelayUrls])

  const [activeTab, setActiveTab] = useState<Tab>('global')
  const [followedPubkeys, setFollowedPubkeys] = useState<string[]>([])

  // Subscribe to global comics
  useEffect(() => {
    const sub = service.subscribeToGlobalComics()
    return () => sub.unsubscribe()
  }, [service, relayKey, syncGeneration])

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
  }, [pubkey, relayKey, service, syncGeneration])

  // Subscribe to follows' comics once we have the list
  useEffect(() => {
    if (followedPubkeys.length === 0) return
    const sub = service.subscribeToComicsByAuthors(followedPubkeys)
    return () => sub.unsubscribe()
  }, [followedPubkeys, relayKey, service, syncGeneration])

  // Reactive timelines
  const mangatsuFilter = useMemo(
    () => [{ kinds: [30040], '#L': ['com.mangatsu'], limit: 50 }],
    [],
  )
  const globalTimeline$ = useMemo(
    () => eventStore.timeline(mangatsuFilter),
    [eventStore, mangatsuFilter],
  )
  const globalEvents = useObservableState(globalTimeline$) ?? EMPTY_EVENTS

  const followsFilter = useMemo(
    () =>
      followedPubkeys.length > 0
        ? [{ kinds: [30040], authors: followedPubkeys, '#L': ['com.mangatsu'] }]
        : null,
    [followedPubkeys],
  )
  const followsTimeline$ = useMemo(
    () => (followsFilter ? eventStore.timeline(followsFilter) : of([])),
    [eventStore, followsFilter],
  )
  const followsEvents = useObservableState(followsTimeline$) ?? EMPTY_EVENTS

  const server = primaryServer()
  const activeTag = searchParams.get('tag')?.trim() ?? ''

  const globalComics = useMemo(
    () =>
      globalEvents.flatMap((e) => {
        if (!isMangatsuEvent(e)) return []
        const c = parseComicEvent(e, server)
        return c ? [c] : []
      }),
    [globalEvents, server],
  )

  const followsComics = useMemo(
    () =>
      followsEvents.flatMap((e) => {
        if (!isMangatsuEvent(e)) return []
        const c = parseComicEvent(e, server)
        return c ? [c] : []
      }),
    [followsEvents, server],
  )

  const activeComics = useMemo(() => {
    const comics = activeTab === 'global' ? globalComics : followsComics
    if (!activeTag) return comics
    return comics.filter((comic) => comic.tags.includes(activeTag))
  }, [activeTag, activeTab, followsComics, globalComics])

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 py-4 text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
            <BrandMark size="sm" showLabel={false} />
            <div className="min-w-0">
              <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
              <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">Feed</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <HeaderNav />
          </div>
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

        {activeTag ? (
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm">
            <span className="text-zinc-500">Tag filter:</span>
            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-100">
              {activeTag}
            </span>
            <Link
              to="/feed"
              className="ml-auto text-zinc-400 transition hover:text-zinc-100"
            >
              Clear
            </Link>
          </div>
        ) : null}

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
                <ComicCover
                  comic={comic}
                  server={comic.coverServer || comic.blossomServer || server}
                />
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
  const className =
    'aspect-[2/3] w-full rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'
  if (!comic.coverHash) return <div className={className} />
  return (
    <BlossomImage
      hash={comic.coverHash}
      server={server}
      servers={comic.coverServers}
      alt={comic.title}
      className={className}
    />
  )
}
