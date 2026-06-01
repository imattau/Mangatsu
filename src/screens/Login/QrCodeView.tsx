import { useEffect, useEffectEvent, useState } from 'react'
import QRCode from 'react-qr-code'
import { NostrConnectAccount } from 'applesauce-accounts/accounts'
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers'
import { useNostr } from '@/context/NostrContext'

const CONNECT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol']

interface Props {
  onSuccess: (pubkey: string) => void
  onCancel: () => void
}

export function QrCodeView({ onSuccess: onSuccessProp, onCancel }: Props) {
  const { service } = useNostr()
  const [uri, setUri] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onSuccess = useEffectEvent(onSuccessProp)

  useEffect(() => {
    let cancelled = false
    let signer: NostrConnectSigner | null = null

    async function setup() {
      try {
        const localSigner = new PrivateKeySigner()
        signer = new NostrConnectSigner({
          relays: CONNECT_RELAYS,
          signer: localSigner,
        })

        const connectUri = signer.getNostrConnectURI({
          name: 'Mangatsu',
          permissions: NostrConnectSigner.buildSigningPermissions([0, 1, 3]),
        })

        if (!cancelled) {
          setUri(connectUri)
        }

        await signer.open()
        await signer.waitForSigner()
        const pubkey = await signer.getPublicKey()

        if (cancelled) {
          return
        }

        const account = new NostrConnectAccount(pubkey, signer)
        const existing = service.accountManager.getAccountForPubkey(account.pubkey)
        const active = existing ?? account
        if (!existing) {
          service.accountManager.addAccount(account)
        }
        service.accountManager.setActive(active)
        onSuccess(active.pubkey)
      } catch {
        if (!cancelled) {
          setError('QR connection failed. Try again.')
        }
      }
    }

    void setup()

    return () => {
      cancelled = true
      void signer?.close()
    }
  }, [service])

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 shadow-lg shadow-black/20">
      <div className="mb-4 text-center">
        <p className="text-sm font-semibold text-zinc-100">Scan to connect</p>
        <p className="mt-1 text-xs leading-5 text-zinc-400">
          Open a Nostr signer app on your phone and scan this code.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-900/50 bg-red-950/60 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex justify-center py-4">
        {uri ? (
          <div className="rounded-2xl bg-white p-3">
            <QRCode value={uri} size={196} />
          </div>
        ) : (
          <div className="h-[220px] w-[220px] animate-pulse rounded-2xl bg-zinc-800" />
        )}
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
