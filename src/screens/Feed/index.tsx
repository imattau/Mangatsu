import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { HeaderNav } from '@/components/HeaderNav'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { DEFAULT_RELAYS, useRelayStore } from '@/stores/relayStore'
import type { Comic } from '@/types'
import { BlossomImage } from '@/components/BlossomImage'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { parseComicEvent } from '@/lib/comic'
import { useSettingsStore } from '@/stores/settingsStore'

const EMPTY_EVENTS: NostrEvent[] = []
type Tab = 'global' | 'follows' | 'authors'

type AuthorProfile = {
  name: string | null
  picture: string | null
}

function isMangatsuEvent(event: NostrEvent) {
  return event.tags.some((tag) => tag[0] === 'L' && tag[1] === 'com.mangatsu')
}

function parseFollowedPubkeys(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === 'p').map((t) => t[1]).filter(Boolean)
}

function truncatePubkey(pubkey: string) {
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`
}

function resolveAuthorPubkey(comic: Comic) {
  return comic.authorPubkey || comic.pubkey
}

function authorInitials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'A'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function FeedScreen() {
  const { service, syncGeneration } = useNostr()
  const eventStore = useEventStore()
  const [searchParams, setSearchParams] = useSearchParams()
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
  const [authorProfiles, setAuthorProfiles] = useState<Record<string, AuthorProfile | null>>({})

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

  const showNsfw = useSettingsStore((s) => s.showNsfw)
  const server = primaryServer()
  const activeTag = searchParams.get('tag')?.trim() ?? ''
  const activeAuthor = searchParams.get('author')?.trim() ?? ''

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

  const feedComics = activeTab === 'follows' ? followsComics : globalComics
  const tagFilteredComics = useMemo(
    () => (activeTag ? feedComics.filter((comic) => comic.tags.includes(activeTag)) : feedComics),
    [activeTag, feedComics],
  )
  const activeComics = useMemo(
    () =>
      activeAuthor
        ? tagFilteredComics.filter((comic) => resolveAuthorPubkey(comic) === activeAuthor)
        : tagFilteredComics,
    [activeAuthor, tagFilteredComics],
  )

  const authorDirectory = useMemo(() => {
    const groups = new Map<
      string,
      {
        pubkey: string
        count: number
        latest: Comic
      }
    >()

    for (const comic of tagFilteredComics) {
      const authorPubkey = resolveAuthorPubkey(comic)
      const existing = groups.get(authorPubkey)
      if (!existing) {
        groups.set(authorPubkey, { pubkey: authorPubkey, count: 1, latest: comic })
        continue
      }
      existing.count += 1
      if (comic.title.localeCompare(existing.latest.title) < 0) {
        existing.latest = comic
      }
    }

    return [...groups.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.latest.title.localeCompare(b.latest.title)
    })
  }, [tagFilteredComics])

  const authorPubkeys = useMemo(
    () => [...new Set(tagFilteredComics.map((comic) => resolveAuthorPubkey(comic)).filter(Boolean))],
    [tagFilteredComics],
  )

  useEffect(() => {
    let cancelled = false
    const missing = authorPubkeys.filter((authorPubkey) => authorProfiles[authorPubkey] === undefined)
    if (missing.length === 0) return

    void Promise.all(
      missing.map(async (authorPubkey) => {
        const profile = await service.fetchProfile(authorPubkey)
        return [
          authorPubkey,
          {
            name: profile?.name?.trim() || null,
            picture: profile?.picture?.trim() || null,
          },
        ] as const
      }),
    ).then((results) => {
      if (cancelled) return
      setAuthorProfiles((current) => {
        const next = { ...current }
        for (const [authorPubkey, profile] of results) {
          next[authorPubkey] = profile
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [authorPubkeys, authorProfiles, service, syncGeneration])

  function handleToggleFollow(authorPubkey: string) {
    const isFollowing = followedPubkeys.includes(authorPubkey)
    const nextFollows = isFollowing
      ? followedPubkeys.filter((pk) => pk !== authorPubkey)
      : [...followedPubkeys, authorPubkey]
    
    // optimistic update
    setFollowedPubkeys(nextFollows)

    service.publishContactList(nextFollows).catch((err) => {
      console.error('Failed to update follow list:', err)
      // revert on failure
      setFollowedPubkeys(followedPubkeys)
    })
  }

  function updateSearchParams(next: { tag?: string | null; author?: string | null }) {
    const updated = new URLSearchParams(searchParams)
    if (next.tag !== undefined) {
      if (next.tag) updated.set('tag', next.tag)
      else updated.delete('tag')
    }
    if (next.author !== undefined) {
      if (next.author) updated.set('author', next.author)
      else updated.delete('author')
    }
    setSearchParams(updated)
  }

  function authorLabel(authorPubkey: string) {
    return authorProfiles[authorPubkey]?.name || truncatePubkey(authorPubkey)
  }

  function authorPicture(authorPubkey: string) {
    return authorProfiles[authorPubkey]?.picture || null
  }

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
          {(['global', 'follows', 'authors'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 rounded-xl py-2 text-sm font-medium transition capitalize ${
                activeTab === tab
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'global' ? 'Global' : tab === 'follows' ? 'Follows' : 'Authors'}
            </button>
          ))}
        </div>

        {activeTag || activeAuthor ? (
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm">
            {activeTag ? (
              <>
                <span className="text-zinc-500">Tag:</span>
                <button
                  type="button"
                  onClick={() => updateSearchParams({ tag: null })}
                  className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-100 transition hover:border-zinc-500"
                >
                  {activeTag}
                </button>
              </>
            ) : null}
            {activeAuthor ? (
              <>
                <span className="text-zinc-500">Author:</span>
                <button
                  type="button"
                  onClick={() => updateSearchParams({ author: null })}
                  className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-100 transition hover:border-zinc-500"
                >
                  {authorLabel(activeAuthor)}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => updateSearchParams({ tag: null, author: null })}
              className="ml-auto text-zinc-400 transition hover:text-zinc-100"
            >
              Clear
            </button>
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
        ) : activeTab === 'authors' && !activeAuthor ? (
          authorDirectory.length === 0 ? (
            <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
              <p className="text-lg font-medium text-zinc-100">No authors found</p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
                Authors will appear here once Mangatsu comics have synced.
              </p>
            </section>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {authorDirectory.map((author) => {
                const isFollowing = followedPubkeys.includes(author.pubkey)
                return (
                  <div
                    key={author.pubkey}
                    className="relative flex flex-col justify-between rounded-[1.5rem] border border-zinc-800 bg-zinc-950/70 p-5 transition hover:border-zinc-600 hover:bg-zinc-900"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => updateSearchParams({ author: author.pubkey })}
                        className="flex items-center gap-3 text-left focus:outline-none min-w-0 flex-1 group"
                      >
                        <AuthorAvatar
                          pubkey={author.pubkey}
                          name={authorLabel(author.pubkey)}
                          picture={authorPicture(author.pubkey)}
                        />
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Author</p>
                          <p className="mt-1 truncate text-base font-medium text-zinc-100 group-hover:text-white group-hover:underline">
                            {authorLabel(author.pubkey)}
                          </p>
                        </div>
                      </button>

                      {pubkey && pubkey !== author.pubkey && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleFollow(author.pubkey)
                          }}
                          aria-label={isFollowing ? 'Unfollow' : 'Follow'}
                          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 sm:px-4 sm:py-1.5 text-xs font-semibold border transition shrink-0 ${
                            isFollowing
                              ? 'border-zinc-700 bg-transparent text-zinc-400 hover:border-red-800 hover:text-red-400'
                              : 'border-zinc-200 bg-zinc-200 text-zinc-950 hover:bg-zinc-100 hover:border-zinc-100'
                          }`}
                        >
                          {isFollowing ? (
                            <>
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-3.5 w-3.5"
                              >
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <line x1="22" x2="16" y1="11" y2="11" />
                              </svg>
                              <span className="hidden sm:inline">Unfollow</span>
                            </>
                          ) : (
                            <>
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-3.5 w-3.5"
                              >
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <line x1="19" x2="19" y1="8" y2="14" />
                                <line x1="22" x2="16" y1="11" y2="11" />
                              </svg>
                              <span className="hidden sm:inline">Follow</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSearchParams({ author: author.pubkey })}
                      className="mt-4 text-left focus:outline-none"
                    >
                      <p className="text-sm text-zinc-400">
                        {author.count} comic{author.count === 1 ? '' : 's'}
                      </p>
                      <p className="mt-1 truncate text-xs font-mono text-zinc-600">{author.pubkey}</p>
                    </button>
                  </div>
                )
              })}
            </div>
          )
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
              <article
                key={`${comic.pubkey}:${comic.dTag}`}
                className="group flex flex-col gap-2 rounded-2xl transition hover:-translate-y-0.5"
              >
                <Link
                  to={`/comic/${comic.dTag}?pubkey=${comic.pubkey}`}
                  className="block"
                >
                  <ComicCover
                    comic={comic}
                    server={comic.coverServer || comic.blossomServer || server}
                    blurred={comic.nsfw && !showNsfw}
                  />
                  <div className="px-0.5">
                    <p className="text-sm font-medium leading-5 text-zinc-100 group-hover:text-white">
                      {comic.title}
                    </p>
                  </div>
                </Link>
                <div className="px-0.5">
                  <button
                    type="button"
                    onClick={() => updateSearchParams({ author: resolveAuthorPubkey(comic) })}
                    className="flex w-full items-center gap-2 text-left text-xs text-zinc-500 transition hover:text-zinc-200"
                  >
                    <AuthorAvatar
                      pubkey={resolveAuthorPubkey(comic)}
                      name={authorLabel(resolveAuthorPubkey(comic))}
                      picture={authorPicture(resolveAuthorPubkey(comic))}
                      className="h-5 w-5"
                    />
                    <span>
                      by{' '}
                      <span className="font-medium text-zinc-400">
                        {authorLabel(resolveAuthorPubkey(comic))}
                      </span>
                    </span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ComicCover({
  comic,
  server,
  blurred,
}: {
  comic: Comic
  server: string | undefined
  blurred: boolean
}) {
  const baseClass =
    'aspect-[2/3] w-full rounded-2xl object-cover bg-zinc-900 shadow-lg shadow-black/20'
  if (blurred) {
    return (
      <div className={`${baseClass} relative overflow-hidden`}>
        {comic.coverHash ? (
          <BlossomImage
            hash={comic.coverHash}
            server={server}
            servers={comic.coverServers}
            torrent={comic.coverTorrent}
            alt={comic.title}
            className="h-full w-full object-cover blur-sm brightness-50"
          />
        ) : (
          <div className="h-full w-full bg-zinc-800" />
        )}
        <span className="absolute inset-0 flex items-center justify-center text-[0.6rem] font-semibold uppercase tracking-widest text-zinc-400">
          NSFW
        </span>
      </div>
    )
  }
  if (!comic.coverHash) return <div className={baseClass} />
  return (
    <BlossomImage
      hash={comic.coverHash}
      server={server}
      servers={comic.coverServers}
      torrent={comic.coverTorrent}
      alt={comic.title}
      className={baseClass}
    />
  )
}

function AuthorAvatar({
  pubkey,
  name,
  picture,
  className = 'h-8 w-8',
}: {
  pubkey: string
  name: string
  picture: string | null
  className?: string
}) {
  const baseClassName = `${className} shrink-0 overflow-hidden rounded-full border border-zinc-800 bg-zinc-900`
  if (picture) {
    return (
      <div className={baseClassName}>
        <img
          src={picture}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
            const fallback = event.currentTarget.parentElement?.querySelector('[data-fallback-avatar]')
            if (fallback instanceof HTMLElement) {
              fallback.style.display = 'flex'
            }
          }}
        />
        <div
          data-fallback-avatar
          className="hidden h-full w-full items-center justify-center bg-[linear-gradient(135deg,_rgba(59,130,246,0.35),_rgba(168,85,247,0.35))] text-[0.65rem] font-semibold text-white"
          aria-hidden="true"
        >
          {authorInitials(name || pubkey)}
        </div>
      </div>
    )
  }

  return (
    <div className={`${baseClassName} flex items-center justify-center bg-[linear-gradient(135deg,_rgba(59,130,246,0.35),_rgba(168,85,247,0.35))] text-[0.65rem] font-semibold text-white`}>
      {authorInitials(name || pubkey)}
    </div>
  )
}
