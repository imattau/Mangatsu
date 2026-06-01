import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore, DEFAULT_BLOSSOM_SERVERS } from '@/stores/blossomStore'
import { useRelayStore } from '@/stores/relayStore'

function truncatePubkey(pubkey: string) {
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`
}

export function SettingsScreen() {
  const navigate = useNavigate()
  const pubkey = useAuthStore((state) => state.pubkey)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const servers = useBlossomStore((state) => state.servers)
  const setServers = useBlossomStore((state) => state.setServers)
  const activeRelays = useRelayStore((state) => state.activeRelays)
  const userRelays = useRelayStore((state) => state.relays)
  const [newUrl, setNewUrl] = useState('')
  const displayRelays = activeRelays()
  const usingDefaultRelays = userRelays.length === 0

  function handleSignOut() {
    clearAuth()
    sessionStorage.clear()
    navigate('/login')
  }

  function handleAddServer() {
    const url = newUrl.trim()
    if (!url) return
    setServers([...servers, { url }])
    setNewUrl('')
  }

  function handleRemoveServer(url: string) {
    setServers(servers.filter((s) => s.url !== url))
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 py-4 text-zinc-100">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white"
          >
            ←
          </button>
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
          </div>
        </header>

        {/* Account */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-5">
          <p className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-500">Account</p>
          {pubkey ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-zinc-500">Public key</p>
                <p className="mt-1 font-mono text-sm text-zinc-100" data-testid="pubkey">
                  {truncatePubkey(pubkey)}
                </p>
              </div>
              <button
                onClick={handleSignOut}
                className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-red-800 hover:text-red-400"
              >
                Sign out
              </button>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Not signed in</p>
          )}
        </section>

        {/* Blossom Servers */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-5">
          <p className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-500">Blossom Servers</p>
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
              onChange={(e) => setNewUrl(e.target.value)}
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
        </section>

        {/* Relays */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-5">
          <p className="mb-1 text-xs uppercase tracking-[0.35em] text-zinc-500">Relays</p>
          <p className="mb-4 text-xs text-zinc-600">
            {usingDefaultRelays
              ? 'Default relays (defaults) — sign in to load your kind 10002 list'
              : 'Relays from your kind 10002 list'}
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
        </section>
      </div>
    </div>
  )
}
