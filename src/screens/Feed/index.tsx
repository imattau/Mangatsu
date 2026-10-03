import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { HeaderNav } from '@/components/HeaderNav'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { DEFAULT_RELAYS, useRelayStore } from '@/stores/relayStore'
import type { Comic } from '@/types'
import { BlossomImage } from '@/components/BlossomImage'
import { useSettingsStore } from '@/stores/settingsStore'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { Search, UserMinus, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

type Tab = 'global' | 'follows' | 'authors'

type AuthorProfile = {
  name: string | null
  picture: string | null
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

const SEARCH_DEBOUNCE_MS = 250

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
  const subscribeToIndex = useMemo(
    () => service.comicIndex.subscribe.bind(service.comicIndex),
    [service.comicIndex],
  )
  const indexVersion = useSyncExternalStore(
    subscribeToIndex,
    service.comicIndex.getSnapshot,
    service.comicIndex.getSnapshot,
  )
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
  const [visibleCount, setVisibleCount] = useState(60)
  const [feedComics, setFeedComics] = useState<Comic[]>([])
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedLoading, setFeedLoading] = useState(true)
  const [authorDirectory, setAuthorDirectory] = useState<
    Array<{ pubkey: string; count: number; latest: Comic }>
  >([])
  const [authorDirectoryLoading, setAuthorDirectoryLoading] = useState(false)
  const [followPending, setFollowPending] = useState<Record<string, boolean>>({})
  const [followError, setFollowError] = useState('')

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

  const showNsfw = useSettingsStore((s) => s.showNsfw)
  const server = primaryServer()
  const activeTag = searchParams.get('tag')?.trim() ?? ''
  const activeAuthor = searchParams.get('author')?.trim() ?? ''
  const searchQuery = searchParams.get('q')?.trim() ?? ''

  // The search box keeps its own value so typing isn't trimmed mid-word; the URL follows
  // after a short pause. Pick up outside URL changes (Clear, back/forward) during render.
  const [searchInput, setSearchInput] = useState(searchQuery)
  const [syncedSearchQuery, setSyncedSearchQuery] = useState(searchQuery)
  if (searchQuery !== syncedSearchQuery) {
    setSyncedSearchQuery(searchQuery)
    if (searchInput.trim() !== searchQuery) setSearchInput(searchQuery)
  }
  const authorPubkeys = useMemo(() => followedPubkeys.filter(Boolean), [followedPubkeys])

  useEffect(() => {
    setVisibleCount(60)
  }, [activeTab, activeTag, activeAuthor, searchQuery, relayKey])

  useEffect(() => {
    let cancelled = false

    async function loadFeed() {
      if (activeTab === 'authors' && !activeAuthor) {
        setFeedComics([])
        setFeedHasMore(false)
        setFeedLoading(false)
        return
      }

      setFeedLoading(true)
      try {
        const query = {
          limit: visibleCount,
          tag: activeTag || undefined,
          author: activeAuthor || undefined,
          search: searchQuery || undefined,
          authors:
            activeTab === 'follows' && authorPubkeys.length > 0 ? authorPubkeys : undefined,
        }
        const result = await service.comicIndex.queryComics(query)
        if (cancelled) return
        setFeedComics(result.items)
        setFeedHasMore(result.hasMore)
      } finally {
        if (!cancelled) {
          setFeedLoading(false)
        }
      }
    }

    void loadFeed()

    return () => {
      cancelled = true
    }
  }, [
    activeAuthor,
    activeTab,
    activeTag,
    authorPubkeys,
    indexVersion,
    searchQuery,
    service.comicIndex,
    visibleCount,
    syncGeneration,
  ])

  useEffect(() => {
    let cancelled = false

    async function loadAuthors() {
      if (activeTab !== 'authors' || activeAuthor) {
        setAuthorDirectory([])
        setAuthorDirectoryLoading(false)
        return
      }

      setAuthorDirectoryLoading(true)
      try {
        const result = await service.comicIndex.listAuthors({
          tag: activeTag || undefined,
          search: searchQuery || undefined,
        })
        if (cancelled) return
        setAuthorDirectory(result)
      } finally {
        if (!cancelled) {
          setAuthorDirectoryLoading(false)
        }
      }
    }

    void loadAuthors()

    return () => {
      cancelled = true
    }
  }, [
    activeAuthor,
    activeTab,
    activeTag,
    indexVersion,
    searchQuery,
    service.comicIndex,
    syncGeneration,
  ])

  useEffect(() => {
    let cancelled = false
    const missing = [...new Set(feedComics.map((comic) => resolveAuthorPubkey(comic)).filter(Boolean))].filter(
      (authorPubkey) => authorProfiles[authorPubkey] === undefined,
    )
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
  }, [authorProfiles, feedComics, service, syncGeneration])

  useEffect(() => {
    const next = searchInput.trim()
    if (next === searchQuery) return
    const timeout = window.setTimeout(() => {
      setSearchParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (next) updated.set('q', next)
          else updated.delete('q')
          return updated
        },
        { replace: true },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [searchInput, searchQuery, setSearchParams])

  async function handleToggleFollow(authorPubkey: string) {
    const follow = !followedPubkeys.includes(authorPubkey)
    const applyLocally = (shouldFollow: boolean) =>
      setFollowedPubkeys((current) =>
        shouldFollow
          ? [...current.filter((pk) => pk !== authorPubkey), authorPubkey]
          : current.filter((pk) => pk !== authorPubkey),
      )

    setFollowError('')
    setFollowPending((current) => ({ ...current, [authorPubkey]: true }))
    applyLocally(follow)
    try {
      setFollowedPubkeys(await service.setFollow(authorPubkey, follow))
    } catch (err) {
      applyLocally(!follow)
      setFollowError(err instanceof Error ? err.message : 'Failed to update your follows')
    } finally {
      setFollowPending((current) => {
        const next = { ...current }
        delete next[authorPubkey]
        return next
      })
    }
  }

  function updateSearchParams(next: { tag?: string | null; author?: string | null; q?: string | null }) {
    setSearchParams((current) => {
      const updated = new URLSearchParams(current)
      for (const key of ['tag', 'author', 'q'] as const) {
        const value = next[key]
        if (value === undefined) continue
        if (value) updated.set(key, value)
        else updated.delete(key)
      }
      return updated
    })
  }

  function clearFilters() {
    setSearchInput('')
    updateSearchParams({ tag: null, author: null, q: null })
  }

  function authorLabel(authorPubkey: string) {
    return authorProfiles[authorPubkey]?.name || truncatePubkey(authorPubkey)
  }

  function authorPicture(authorPubkey: string) {
    return authorProfiles[authorPubkey]?.picture || null
  }

  const showComicSkeleton =
    feedLoading && feedComics.length === 0 && (activeTab !== 'authors' || Boolean(activeAuthor))

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
            <BrandMark size="sm" showLabel={false} />
            <div className="min-w-0">
              <p className="text-[0.65rem] uppercase tracking-[0.45em] text-muted-foreground">Mangatsu</p>
              <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">Feed</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <HeaderNav />
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Tab)} className="gap-6">
          <TabsList className="h-11 w-full rounded-2xl p-1">
            <TabsTrigger value="global" className="rounded-xl">Global</TabsTrigger>
            <TabsTrigger value="follows" className="rounded-xl">Follows</TabsTrigger>
            <TabsTrigger value="authors" className="rounded-xl">Authors</TabsTrigger>
          </TabsList>

          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title, author, description, or tags"
              aria-label="Search comics"
              className="h-11 rounded-xl pl-9"
            />
          </div>

          {activeTag || activeAuthor || searchQuery ? (
            <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm">
              {activeTag ? (
                <>
                  <span className="text-muted-foreground">Tag:</span>
                  <FilterChip label={activeTag} onRemove={() => updateSearchParams({ tag: null })} />
                </>
              ) : null}
              {activeAuthor ? (
                <>
                  <span className="text-muted-foreground">Author:</span>
                  <FilterChip
                    label={authorLabel(activeAuthor)}
                    onRemove={() => updateSearchParams({ author: null })}
                  />
                </>
              ) : null}
              <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          ) : null}

          <TabsContent value={activeTab}>
            {showComicSkeleton ? (
              <div aria-busy="true" className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                <span className="sr-only">Loading comics</span>
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} aria-hidden="true" className="flex flex-col gap-2">
                    <Skeleton className="aspect-[2/3] w-full rounded-2xl" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : activeTab === 'follows' && followedPubkeys.length === 0 ? (
              <EmptyState title="No follows yet" body="Follow people on Nostr to see their comics here." />
            ) : activeTab === 'authors' && !activeAuthor ? (
              authorDirectoryLoading ? (
                <EmptyState title="Loading authors" body="Aggregating authors from the local catalog." />
              ) : authorDirectory.length === 0 ? (
                <EmptyState title="No authors found" body="Authors will appear here once Mangatsu comics have synced." />
              ) : (
                <div className="flex flex-col gap-3">
                  {followError ? (
                    <p role="alert" className="text-sm text-destructive">{followError}</p>
                  ) : null}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {authorDirectory.map((author) => {
                      const isFollowing = followedPubkeys.includes(author.pubkey)
                      const pending = Boolean(followPending[author.pubkey])
                      return (
                        <div
                          key={author.pubkey}
                          className="relative flex flex-col justify-between rounded-[1.5rem] border bg-card/70 p-5 transition-colors hover:bg-muted/60"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <button
                              type="button"
                              onClick={() => updateSearchParams({ author: author.pubkey })}
                              className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              <AuthorAvatar
                                pubkey={author.pubkey}
                                name={authorLabel(author.pubkey)}
                                picture={authorPicture(author.pubkey)}
                              />
                              <div className="min-w-0">
                                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Author</p>
                                <p className="mt-1 truncate text-base font-medium group-hover:underline">
                                  {authorLabel(author.pubkey)}
                                </p>
                              </div>
                            </button>

                            {pubkey && pubkey !== author.pubkey && (
                              <Button
                                type="button"
                                variant={isFollowing ? 'outline' : 'default'}
                                size="sm"
                                disabled={pending}
                                onClick={() => void handleToggleFollow(author.pubkey)}
                                aria-label={isFollowing ? 'Unfollow' : 'Follow'}
                                className={cn(
                                  'shrink-0 rounded-full sm:px-3',
                                  isFollowing && 'hover:border-destructive/60 hover:text-destructive',
                                )}
                              >
                                {isFollowing ? <UserMinus /> : <UserPlus />}
                                <span className="hidden sm:inline">{isFollowing ? 'Unfollow' : 'Follow'}</span>
                              </Button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => updateSearchParams({ author: author.pubkey })}
                            className="mt-4 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <p className="text-sm text-muted-foreground">
                              {author.count} comic{author.count === 1 ? '' : 's'}
                            </p>
                            <p className="mt-1 truncate font-mono text-xs text-muted-foreground/70">{author.pubkey}</p>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            ) : feedComics.length === 0 ? (
              <EmptyState title="No comics found" body="Comics will appear here as relays sync." />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {feedComics.map((comic) => (
                    <article
                      key={`${comic.pubkey}:${comic.dTag}`}
                      className="group flex flex-col gap-2 rounded-2xl transition hover:-translate-y-0.5"
                    >
                      <Link
                        to={`/comic/${comic.dTag}?pubkey=${comic.pubkey}`}
                        className="block rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <ComicCover
                          comic={comic}
                          server={comic.coverServer || comic.blossomServer || server}
                          blurred={comic.nsfw && !showNsfw}
                        />
                        <div className="px-0.5">
                          <p className="text-sm font-medium leading-5">
                            {comic.title}
                          </p>
                        </div>
                      </Link>
                      <div className="px-0.5">
                        <button
                          type="button"
                          onClick={() => updateSearchParams({ author: resolveAuthorPubkey(comic) })}
                          className="flex w-full items-center gap-2 rounded-md text-left text-xs text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <AuthorAvatar
                            pubkey={resolveAuthorPubkey(comic)}
                            name={authorLabel(resolveAuthorPubkey(comic))}
                            picture={authorPicture(resolveAuthorPubkey(comic))}
                            className="size-5"
                          />
                          <span>
                            by{' '}
                            <span className="font-medium text-foreground/80">
                              {authorLabel(resolveAuthorPubkey(comic))}
                            </span>
                          </span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                {feedHasMore ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={feedLoading}
                      onClick={() => setVisibleCount((count) => count + 60)}
                      className="h-10 rounded-full px-4"
                    >
                      {feedLoading ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[2rem] border border-dashed bg-card/40 px-6 text-center">
      <p className="text-lg font-medium">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{body}</p>
    </section>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge asChild variant="secondary" className="h-7 gap-1.5 rounded-full pl-3 pr-2 text-sm">
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`}>
        {label}
        <X aria-hidden="true" />
      </button>
    </Badge>
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
    'aspect-[2/3] w-full rounded-2xl object-cover bg-muted shadow-lg shadow-black/20'
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
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center">
          <Badge variant="outline" className="bg-background/70 tracking-widest text-muted-foreground backdrop-blur">
            NSFW
          </Badge>
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
  className,
}: {
  pubkey: string
  name: string
  picture: string | null
  className?: string
}) {
  // The name is always shown next to the avatar, so the image is decorative.
  return (
    <Avatar className={cn('size-8 shrink-0 border', className)}>
      {picture ? <AvatarImage src={picture} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback
        aria-hidden="true"
        className="bg-[linear-gradient(135deg,_rgba(59,130,246,0.35),_rgba(168,85,247,0.35))] text-[0.65rem] font-semibold text-white"
      >
        {authorInitials(name || pubkey)}
      </AvatarFallback>
    </Avatar>
  )
}
