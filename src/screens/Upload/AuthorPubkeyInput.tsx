import { useState, useEffect, useId, useRef } from 'react'
import { decode } from 'nostr-tools/nip19'
import { useNostr } from '@/context/NostrContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface AuthorPubkeyInputProps {
  value: string          // hex pubkey or ''
  onChange: (hex: string, displayName: string) => void
}

type Mode = 'paste' | 'search'

interface ProfileResult {
  pubkey: string
  displayName: string
  nip05?: string
}

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
  const [searchResults, setSearchResults] = useState<ProfileResult[]>([])
  const [searching, setSearching] = useState(false)
  const { service, syncGeneration } = useNostr()
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRunRef = useRef(0)
  const inputId = useId()

  useEffect(
    () => () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      if (searchCloseTimerRef.current) clearTimeout(searchCloseTimerRef.current)
    },
    [],
  )

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
      setSearching(false)
      return
    }
    searchTimerRef.current = setTimeout(() => {
      // Ignore results from an earlier query that finishes after this one.
      const run = ++searchRunRef.current
      setSearching(true)
      const results: ProfileResult[] = []
      const relays = service['getRelays']?.() ?? []
      const sub = service.relayPool.subscription(
        relays,
        [{ kinds: [0], limit: 20 }],
        { eventStore: service.eventStore },
      )
      const s = sub.subscribe({
        next: (event: { pubkey: string; content: string }) => {
          try {
            const obj = JSON.parse(event.content)
            const displayName: string = obj.display_name || obj.name || ''
            const nip05: string = obj.nip05 || ''
            const queryLower = q.toLowerCase()
            if (
              displayName.toLowerCase().includes(queryLower) ||
              nip05.toLowerCase().includes(queryLower)
            ) {
              results.push({ pubkey: event.pubkey, displayName, nip05 })
            }
          } catch { /* skip */ }
        },
      })
      searchCloseTimerRef.current = setTimeout(() => {
        s.unsubscribe()
        if (run !== searchRunRef.current) return
        setSearchResults(results.slice(0, 10))
        setSearching(false)
      }, 2000)
    }, 400)
  }

  function selectResult(result: ProfileResult) {
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
            {searching ? 'Searching relays...' : ''}
          </p>
          {searchResults.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border bg-popover">
              {searchResults.map((r) => (
                <li key={r.pubkey}>
                  <button
                    type="button"
                    onClick={() => selectResult(r)}
                    className="w-full px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                  >
                    <span className="font-medium">{r.displayName}</span>
                    {r.nip05 && (
                      <span className="ml-2 text-xs text-muted-foreground">{r.nip05}</span>
                    )}
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
