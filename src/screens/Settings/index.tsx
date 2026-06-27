import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore, DEFAULT_BLOSSOM_SERVERS } from '@/stores/blossomStore'
import { useRelayStore } from '@/stores/relayStore'
import { useNostr } from '@/context/NostrContext'
import { useNwcStore } from '@/stores/nwcStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { clearSession } from '@/lib/sessionCrypto'
import { useSessionStore, type SessionTimeoutOption } from '@/stores/sessionStore'

function truncatePubkey(pubkey: string) {
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`
}

interface AccountProfile {
  name: string | null
  picture: string | null
}

const BackIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0"
  >
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

export function SettingsScreen() {
  const navigate = useNavigate()
  const pubkey = useAuthStore((state) => state.pubkey)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const servers = useBlossomStore((state) => state.servers)
  const setServers = useBlossomStore((state) => state.setServers)
  const activeRelays = useRelayStore((state) => state.activeRelays)
  const userRelays = useRelayStore((state) => state.relays)
  const { service, syncGeneration } = useNostr()
  const nwcConnectionString = useNwcStore((s) => s.connectionString)
  const setConnectionString = useNwcStore((s) => s.setConnectionString)
  const showNsfw = useSettingsStore((s) => s.showNsfw)
  const setShowNsfw = useSettingsStore((s) => s.setShowNsfw)
  const enableWebTorrent = useSettingsStore((s) => s.enableWebTorrent)
  const setEnableWebTorrent = useSettingsStore((s) => s.setEnableWebTorrent)
  const [nwcInput, setNwcInput] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [isBlossomOpen, setIsBlossomOpen] = useState(false)
  const [isRelaysOpen, setIsRelaysOpen] = useState(false)
  const [isWebTorrentOpen, setIsWebTorrentOpen] = useState(false)
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null)
  const timeoutMinutes = useSessionStore((s) => s.timeoutMinutes)
  const setTimeoutMinutes = useSessionStore((s) => s.setTimeoutMinutes)
  


  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      if (!pubkey) {
        setAccountProfile(null)
        return
      }

      try {
        const profile = await service.fetchProfile(pubkey)
        if (cancelled) return

        setAccountProfile(
          profile
            ? {
                name: profile.name?.trim() || profile.display_name?.trim() || null,
                picture: profile.picture?.trim() || null,
              }
            : null,
        )
      } catch {
        if (!cancelled) {
          setAccountProfile(null)
        }
      }
    }

    void loadProfile()

    return () => {
      cancelled = true
    }
  }, [pubkey, service, syncGeneration])

  const displayRelays = activeRelays()
  const usingDefaultRelays = userRelays.length === 0

  function handleSignOut() {
    clearSession()
    clearAuth()
    sessionStorage.clear()
    navigate('/login')
  }

  function handleAddServer() {
    const url = newUrl.trim()
    if (!url) return
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && !parsed.hostname.endsWith('.localhost')) {
        setUrlError('Blossom server URL must use HTTPS')
        return
      }
    } catch {
      setUrlError('Invalid URL')
      return
    }
    setUrlError(null)
    const newServers = [...servers, { url }]
    setServers(newServers)
    setNewUrl('')
    service.publishBlossomServerList(newServers.map((s) => s.url)).catch(() => {})
  }

  function handleRemoveServer(url: string) {
    const newServers = servers.filter((s) => s.url !== url)
    setServers(newServers)
    service.publishBlossomServerList(newServers.map((s) => s.url)).catch(() => {})
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 py-4 text-zinc-100">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white"
          >
            <BackIcon />
            <span className="hidden sm:inline">Back</span>
          </button>
          <BrandMark size="sm" showLabel={false} />
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
          </div>
        </header>

        {/* Account */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-5">
          <p className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-500">Account</p>
          {pubkey ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  {accountProfile?.picture ? (
                    <img
                      src={accountProfile.picture}
                      alt={accountProfile.name ? `${accountProfile.name} avatar` : 'Account avatar'}
                      className="h-14 w-14 flex-shrink-0 rounded-2xl border border-zinc-800 object-cover bg-zinc-900"
                    />
                  ) : (
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-sm font-medium text-zinc-500">
                      {truncatePubkey(pubkey).slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-zinc-500">Account</p>
                    <p className="mt-1 truncate text-sm font-medium text-zinc-100">
                      {accountProfile?.name || truncatePubkey(pubkey)}
                    </p>
                    <p className="mt-1 font-mono text-xs text-zinc-500" data-testid="pubkey">
                      {truncatePubkey(pubkey)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-red-800 hover:text-red-400"
                  >
                    Sign out
                  </button>
              </div>
              <div className="space-y-2" data-testid="nwc-section">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Wallet (NWC)</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    Nostr Wallet Connect — connect a Lightning wallet to enable zapping
                  </p>
                </div>
                {nwcConnectionString ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="truncate font-mono text-xs text-zinc-400">
                      {nwcConnectionString.slice(0, 40)}…
                    </p>
                    <button
                      onClick={() => setConnectionString(null)}
                      className="self-start rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-red-800 hover:text-red-400 sm:self-auto"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={nwcInput}
                      onChange={(e) => setNwcInput(e.target.value)}
                      placeholder="nostr+walletconnect://..."
                      data-testid="nwc-input"
                      className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
                    />
                    <button
                      onClick={() => { if (nwcInput.trim()) { setConnectionString(nwcInput.trim()); setNwcInput('') } }}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Not signed in</p>
          )}
        </section>

        {/* Content */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-5">
          <p className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-500">Content</p>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-100">Show NSFW content</p>
              <p className="mt-0.5 text-xs text-zinc-500">Display covers marked with a content warning</p>
            </div>
            <input
              type="checkbox"
              aria-label="Show NSFW content"
              checked={showNsfw}
              onChange={(e) => setShowNsfw(e.target.checked)}
              className="accent-zinc-400 h-4 w-4"
            />
          </label>
        </section>

        {/* Blossom Servers */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-5">
          <button
            onClick={() => setIsBlossomOpen(!isBlossomOpen)}
            className="flex w-full items-center justify-between text-left focus:outline-none"
            aria-expanded={isBlossomOpen}
          >
            <span className="text-xs uppercase tracking-[0.35em] text-zinc-500 font-semibold">Blossom Servers</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${isBlossomOpen ? 'rotate-180' : ''}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div className={`mt-4 ${isBlossomOpen ? 'block' : 'hidden'}`}>
            <ul className="mb-4 space-y-2">
              {servers.length === 0 ? (
                <>
                  <li className="mb-1 text-xs text-zinc-600">No servers configured — using defaults (kind 10063)</li>
                  {DEFAULT_BLOSSOM_SERVERS.map((url, i) => (
                    <li
                      key={url}
                      className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/50 px-4 py-3 opacity-50"
                    >
                      <div className="min-w-0">
                        {i === 0 && (
                          <span className="mb-1 block text-[0.6rem] uppercase tracking-widest text-zinc-500">
                            Primary (default)
                          </span>
                        )}
                        <p className="truncate text-sm text-zinc-400">{url}</p>
                      </div>
                      <span className="flex-shrink-0 text-xs text-zinc-600">(default)</span>
                    </li>
                  ))}
                </>
              ) : (
                servers.map((server, i) => (
                  <li
                    key={server.url}
                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 px-4 py-3"
                  >
                    <div className="min-w-0">
                      {i === 0 && (
                        <span className="mb-1 block text-[0.6rem] uppercase tracking-widest text-zinc-500">
                          Primary
                        </span>
                      )}
                      <p className="truncate text-sm text-zinc-100">{server.url}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveServer(server.url)}
                      aria-label={`Remove ${server.url}`}
                      className="flex-shrink-0 rounded-full border border-zinc-800 px-2.5 py-1 text-sm text-zinc-500 transition hover:border-red-800 hover:text-red-400"
                    >
                      ×
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="flex gap-2">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => { setNewUrl(e.target.value); setUrlError(null) }}
                onKeyDown={(e) => e.key === 'Enter' && handleAddServer()}
                placeholder="https://blossom.example"
                className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
              <button
                onClick={handleAddServer}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                Add
              </button>
            </div>
            {urlError && (
              <p className="mt-2 text-sm text-red-400">{urlError}</p>
            )}
          </div>
        </section>

        {/* Relays */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-5">
          <button
            onClick={() => setIsRelaysOpen(!isRelaysOpen)}
            className="flex w-full items-center justify-between text-left focus:outline-none"
            aria-expanded={isRelaysOpen}
          >
            <span className="text-xs uppercase tracking-[0.35em] text-zinc-500 font-semibold">Relays</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${isRelaysOpen ? 'rotate-180' : ''}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div className={`mt-4 ${isRelaysOpen ? 'block' : 'hidden'}`}>
            <p className="mb-4 text-xs text-zinc-600">
              {usingDefaultRelays
                ? pubkey
                  ? 'Using public defaults — no kind 10002 list found on your relays'
                  : 'Using public defaults — sign in to load your relay list'
                : 'From your kind 10002 list'}
            </p>
            <ul className="space-y-2">
              {displayRelays.map((relay) => (
                <li
                  key={relay}
                  className="rounded-xl border border-zinc-800 px-4 py-3 font-mono text-sm text-zinc-400"
                >
                  {relay}
                </li>
              ))}
            </ul>
          </div>
        </section>
        {/* WebTorrent */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-5">
          <button
            onClick={() => setIsWebTorrentOpen(!isWebTorrentOpen)}
            className="flex w-full items-center justify-between text-left focus:outline-none"
            aria-expanded={isWebTorrentOpen}
          >
            <span className="text-xs uppercase tracking-[0.35em] text-zinc-500 font-semibold">WebTorrent</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${isWebTorrentOpen ? 'rotate-180' : ''}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          
          <div className={`mt-4 ${isWebTorrentOpen ? 'block' : 'hidden'}`}>
            <label className="flex cursor-pointer items-center justify-between gap-4">
              <div>
                <p className="text-sm text-zinc-100">Enable WebTorrent sharing</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Use WebRTC peer-to-peer sharing to download and seed comic chapters (alleviates Blossom servers)
                </p>
              </div>
              <input
                type="checkbox"
                aria-label="Enable WebTorrent sharing"
                checked={enableWebTorrent}
                onChange={(e) => setEnableWebTorrent(e.target.checked)}
                className="accent-zinc-400 h-4 w-4"
              />
            </label>


          </div>
        </section>

        {/* Session */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-5">
          <p className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-500">Session</p>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-100">Auto-lock after inactivity</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Clears the session and requires re-authentication
              </p>
            </div>
            <select
              value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(Number(e.target.value) as SessionTimeoutOption)}
              aria-label="Session auto-lock timeout"
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            >
              <option value={0}>Never</option>
              <option value={15}>15 min</option>
              <option value={60}>1 hour</option>
              <option value={240}>4 hours</option>
            </select>
          </label>
        </section>
      </div>
    </div>
  )
}
