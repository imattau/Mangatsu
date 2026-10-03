import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { QRCode } from 'react-qr-code'
import { isTauri } from '@tauri-apps/api/core'
import type { SerializedAccount } from 'applesauce-accounts'
import { NostrConnectAccount } from 'applesauce-accounts/accounts'
import type { NostrConnectAccountSignerData } from 'applesauce-accounts/accounts'
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers'
import { useNostr } from '@/context/NostrContext'
import {
  buildRemoteSignerPermissions,
  buildRemoteSignerRelays,
  resolveConnectedSignerPubkey,
} from '@/lib/remoteSigner'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  onSuccess: (
    pubkey: string,
    account: SerializedAccount<NostrConnectAccountSignerData>,
  ) => void
  onCancel: () => void
}

export function QrCodeView({ onSuccess: onSuccessProp, onCancel }: Props) {
  const { service } = useNostr()
  const [uri, setUri] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | null>(null)
  const onSuccess = useEffectEvent(onSuccessProp)

  useEffect(
    () => () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
    },
    [],
  )

  // On a phone the signer app is on the same device, so there is nothing to scan with;
  // let people paste the link into their signer instead.
  async function handleCopy() {
    if (!uri) return
    try {
      if (isTauri()) {
        // The WebView's own clipboard API is permission-gated on Android; write through the
        // native plugin, as tauriAmberSigner does for reads.
        const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
        await writeText(uri)
      } else {
        await navigator.clipboard.writeText(uri)
      }
      setCopied(true)
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy the link. Try again, or scan the code from another device.')
    }
  }

  useEffect(() => {
    let cancelled = false
    let signer: NostrConnectSigner | null = null

    async function setup() {
      try {
        const localSigner = new PrivateKeySigner()
        signer = new NostrConnectSigner({
          relays: buildRemoteSignerRelays(),
          signer: localSigner,
        })

        const connectUri = signer.getNostrConnectURI({
          name: 'Mangatsu',
          permissions: buildRemoteSignerPermissions(),
        })

        if (!cancelled) {
          setUri(connectUri)
        }

        await signer.open()
        await signer.waitForSigner()
        const pubkey = await resolveConnectedSignerPubkey(signer)

        if (cancelled) {
          return
        }

        const account = new NostrConnectAccount(pubkey, signer)
        const existing = service.accountManager.getAccountForPubkey(account.pubkey)
        if (existing) {
          service.accountManager.replaceAccount(existing, account)
        } else {
          service.accountManager.addAccount(account)
        }
        service.accountManager.setActive(account)
        onSuccess(account.pubkey, account.toJSON())
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
    <section aria-label="QR Code" className="rounded-2xl border bg-card/90 p-4 shadow-lg shadow-black/20">
      <div className="mb-4 text-center">
        <h2 className="text-sm font-semibold">Scan to connect</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Open a Nostr signer app on your phone and scan this code, or copy the link into it.
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex justify-center py-4">
        {uri ? (
          <div className="rounded-2xl bg-white p-3">
            <QRCode value={uri} size={196} title="Nostr Connect QR code" />
          </div>
        ) : (
          <Skeleton aria-label="Generating connection code" className="h-[220px] w-[220px] rounded-2xl" />
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={!uri}
          onClick={() => void handleCopy()}
          className="h-10 rounded-full px-4"
        >
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? 'Copied' : 'Copy connection link'}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel} className="h-10 rounded-full px-4">
          Cancel
        </Button>
      </div>
    </section>
  )
}
