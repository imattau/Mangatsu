import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SerializedAccount } from 'applesauce-accounts'
import type {
  ExtensionAccount,
  NostrConnectAccount,
  PrivateKeyAccount,
  NostrConnectAccountSignerData,
} from 'applesauce-accounts/accounts'
import { NostrConnectSigner } from 'applesauce-signers'
import { useNostr } from '@/context/NostrContext'
import { BrandMark } from '@/components/BrandMark'
import { buildRemoteSignerPermissions, buildRemoteSignerRelays } from '@/lib/remoteSigner'
import { useAuthStore, type AuthMethod } from '@/stores/authStore'
import { initSession, clearSession } from '@/lib/sessionCrypto'
import { QrCodeView } from './QrCodeView'

const NSEC_SESSION_KEY = 'mangatsu:nsec'

type ActiveMethod = 'none' | 'nsec' | 'bunker' | 'qr' | 'passkey'

function hasNostrExtension() {
  return typeof window !== 'undefined' && Boolean((window as Window & { nostr?: unknown }).nostr)
}

interface BunkerSession {
  uri: string
  signer: NostrConnectSigner
  connectPromise: Promise<unknown> | null
}

type LoginAccount = ExtensionAccount | PrivateKeyAccount | NostrConnectAccount | import('nostr-passkey/applesauce').PasskeyAccount

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
    async function check() {
      try {
        const isPrfSupported = (await import('nostr-passkey')).isPRFSupported
        const supported = await isPrfSupported()
        if (!supported) return
      } catch {
        // passkey not available
      }
    }
    void check()
  }, [])

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
      setError(cause instanceof Error ? cause.message : 'Extension login failed.')
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
      setError(cause instanceof Error ? cause.message : 'Bunker connection failed.')
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
      setError(cause instanceof Error ? cause.message : 'Passkey unlock failed.')
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
      setError(cause instanceof Error ? cause.message : 'Passkey registration failed.')
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

  function handleCancel(method: Exclude<ActiveMethod, 'none'>) {
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
    setActiveMethod('none')
    setError(null)
  }

  function handleClearSavedSession() {
    sessionStorage.removeItem(NSEC_SESSION_KEY)
    service.accountManager.clearActive()
    clearSession()
    clearAuth()
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(39,39,42,0.85),_rgba(9,9,11,1)_55%)] px-4 py-8 text-zinc-100">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-8 text-center">
          <BrandMark size="lg" className="justify-center" />
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Sign in</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-zinc-400">
            Choose a login method. nsec stays in session storage only; extension and NIP-46
            methods are transient by design.
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-red-900/40 bg-red-950/60 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleExtension}
            disabled={loading}
            className="rounded-2xl border border-zinc-800 bg-zinc-950/90 px-4 py-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="text-sm font-semibold text-white">Browser Extension</div>
            <p className="mt-1 text-sm leading-5 text-zinc-400">Use a NIP-07 extension.</p>
          </button>

          {activeMethod === 'nsec' ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4">
              <div className="text-sm font-semibold text-white">Paste nsec key</div>
              <p className="mt-1 text-sm leading-5 text-amber-200">
                This key is stored in session storage only.
              </p>
              <input
                type="password"
                value={nsecValue}
                onChange={(event) => setNsecValue(event.target.value)}
                placeholder="nsec1..."
                autoComplete="off"
                className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-zinc-500"
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleNsec}
                  disabled={loading || !nsecValue.trim()}
                  className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={() => handleCancel('nsec')}
                  className="rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setActiveMethod('nsec')}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/90 px-4 py-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              <div className="text-sm font-semibold text-white">Paste nsec key</div>
              <p className="mt-1 text-sm leading-5 text-zinc-400">Sign in from a private key.</p>
            </button>
          )}

          {activeMethod === 'bunker' ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4">
              <div className="text-sm font-semibold text-white">Bunker URI</div>
              <p className="mt-1 text-sm leading-5 text-zinc-400">Connect to a remote signer.</p>
              <input
                type="text"
                value={bunkerValue}
                onChange={(event) => setBunkerValue(event.target.value)}
                placeholder="bunker://..."
                autoComplete="off"
                className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-zinc-500"
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleBunker}
                  disabled={loading || !bunkerValue.trim()}
                  className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Connecting…' : 'Connect'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCancel('bunker')}
                  className="rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setActiveMethod('bunker')}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/90 px-4 py-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              <div className="text-sm font-semibold text-white">Bunker URI</div>
              <p className="mt-1 text-sm leading-5 text-zinc-400">Use a NIP-46 remote signer.</p>
            </button>
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
            <button
              type="button"
              onClick={() => setActiveMethod('qr')}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/90 px-4 py-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              <div className="text-sm font-semibold text-white">QR Code</div>
              <p className="mt-1 text-sm leading-5 text-zinc-400">
                Generate a nostrconnect:// code for a mobile signer.
              </p>
            </button>
          )}

          {activeMethod === 'passkey' ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4">
              <div className="mb-3 text-sm font-semibold text-white">Passkey</div>
              {hasPasskeyIdentity ? (
                <button
                  type="button"
                  onClick={handlePasskeyUnlock}
                  disabled={loading}
                  className="w-full rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Unlocking…' : 'Unlock with Passkey'}
                </button>
              ) : (
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handlePasskeyRegister}
                    disabled={loading}
                    className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? 'Registering…' : 'Register New Passkey'}
                  </button>
                  <div className="text-xs text-zinc-500">or import an existing key</div>
                  <input
                    type="password"
                    value={passkeyNsecValue}
                    onChange={(event) => setPasskeyNsecValue(event.target.value)}
                    placeholder="nsec1..."
                    autoComplete="off"
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-zinc-500"
                  />
                  <button
                    type="button"
                    onClick={handlePasskeyImportNsec}
                    disabled={loading || !passkeyNsecValue.trim()}
                    className="rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Import Key into Passkey
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => handleCancel('passkey')}
                className="mt-3 w-full rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setActiveMethod('passkey')}
              disabled={loading}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/90 px-4 py-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="text-sm font-semibold text-white">Passkey</div>
              <p className="mt-1 text-sm leading-5 text-zinc-400">
                Use WebAuthn biometrics or a hardware security key.
              </p>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleClearSavedSession}
          className="mt-6 text-center text-xs uppercase tracking-[0.3em] text-zinc-600 transition hover:text-zinc-400"
        >
          Clear saved session
        </button>
      </div>
    </div>
  )
}
