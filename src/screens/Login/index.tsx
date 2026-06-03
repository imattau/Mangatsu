import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ExtensionAccount,
  NostrConnectAccount,
  PrivateKeyAccount,
} from 'applesauce-accounts/accounts'
import type { SerializedAccount } from 'applesauce-accounts'
import type { NostrConnectAccountSignerData } from 'applesauce-accounts/accounts'
import { NostrConnectSigner } from 'applesauce-signers'
import { useNostr } from '@/context/NostrContext'
import { BrandMark } from '@/components/BrandMark'
import { useAuthStore } from '@/stores/authStore'
import { QrCodeView } from './QrCodeView'

const NSEC_SESSION_KEY = 'mangatsu:nsec'

type ActiveMethod = 'none' | 'nsec' | 'bunker' | 'qr'

function hasNostrExtension() {
  return typeof window !== 'undefined' && Boolean((window as Window & { nostr?: unknown }).nostr)
}

async function commitLogin(
  account: ExtensionAccount | PrivateKeyAccount | NostrConnectAccount,
  method: 'extension' | 'nsec' | 'bunker' | 'qr',
  service: ReturnType<typeof useNostr>['service'],
  setAuth: (
    pubkey: string,
    method: 'extension' | 'nsec' | 'bunker' | 'qr',
    account?: SerializedAccount<NostrConnectAccountSignerData> | null,
  ) => void,
) {
  const existing = service.accountManager.getAccountForPubkey(account.pubkey)
  const active = existing ?? account
  if (!existing) {
    service.accountManager.addAccount(account)
  }
  service.accountManager.setActive(active)
  setAuth(
    active.pubkey,
    method,
    account instanceof NostrConnectAccount ? account.toJSON() : null,
  )
}

export function LoginScreen() {
  const { service } = useNostr()
  const navigate = useNavigate()
  const setAuth = useAuthStore((state) => state.setAuth)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const [activeMethod, setActiveMethod] = useState<ActiveMethod>('none')
  const [nsecValue, setNsecValue] = useState('')
  const [bunkerValue, setBunkerValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleExtension() {
    setError(null)
    setLoading(true)
    try {
      if (!hasNostrExtension()) {
        throw new Error('No extension detected. Install Alby or nos2x.')
      }
      const account = await ExtensionAccount.fromExtension()
      await commitLogin(account, 'extension', service, setAuth)
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
      const account = PrivateKeyAccount.fromKey(value)
      sessionStorage.setItem(NSEC_SESSION_KEY, value)
      setNsecValue('')
      await commitLogin(account, 'nsec', service, setAuth)
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
      const signer = await NostrConnectSigner.fromBunkerURI(bunkerValue.trim(), {
        permissions: NostrConnectSigner.buildSigningPermissions([0, 1, 3]),
      })
      const pubkey = await signer.getPublicKey()
      const account = new NostrConnectAccount(pubkey, signer)
      await commitLogin(account, 'bunker', service, setAuth)
      navigate('/')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bunker connection failed.')
    } finally {
      setLoading(false)
    }
  }

  function handleCancel(method: Exclude<ActiveMethod, 'none'>) {
    if (method === 'nsec') {
      setNsecValue('')
    }
    if (method === 'bunker') {
      setBunkerValue('')
    }
    setActiveMethod('none')
    setError(null)
  }

  function handleClearSavedSession() {
    sessionStorage.removeItem(NSEC_SESSION_KEY)
    service.accountManager.clearActive()
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
              onSuccess={(pubkey, account) => {
                setAuth(pubkey, 'qr', account)
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
