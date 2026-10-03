import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { isTauri } from '@tauri-apps/api/core'
import type { SerializedAccount } from 'applesauce-accounts'
import type {
  AmberClipboardAccount,
  ExtensionAccount,
  NostrConnectAccount,
  PrivateKeyAccount,
  NostrConnectAccountSignerData,
} from 'applesauce-accounts/accounts'
import { NostrConnectSigner } from 'applesauce-signers'
import type { TauriAmberAccount } from '@/lib/tauriAmberSigner'
import { useNostr } from '@/context/NostrContext'
import { BrandMark } from '@/components/BrandMark'
import { buildRemoteSignerPermissions, buildRemoteSignerRelays } from '@/lib/remoteSigner'
import { useAuthStore, type AuthMethod } from '@/stores/authStore'
import { initSession, clearSession } from '@/lib/sessionCrypto'
import { QrCodeView } from './QrCodeView'
import { Fingerprint, KeyRound, Link2, Puzzle, QrCode, Smartphone, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const NSEC_SESSION_KEY = 'mangatsu:nsec'

// Browser extensions (NIP-07) don't exist inside the Android app's WebView,
// and WebAuthn passkeys aren't reliably supported there either — hide both
// login methods on the native build rather than offering options that fail.
const isNativeApp = isTauri()

// Same support check applesauce-signers' AmberClipboardSigner uses internally:
// any Android WebView/browser (native app or mobile Chrome on the PWA) that
// can read the clipboard back after the signer app returns focus to us.
const isAmberSupported =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.includes('Android') &&
  Boolean(navigator.clipboard?.readText)

type ActiveMethod = 'none' | 'nsec' | 'bunker' | 'qr' | 'passkey'

// Unlike Error, DOMException (thrown by e.g. clipboard access) and plain
// string rejections (common from Tauri's IPC bridge) aren't `instanceof
// Error`, so a naive check silently drops their message. Surface whatever
// text is available instead of a generic fallback.
function describeError(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string' && cause.length > 0) return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return fallback
}

function hasNostrExtension() {
  return typeof window !== 'undefined' && Boolean((window as Window & { nostr?: unknown }).nostr)
}

interface BunkerSession {
  uri: string
  signer: NostrConnectSigner
  connectPromise: Promise<unknown> | null
}

type LoginAccount =
  | ExtensionAccount
  | PrivateKeyAccount
  | NostrConnectAccount
  | AmberClipboardAccount
  | TauriAmberAccount
  | import('nostr-passkey/applesauce').PasskeyAccount

async function commitLogin(
  account: LoginAccount,
  method: AuthMethod,
  service: ReturnType<typeof useNostr>['service'],
  setAuth: (
    pubkey: string,
    method: AuthMethod,
    account?: SerializedAccount<NostrConnectAccountSignerData> | null,
  ) => void,
  accountData: SerializedAccount<NostrConnectAccountSignerData> | null = null,
) {
  const existing = service.accountManager.getAccountForPubkey(account.pubkey)
  if (existing) {
    service.accountManager.replaceAccount(existing, account)
  } else {
    service.accountManager.addAccount(account)
  }
  service.accountManager.setActive(account)
  setAuth(account.pubkey, method, accountData)
}

export function LoginScreen() {
  const { service } = useNostr()
  const navigate = useNavigate()
  const setAuth = useAuthStore((state) => state.setAuth)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const bunkerSessionRef = useRef<BunkerSession | null>(null)
  const [activeMethod, setActiveMethod] = useState<ActiveMethod>('none')
  const [nsecValue, setNsecValue] = useState('')
  const [bunkerValue, setBunkerValue] = useState('')
  const [passkeyNsecValue, setPasskeyNsecValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasPasskeyIdentity, setHasPasskeyIdentity] = useState(false)

  useEffect(() => {
    async function checkIdentity() {
      try {
        const { hasPasskeyIdentityOnDevice } = await import('nostr-passkey/applesauce')
        setHasPasskeyIdentity(hasPasskeyIdentityOnDevice())
      } catch {
        setHasPasskeyIdentity(false)
      }
    }
    void checkIdentity()
  }, [])

  useEffect(() => {
    return () => {
      void bunkerSessionRef.current?.signer.close()
      bunkerSessionRef.current = null
    }
  }, [])

  async function handleExtension() {
    setError(null)
    setLoading(true)
    try {
      if (!hasNostrExtension()) {
        throw new Error('No extension detected. Install Alby or nos2x.')
      }
      const { ExtensionAccount } = await import('applesauce-accounts/accounts')
      const account = await ExtensionAccount.fromExtension()
      await commitLogin(account, 'extension', service, setAuth)
      await initSession()
      navigate('/')
    } catch (cause) {
      setError(describeError(cause, 'Extension login failed.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleAmber() {
    setError(null)
    setLoading(true)
    try {
      let account: AmberClipboardAccount | TauriAmberAccount
      if (isNativeApp) {
        // window.open('intent://...') fails with ERR_UNKNOWN_URL_SCHEME
        // inside Tauri's Android WebView — use the opener-plugin-based
        // signer there instead of applesauce's browser-oriented one.
        const { TauriAmberSigner, TauriAmberAccount } = await import('@/lib/tauriAmberSigner')
        const signer = new TauriAmberSigner()
        const pubkey = await signer.getPublicKey()
        account = new TauriAmberAccount(pubkey, signer)
      } else {
        const { AmberClipboardSigner } = await import('applesauce-signers')
        const { AmberClipboardAccount } = await import('applesauce-accounts/accounts')
        const signer = new AmberClipboardSigner()
        const pubkey = await signer.getPublicKey()
        account = new AmberClipboardAccount(pubkey, signer)
      }
      await commitLogin(account, 'amber', service, setAuth)
      await initSession()
      navigate('/')
    } catch (cause) {
      setError(describeError(cause, 'Signer app request failed.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleNsec() {
    setError(null)
    setLoading(true)
    try {
      const value = nsecValue.trim()
      const { PrivateKeyAccount } = await import('applesauce-accounts/accounts')
      const account = PrivateKeyAccount.fromKey(value)
      sessionStorage.setItem(NSEC_SESSION_KEY, value)
      setNsecValue('')
      await commitLogin(account, 'nsec', service, setAuth)
      await initSession()
      navigate('/')
    } catch {
      setError('Invalid nsec key.')
    } finally {
      setLoading(false)
    }
  }

  async function handleBunker() {
    setError(null)
    setLoading(true)
    try {
      const bunkerUri = bunkerValue.trim()
      const { remote, relays, secret } = NostrConnectSigner.parseBunkerURI(bunkerUri)
      const { NostrConnectAccount } = await import('applesauce-accounts/accounts')
      const existingSession = bunkerSessionRef.current
      let session = existingSession

      if (!session || session.uri !== bunkerUri) {
        if (session) {
          void session.signer.close()
        }
        session = {
          uri: bunkerUri,
          signer: new NostrConnectSigner({
            remote,
            relays: buildRemoteSignerRelays(relays),
          }),
          connectPromise: null,
        }
        bunkerSessionRef.current = session
      }

      if (!session.signer.isConnected) {
        if (!session.connectPromise) {
          session.connectPromise = session.signer.connect(secret, buildRemoteSignerPermissions())
        }

        try {
          await session.connectPromise
        } finally {
          session.connectPromise = null
        }
      }

      const pubkey = await session.signer.getPublicKey()
      const account = new NostrConnectAccount(pubkey, session.signer)
      await commitLogin(account, 'bunker', service, setAuth, account.toJSON())
      await initSession()
      navigate('/')
    } catch (cause) {
      setError(describeError(cause, 'Bunker connection failed.'))
    } finally {
      setLoading(false)
    }
  }

  async function handlePasskeyUnlock() {
    setError(null)
    setLoading(true)
    try {
      const { unlockPasskeyIdentity } = await import('nostr-passkey')
      const { buildPasskeyAccountFromIdentity } = await import('nostr-passkey/applesauce')
      const identity = await unlockPasskeyIdentity()
      const account = buildPasskeyAccountFromIdentity(identity)
      await commitLogin(account, 'passkey', service, setAuth)
      await initSession()
      navigate('/')
    } catch (cause) {
      setError(describeError(cause, 'Passkey unlock failed.'))
    } finally {
      setLoading(false)
    }
  }

  async function handlePasskeyRegister() {
    setError(null)
    setLoading(true)
    try {
      const { registerPasskeyIdentity } = await import('nostr-passkey')
      const { buildPasskeyAccountFromIdentity } = await import('nostr-passkey/applesauce')
      const identity = await registerPasskeyIdentity({ rpName: 'Mangatsu' })
      const account = buildPasskeyAccountFromIdentity(identity)
      await commitLogin(account, 'passkey', service, setAuth)
      await initSession()
      navigate('/')
    } catch (cause) {
      setError(describeError(cause, 'Passkey registration failed.'))
    } finally {
      setLoading(false)
    }
  }

  async function handlePasskeyImportNsec() {
    setError(null)
    setLoading(true)
    try {
      const value = passkeyNsecValue.trim()
      const { importPasskeyIdentityFromNsec } = await import('nostr-passkey')
      const { buildPasskeyAccountFromIdentity } = await import('nostr-passkey/applesauce')
      const identity = await importPasskeyIdentityFromNsec(value, { rpName: 'Mangatsu' })
      const account = buildPasskeyAccountFromIdentity(identity)
      setPasskeyNsecValue('')
      await commitLogin(account, 'passkey', service, setAuth)
      await initSession()
      navigate('/')
    } catch {
      setError('Invalid nsec key or import failed.')
    } finally {
      setLoading(false)
    }
  }

  /** Drop anything a method left behind: typed keys and any half-open bunker connection. */
  function resetMethod(method: Exclude<ActiveMethod, 'none'>) {
    if (method === 'nsec') {
      setNsecValue('')
    }
    if (method === 'bunker') {
      void bunkerSessionRef.current?.signer.close()
      bunkerSessionRef.current = null
      setBunkerValue('')
    }
    if (method === 'passkey') {
      setPasskeyNsecValue('')
    }
  }

  function handleCancel(method: Exclude<ActiveMethod, 'none'>) {
    resetMethod(method)
    setActiveMethod('none')
    setError(null)
  }

  function handleClearSavedSession() {
    sessionStorage.removeItem(NSEC_SESSION_KEY)
    service.accountManager.clearActive()
    clearSession()
    clearAuth()
  }

  function openMethod(method: Exclude<ActiveMethod, 'none'>) {
    if (activeMethod !== 'none' && activeMethod !== method) resetMethod(activeMethod)
    setError(null)
    setActiveMethod(method)
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(39,39,42,0.85),_rgba(9,9,11,1)_55%)] px-4 pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)] text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-8 text-center">
          <BrandMark size="lg" className="justify-center" />
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Sign in</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
            Choose a login method. nsec stays in session storage only; extension and NIP-46
            methods are transient by design.
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {isNativeApp ? null : (
            <MethodButton
              icon={Puzzle}
              title="Browser Extension"
              description="Use a NIP-07 extension."
              disabled={loading}
              onClick={handleExtension}
            />
          )}

          {isAmberSupported ? (
            <MethodButton
              icon={Smartphone}
              title="Signer App"
              description="Use Amber or another NIP-55 signer app."
              disabled={loading}
              onClick={handleAmber}
            />
          ) : null}

          {activeMethod === 'nsec' ? (
            <MethodPanel icon={KeyRound} title="Paste nsec key">
              <p className="text-sm leading-5 text-amber-200">
                This key is stored in session storage only.
              </p>
              <form
                className="mt-3 flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (nsecValue.trim()) void handleNsec()
                }}
              >
                <Input
                  type="password"
                  value={nsecValue}
                  onChange={(event) => setNsecValue(event.target.value)}
                  placeholder="nsec1..."
                  aria-label="Private key (nsec)"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  className="h-11 rounded-xl"
                />
                <PanelActions
                  submitLabel={loading ? 'Signing in…' : 'Continue'}
                  submitDisabled={loading || !nsecValue.trim()}
                  onCancel={() => handleCancel('nsec')}
                />
              </form>
            </MethodPanel>
          ) : (
            <MethodButton
              icon={KeyRound}
              title="Paste nsec key"
              description="Sign in from a private key."
              disabled={loading}
              onClick={() => openMethod('nsec')}
            />
          )}

          {activeMethod === 'bunker' ? (
            <MethodPanel icon={Link2} title="Bunker URI">
              <p className="text-sm leading-5 text-muted-foreground">Connect to a remote signer.</p>
              <form
                className="mt-3 flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (bunkerValue.trim()) void handleBunker()
                }}
              >
                <Input
                  type="text"
                  value={bunkerValue}
                  onChange={(event) => setBunkerValue(event.target.value)}
                  placeholder="bunker://..."
                  aria-label="Bunker URI"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                  className="h-11 rounded-xl"
                />
                <PanelActions
                  submitLabel={loading ? 'Connecting…' : 'Connect'}
                  submitDisabled={loading || !bunkerValue.trim()}
                  onCancel={() => handleCancel('bunker')}
                />
              </form>
            </MethodPanel>
          ) : (
            <MethodButton
              icon={Link2}
              title="Bunker URI"
              description="Use a NIP-46 remote signer."
              disabled={loading}
              onClick={() => openMethod('bunker')}
            />
          )}

          {activeMethod === 'qr' ? (
            <QrCodeView
              onSuccess={async (pubkey, account) => {
                setAuth(pubkey, 'qr', account)
                await initSession()
                navigate('/')
              }}
              onCancel={() => handleCancel('qr')}
            />
          ) : (
            <MethodButton
              icon={QrCode}
              title="QR Code"
              description="Generate a nostrconnect:// code for a mobile signer."
              disabled={loading}
              onClick={() => openMethod('qr')}
            />
          )}

          {isNativeApp ? null : activeMethod === 'passkey' ? (
            <MethodPanel icon={Fingerprint} title="Passkey">
              {hasPasskeyIdentity ? (
                <Button
                  type="button"
                  size="lg"
                  onClick={handlePasskeyUnlock}
                  disabled={loading}
                  className="h-11 w-full rounded-xl"
                >
                  {loading ? 'Unlocking…' : 'Unlock with Passkey'}
                </Button>
              ) : (
                <div className="flex flex-col gap-3">
                  <Button
                    type="button"
                    size="lg"
                    onClick={handlePasskeyRegister}
                    disabled={loading}
                    className="h-11 rounded-xl"
                  >
                    {loading ? 'Registering…' : 'Register New Passkey'}
                  </Button>
                  <div className="text-xs text-muted-foreground">or import an existing key</div>
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (passkeyNsecValue.trim()) void handlePasskeyImportNsec()
                    }}
                  >
                    <Input
                      type="password"
                      value={passkeyNsecValue}
                      onChange={(event) => setPasskeyNsecValue(event.target.value)}
                      placeholder="nsec1..."
                      aria-label="Private key to import into a passkey (nsec)"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-11 rounded-xl"
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      size="lg"
                      disabled={loading || !passkeyNsecValue.trim()}
                      className="h-11 rounded-xl"
                    >
                      Import Key into Passkey
                    </Button>
                  </form>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => handleCancel('passkey')}
                className="mt-3 h-11 w-full rounded-xl"
              >
                Cancel
              </Button>
            </MethodPanel>
          ) : (
            <MethodButton
              icon={Fingerprint}
              title="Passkey"
              description="Use WebAuthn biometrics or a hardware security key."
              disabled={loading}
              onClick={() => openMethod('passkey')}
            />
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClearSavedSession}
          className="mx-auto mt-6 text-xs uppercase tracking-[0.3em] text-muted-foreground"
        >
          Clear saved session
        </Button>
      </div>
    </div>
  )
}

function MethodButton({
  icon: Icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  title: string
  description: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-start gap-3 rounded-2xl border bg-card/90 px-4 py-4 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-1 block text-sm leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function MethodPanel({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border bg-card/90 p-4">
      <h2 className="mb-1 flex items-center gap-3 text-sm font-semibold">
        <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        {title}
      </h2>
      {children}
    </section>
  )
}

function PanelActions({
  submitLabel,
  submitDisabled,
  onCancel,
}: {
  submitLabel: string
  submitDisabled: boolean
  onCancel: () => void
}) {
  return (
    <div className="flex gap-2">
      <Button type="submit" size="lg" disabled={submitDisabled} className="h-11 flex-1 rounded-xl">
        {submitLabel}
      </Button>
      <Button type="button" variant="outline" size="lg" onClick={onCancel} className="h-11 rounded-xl px-4">
        Cancel
      </Button>
    </div>
  )
}
