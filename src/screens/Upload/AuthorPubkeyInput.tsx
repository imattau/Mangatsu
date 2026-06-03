import { useState, useEffect, useRef } from 'react'
import { decode } from 'nostr-tools/nip19'
import { useNostr } from '@/context/NostrContext'

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
      setSearchResults([])
      return
    }
    searchTimerRef.current = setTimeout(() => {
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
      setTimeout(() => {
        s.unsubscribe()
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm text-zinc-400">Author Pubkey</label>
        <button
          type="button"
          onClick={() => setMode(mode === 'paste' ? 'search' : 'paste')}
          className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200"
        >
          {mode === 'paste' ? 'Search by name' : 'Paste pubkey'}
        </button>
      </div>

      {mode === 'paste' ? (
        <div>
          <input
            type="text"
            placeholder="npub1... or hex pubkey"
            value={pasteRaw}
            onChange={(e) => handlePasteInput(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
          {pasteError && <p className="mt-1 text-xs text-red-400">{pasteError}</p>}
          {resolvedName && !pasteError && (
            <p className="mt-1 text-xs text-zinc-400">Resolved: {resolvedName}</p>
          )}
        </div>
      ) : (
        <div>
          <input
            type="text"
            placeholder="Search by name or NIP-05..."
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
          {searching && <p className="mt-1 text-xs text-zinc-500">Searching relays...</p>}
          {searchResults.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900">
              {searchResults.map((r) => (
                <li key={r.pubkey}>
                  <button
                    type="button"
                    onClick={() => selectResult(r)}
                    className="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                  >
                    <span className="font-medium">{r.displayName}</span>
                    {r.nip05 && (
                      <span className="ml-2 text-xs text-zinc-500">{r.nip05}</span>
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
