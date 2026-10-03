import { useState, useEffect, useId, useRef } from 'react'
import { decode, npubEncode } from 'nostr-tools/nip19'
import { isNip05, queryProfile } from 'nostr-tools/nip05'
import { useNostr } from '@/context/NostrContext'
import type { ProfileSearchResult } from '@/services/NostrService'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface AuthorPubkeyInputProps {
  value: string          // hex pubkey or ''
  onChange: (hex: string, displayName: string) => void
}

type Mode = 'paste' | 'search'

function isHex(s: string): boolean {
  return /^[0-9a-f]{64}$/i.test(s)
}

function tryDecodeNpub(raw: string): string | null {
  try {
    const result = decode(raw)
    if (result.type === 'npub' && typeof result.data === 'string') {
      return result.data
    }
  } catch {
    /* invalid bech32 */
  }
  return null
}

function shortNpub(hex: string): string {
  const npub = npubEncode(hex)
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`
}

function parseDisplayName(contentJson: string): string {
  try {
    const obj = JSON.parse(contentJson)
    return (obj.display_name || obj.name || '') as string
  } catch {
    return ''
  }
}

export function AuthorPubkeyInput({ value, onChange }: AuthorPubkeyInputProps) {
  const [mode, setMode] = useState<Mode>('paste')
  const [pasteRaw, setPasteRaw] = useState(value)
  const [pasteError, setPasteError] = useState('')
  const [resolvedName, setResolvedName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchedQuery, setSearchedQuery] = useState('')
  const { service, syncGeneration } = useNostr()
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRunRef = useRef(0)
  const inputId = useId()

  useEffect(() => {
    const runs = searchRunRef
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      runs.current += 1 // ignore a search that finishes after unmount
    }
  }, [])

  useEffect(() => {
    if (!value) {
      setTimeout(() => setResolvedName(''), 0)
      return
    }
    const relays = service['getRelays']?.() ?? []
    const sub = service.relayPool.subscription(
      relays,
      [{ kinds: [0], authors: [value], limit: 1 }],
      { eventStore: service.eventStore },
    )
    const s = sub.subscribe({
      next: (event: { content: string }) => {
        const name = parseDisplayName(event.content)
        if (name) setResolvedName(name)
        s.unsubscribe()
      },
    })
    return () => s.unsubscribe()
  }, [value, service, syncGeneration])

  function handlePasteInput(raw: string) {
    setPasteRaw(raw)
    setPasteError('')
    const trimmed = raw.trim()
    if (!trimmed) {
      onChange('', '')
      return
    }
    if (isHex(trimmed)) {
      onChange(trimmed, '')
      return
    }
    const hex = tryDecodeNpub(trimmed)
    if (hex) {
      onChange(hex, '')
      return
    }
    setPasteError('Enter a valid npub1... or 64-char hex pubkey')
  }

  function handleSearchInput(q: string) {
    setSearchQuery(q)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!q.trim()) {
      searchRunRef.current += 1 // drop any search still in flight
      setSearchResults([])
      setSearchedQuery('')
      setSearching(false)
      return
    }
    searchTimerRef.current = setTimeout(() => {
      // Ignore results from an earlier query that finishes after this one.
      const run = ++searchRunRef.current
      setSearching(true)
      void findProfiles(q.trim()).then((results) => {
        if (run !== searchRunRef.current) return
        setSearchResults(results)
        setSearchedQuery(q.trim())
        setSearching(false)
      })
    }, 400)
  }

  /** NIP-50 relay search, plus a direct NIP-05 lookup when the query is an address. */
  async function findProfiles(q: string): Promise<ProfileSearchResult[]> {
    const [nip05Match, relayResults] = await Promise.all([
      isNip05(q) ? queryProfile(q).catch(() => null) : Promise.resolve(null),
      service.searchProfiles(q),
    ])
    if (!nip05Match) return relayResults
    const fromRelays = relayResults.find((result) => result.pubkey === nip05Match.pubkey)
    const verified = { ...(fromRelays ?? { pubkey: nip05Match.pubkey, displayName: '' }), nip05: q }
    return [verified, ...relayResults.filter((result) => result.pubkey !== nip05Match.pubkey)]
  }

  function selectResult(result: ProfileSearchResult) {
    onChange(result.pubkey, result.displayName)
    setPasteRaw(result.pubkey)
    setMode('paste')
    setSearchResults([])
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={inputId}>Author Pubkey</Label>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setMode(mode === 'paste' ? 'search' : 'paste')}
          className="ml-auto text-muted-foreground"
        >
          {mode === 'paste' ? 'Search by name' : 'Paste pubkey'}
        </Button>
      </div>

      {mode === 'paste' ? (
        <div>
          <Input
            id={inputId}
            type="text"
            placeholder="npub1... or hex pubkey"
            value={pasteRaw}
            onChange={(e) => handlePasteInput(e.target.value)}
            aria-invalid={pasteError ? true : undefined}
            aria-describedby={`${inputId}-status`}
            autoCapitalize="off"
            spellCheck={false}
          />
          <p id={`${inputId}-status`} aria-live="polite" className="mt-1 text-xs">
            {pasteError ? (
              <span className="text-destructive">{pasteError}</span>
            ) : resolvedName ? (
              <span className="text-muted-foreground">Resolved: {resolvedName}</span>
            ) : null}
          </p>
        </div>
      ) : (
        <div>
          <Input
            id={inputId}
            type="search"
            placeholder="Search by name or NIP-05..."
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            // Enter would otherwise submit the surrounding details form.
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault()
            }}
          />
          <p aria-live="polite" className="mt-1 text-xs text-muted-foreground">
            {searching
              ? 'Searching relays...'
              : searchedQuery && searchResults.length === 0
                ? `No profiles found for "${searchedQuery}"`
                : ''}
          </p>
          {searchResults.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border bg-popover">
              {searchResults.map((r) => (
                <li key={r.pubkey}>
                  <button
                    type="button"
                    onClick={() => selectResult(r)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                  >
                    <Avatar className="size-8 shrink-0">
                      {r.picture ? <AvatarImage src={r.picture} alt="" /> : null}
                      <AvatarFallback className="text-xs">
                        {(r.displayName || r.nip05 || '?').slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {r.displayName || shortNpub(r.pubkey)}
                      </span>
                      {r.nip05 && (
                        <span className="block truncate text-xs text-muted-foreground">{r.nip05}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
