import { useEffect, useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronLeft, LogOut, X } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore, DEFAULT_BLOSSOM_SERVERS } from '@/stores/blossomStore'
import { useRelayStore } from '@/stores/relayStore'
import { useNostr } from '@/context/NostrContext'
import { useNwcStore } from '@/stores/nwcStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { clearSession } from '@/lib/sessionCrypto'
import { useSessionStore, type SessionTimeoutOption } from '@/stores/sessionStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

function truncatePubkey(pubkey: string) {
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`
}

/** Returns an error message, or null if `value` looks like a usable NWC connection string. */
function validateNwcConnectionString(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'That does not look like a wallet connection string'
  }
  if (url.protocol !== 'nostr+walletconnect:') {
    return 'Connection string must start with nostr+walletconnect://'
  }
  if (!url.searchParams.get('relay') || !url.searchParams.get('secret')) {
    return 'Connection string is missing its relay or secret'
  }
  return null
}

interface AccountProfile {
  name: string | null
  picture: string | null
}

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
  const [nwcError, setNwcError] = useState<string | null>(null)
  const [newUrl, setNewUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [serverPending, setServerPending] = useState(false)
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

  async function updateServer(url: string, present: boolean) {
    // Without a signer there is nothing to publish; keep the change on this device.
    if (!service.activeAccount) {
      setServers(present ? [...servers, { url }] : servers.filter((s) => s.url !== url))
      return true
    }
    setServerPending(true)
    try {
      const urls = await service.setBlossomServer(url, present)
      setServers(urls.map((serverUrl) => ({ url: serverUrl })))
      return true
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Failed to update your Blossom servers')
      return false
    } finally {
      setServerPending(false)
    }
  }

  async function handleAddServer() {
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
    if (servers.some((s) => s.url.replace(/\/+$/, '').toLowerCase() === url.replace(/\/+$/, '').toLowerCase())) {
      setUrlError('That server is already in your list')
      return
    }
    setUrlError(null)
    if (await updateServer(url, true)) setNewUrl('')
  }

  function handleSaveNwc() {
    const value = nwcInput.trim()
    if (!value) return
    const error = validateNwcConnectionString(value)
    setNwcError(error)
    if (error) return
    setConnectionString(value)
    setNwcInput('')
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(9,9,11,1),_rgba(15,15,18,1)_50%,_rgba(9,9,11,1))] px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] text-foreground">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="flex items-center gap-4">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="h-9 rounded-full px-3"
          >
            <ChevronLeft />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <BrandMark size="sm" showLabel={false} />
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.45em] text-muted-foreground">Mangatsu</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
          </div>
        </header>

        <SettingsSection title="Account">
          {pubkey ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Avatar className="size-14 rounded-2xl border">
                    {accountProfile?.picture ? (
                      <AvatarImage
                        src={accountProfile.picture}
                        alt={accountProfile.name ? `${accountProfile.name} avatar` : 'Account avatar'}
                        className="rounded-2xl"
                      />
                    ) : null}
                    <AvatarFallback className="rounded-2xl text-sm font-medium">
                      {truncatePubkey(pubkey).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Account</p>
                    <p className="mt-1 truncate text-sm font-medium">
                      {accountProfile?.name || truncatePubkey(pubkey)}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground" data-testid="pubkey">
                      {truncatePubkey(pubkey)}
                    </p>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="h-9 self-start rounded-full px-4 hover:border-destructive/60 hover:text-destructive sm:self-auto"
                    >
                      <LogOut data-icon="inline-start" />
                      Sign out
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Sign out of Mangatsu?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This clears your session on this device. To sign back in you will need your
                        browser extension, signer app, or private key.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={handleSignOut}>
                        Sign out
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <div className="space-y-2" data-testid="nwc-section">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Wallet (NWC)</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    Nostr Wallet Connect — connect a Lightning wallet to enable zapping
                  </p>
                </div>
                {nwcConnectionString ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Badge variant="outline" className="h-7 gap-2 rounded-full border-emerald-500/30 px-3 text-emerald-300">
                      <span className="size-2 rounded-full bg-emerald-400" />
                      Wallet connected
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={() => setConnectionString(null)}
                      className="h-9 self-start rounded-full px-4 hover:border-destructive/60 hover:text-destructive sm:self-auto"
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleSaveNwc()
                    }}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={nwcInput}
                        onChange={(e) => {
                          setNwcInput(e.target.value)
                          setNwcError(null)
                        }}
                        placeholder="nostr+walletconnect://..."
                        aria-label="Wallet connection string"
                        aria-invalid={nwcError ? true : undefined}
                        data-testid="nwc-input"
                        className="h-10 min-w-0 flex-1 rounded-xl"
                      />
                      <Button type="submit" variant="outline" size="lg" className="h-10 rounded-xl px-4">
                        Save
                      </Button>
                    </div>
                    {nwcError ? <p role="alert" className="text-sm text-destructive">{nwcError}</p> : null}
                  </form>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not signed in</p>
          )}
        </SettingsSection>

        <SettingsSection title="Content">
          <SwitchRow
            label="Show NSFW content"
            description="Display covers marked with a content warning"
            checked={showNsfw}
            onCheckedChange={setShowNsfw}
          />
        </SettingsSection>

        <SettingsSection title="Blossom Servers" collapsible>
          <ul className="mb-4 space-y-2">
            {servers.length === 0 ? (
              <>
                <li className="mb-1 text-xs text-muted-foreground/70">No servers configured — using defaults (kind 10063)</li>
                {DEFAULT_BLOSSOM_SERVERS.map((url, i) => (
                  <li
                    key={url}
                    className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 text-muted-foreground"
                  >
                    <div className="min-w-0">
                      {i === 0 && (
                        <span className="mb-1 block text-[0.6rem] uppercase tracking-widest">
                          Primary (default)
                        </span>
                      )}
                      <p className="truncate text-sm">{url}</p>
                    </div>
                    <span className="flex-shrink-0 text-xs">(default)</span>
                  </li>
                ))}
              </>
            ) : (
              servers.map((server, i) => (
                <li
                  key={server.url}
                  className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                >
                  <div className="min-w-0">
                    {i === 0 && (
                      <span className="mb-1 block text-[0.6rem] uppercase tracking-widest text-muted-foreground">
                        Primary
                      </span>
                    )}
                    <p className="truncate text-sm">{server.url}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={serverPending}
                    onClick={() => void updateServer(server.url, false)}
                    aria-label={`Remove ${server.url}`}
                    className="shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                  >
                    <X />
                  </Button>
                </li>
              ))
            )}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void handleAddServer()
            }}
          >
            <Input
              type="url"
              inputMode="url"
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); setUrlError(null) }}
              placeholder="https://blossom.example"
              aria-label="Blossom server URL"
              aria-invalid={urlError ? true : undefined}
              className="h-10 min-w-0 flex-1 rounded-xl"
            />
            <Button type="submit" variant="outline" size="lg" disabled={serverPending} className="h-10 rounded-xl px-4">
              {serverPending ? 'Saving…' : 'Add'}
            </Button>
          </form>
          {urlError && (
            <p role="alert" className="mt-2 text-sm text-destructive">{urlError}</p>
          )}
        </SettingsSection>

        <SettingsSection title="Relays" collapsible>
          <p className="mb-4 text-xs text-muted-foreground/70">
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
                className="rounded-xl border px-4 py-3 font-mono text-sm text-muted-foreground"
              >
                {relay}
              </li>
            ))}
          </ul>
        </SettingsSection>

        <SettingsSection title="WebTorrent" collapsible>
          <SwitchRow
            label="Enable WebTorrent sharing"
            description="Use WebRTC peer-to-peer sharing to download and seed comic chapters (alleviates Blossom servers)"
            checked={enableWebTorrent}
            onCheckedChange={setEnableWebTorrent}
          />
        </SettingsSection>

        <SettingsSection title="Session">
          <div className="flex items-center justify-between gap-4">
            <div>
              <label htmlFor="session-timeout" className="text-sm">Auto-lock after inactivity</label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Clears the session and requires re-authentication
              </p>
            </div>
            {/* Native select: the OS picker is the better control on phones. */}
            <select
              id="session-timeout"
              value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(Number(e.target.value) as SessionTimeoutOption)}
              aria-label="Session auto-lock timeout"
              className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value={0}>Never</option>
              <option value={15}>15 min</option>
              <option value={60}>1 hour</option>
              <option value={240}>4 hours</option>
            </select>
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}

function SettingsSection({
  title,
  collapsible = false,
  children,
}: {
  title: string
  collapsible?: boolean
  children: ReactNode
}) {
  const heading = <span className="text-xs font-semibold uppercase tracking-[0.35em] text-muted-foreground">{title}</span>
  if (!collapsible) {
    return (
      <section className="rounded-2xl border bg-card/90 p-5">
        <h2 className="mb-4">{heading}</h2>
        {children}
      </section>
    )
  }
  return (
    <Collapsible asChild>
      <section className="group/section rounded-2xl border bg-card/90 p-5">
        <h2>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {heading}
            <ChevronDown
              aria-hidden="true"
              className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]/section:rotate-180"
            />
          </CollapsibleTrigger>
        </h2>
        {/* Stay mounted while closed so in-progress input survives collapsing. */}
        <CollapsibleContent forceMount className="mt-4 data-[state=closed]:hidden">
          {children}
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm">{label}</label>
        <p id={`${id}-description`} className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-description`}
      />
    </div>
  )
}
