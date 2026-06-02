import { useState } from 'react'
import NDK, { NDKNwc } from '@nostr-dev-kit/ndk'
import { useNwcStore } from '@/stores/nwcStore'
import { useNostr } from '@/context/NostrContext'

interface ZapButtonProps {
  authorPubkey: string
}

const PRESET_AMOUNTS = [21, 100, 500, 1000]

async function zapWithNwc(connectionString: string, lud16: string, amountSats: number) {
  const ndk = new NDK()
  const nwc = new NDKNwc({ ndk, pairingCode: connectionString })
  await nwc.blockUntilReady()

  const [user, domain] = lud16.split('@')
  const lnurlRes = await fetch(`https://${domain}/.well-known/lnurlp/${user}`)
  const lnurlData = (await lnurlRes.json()) as { callback: string }
  const invoiceRes = await fetch(`${lnurlData.callback}?amount=${amountSats * 1000}`)
  const { pr: invoice } = (await invoiceRes.json()) as { pr: string }

  await nwc.payInvoice(invoice)
}

export function ZapButton({ authorPubkey }: ZapButtonProps) {
  const connectionString = useNwcStore((s) => s.connectionString)
  const { service } = useNostr()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(21)
  const [customAmount, setCustomAmount] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleZap() {
    if (!connectionString) {
      setErrorMsg('no-wallet')
      return
    }
    setStatus('loading')
    setErrorMsg('')
    try {
      const profile = await service.fetchProfile(authorPubkey)
      const lud16 = profile?.lud16
      const lud06 = profile?.lud06
      if (!lud16 && !lud06) {
        setErrorMsg('no-lightning')
        setStatus('error')
        return
      }
      const finalAmount = customAmount ? parseInt(customAmount, 10) : amount
      await zapWithNwc(connectionString, lud16 ?? lud06!, finalAmount)
      setStatus('success')
      setTimeout(() => {
        setOpen(false)
        setStatus('idle')
      }, 1500)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment failed')
      setStatus('error')
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setStatus('idle'); setErrorMsg('') }}
        aria-label="Zap"
        className="rounded-full border border-zinc-700 px-3 py-2 text-sm text-yellow-400 transition hover:border-yellow-600 hover:bg-yellow-500/10"
      >
        ⚡
      </button>
    )
  }

  if (!connectionString || errorMsg === 'no-wallet') {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
        <p className="text-zinc-400">
          Connect a Lightning wallet in{' '}
          <a href="/settings" className="text-yellow-400 underline">Settings → Wallet (NWC)</a>{' '}
          to enable zapping.
        </p>
        <button onClick={() => setOpen(false)} className="mt-2 text-xs text-zinc-600 hover:text-zinc-400">
          Cancel
        </button>
      </div>
    )
  }

  if (errorMsg === 'no-lightning') {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
        <p className="text-zinc-400">This user has no Lightning address on their profile.</p>
        <button onClick={() => setOpen(false)} className="mt-2 text-xs text-zinc-600 hover:text-zinc-400">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <p className="text-xs uppercase tracking-widest text-zinc-500">Zap amount (sats)</p>
      <div className="flex flex-wrap gap-2">
        {PRESET_AMOUNTS.map((a) => (
          <button
            key={a}
            onClick={() => { setAmount(a); setCustomAmount('') }}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              amount === a && !customAmount
                ? 'border-yellow-500 text-yellow-400'
                : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            {a}
          </button>
        ))}
      </div>
      <input
        type="number"
        min={1}
        placeholder="Custom amount"
        value={customAmount}
        onChange={(e) => setCustomAmount(e.target.value)}
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      {status === 'error' && errorMsg !== 'no-wallet' && errorMsg !== 'no-lightning' && (
        <p className="text-sm text-red-400">{errorMsg}</p>
      )}
      {status === 'success' && <p className="text-sm text-emerald-400">Zapped! ⚡</p>}
      <div className="flex gap-2">
        <button
          onClick={() => setOpen(false)}
          className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleZap()}
          disabled={status === 'loading'}
          className="flex-1 rounded-full bg-yellow-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-yellow-400 disabled:opacity-50"
        >
          {status === 'loading' ? 'Paying…' : `Zap ${customAmount || amount} sats ⚡`}
        </button>
      </div>
    </div>
  )
}
