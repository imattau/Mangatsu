import { useState } from 'react'
import { decode } from 'light-bolt11-decoder'
import type { RelayPool } from 'applesauce-relay'
import { useNwcStore } from '@/stores/nwcStore'
import { useNostr } from '@/context/NostrContext'
import { NwcClient } from '@/lib/nwc'

interface ZapButtonProps {
  authorPubkey: string
}

const PRESET_AMOUNTS = [21, 100, 500, 1000]

function validateLud16(lud16: string): { user: string; domain: string } | null {
  const lower = lud16.toLowerCase()
  if (!/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(lower)) return null
  const [user, domain] = lower.split('@')
  return { user, domain }
}

function validateCallback(callback: string, expectedDomain: string): boolean {
  try {
    const url = new URL(callback)
    return url.protocol === 'https:' && url.hostname === expectedDomain
  } catch {
    return false
  }
}

async function fetchInvoice(
  relayPool: RelayPool,
  connectionString: string,
  lud16: string,
  amountSats: number,
): Promise<{ nwc: NwcClient; invoice: string; amountSats: number }> {
  // Validate amount
  const parsed = parseInt(String(amountSats), 10)
  if (isNaN(parsed) || parsed <= 0 || parsed > 1_000_000) {
    throw new Error('Invalid amount')
  }

  // Validate lud16
  const addr = validateLud16(lud16)
  if (!addr) {
    throw new Error('Invalid Lightning address format')
  }
  const { user, domain } = addr

  const nwc = new NwcClient({ connectionString, relayPool })
  await nwc.blockUntilReady()

  const lnurlRes = await fetch(
    `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`,
  )
  const lnurlData = (await lnurlRes.json()) as { callback: string }

  // Validate callback hostname matches lud16 domain
  if (!validateCallback(lnurlData.callback, domain)) {
    throw new Error('LNURL callback domain mismatch — possible redirect attack')
  }

  const invoiceRes = await fetch(`${lnurlData.callback}?amount=${parsed * 1000}`)
  const { pr: invoice } = (await invoiceRes.json()) as { pr: string }

  // Verify invoice amount matches what we requested
  const decoded = decode(invoice)
  const amountSection = decoded.sections.find((s) => s.name === 'amount') as
    | { value?: string }
    | undefined
  const invoiceAmountMsat = amountSection?.value ? parseInt(amountSection.value, 10) : undefined
  if (!invoiceAmountMsat || invoiceAmountMsat !== parsed * 1000) {
    throw new Error(
      `Invoice amount mismatch: expected ${parsed * 1000} msat, got ${invoiceAmountMsat}`,
    )
  }

  return { nwc, invoice, amountSats: parsed }
}

export function ZapButton({ authorPubkey }: ZapButtonProps) {
  const connectionString = useNwcStore((s) => s.connectionString)
  const { service } = useNostr()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(21)
  const [customAmount, setCustomAmount] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'confirming' | 'paying' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [pendingInvoice, setPendingInvoice] = useState<{
    nwc: NwcClient
    pr: string
    amountSats: number
  } | null>(null)

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
      const { nwc, invoice, amountSats } = await fetchInvoice(
        service.relayPool,
        connectionString,
        lud16 ?? lud06!,
        finalAmount,
      )
      // Show confirmation before paying
      setPendingInvoice({ nwc, pr: invoice, amountSats })
      setStatus('confirming')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment failed')
      setStatus('error')
    }
  }

  async function handleConfirmPay() {
    if (!pendingInvoice) return
    setStatus('paying')
    try {
      await pendingInvoice.nwc.payInvoice(pendingInvoice.pr)
      setPendingInvoice(null)
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

  function handleCancelPay() {
    setPendingInvoice(null)
    setStatus('idle')
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

  // Payment confirmation dialog
  if (status === 'confirming' && pendingInvoice) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <p className="text-xs uppercase tracking-widest text-zinc-500">Confirm Payment</p>
        <p className="text-sm text-zinc-300">
          Pay <span className="font-semibold text-yellow-400">{pendingInvoice.amountSats} sats</span> via Lightning?
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleCancelPay}
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirmPay()}
            className="flex-1 rounded-full bg-yellow-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-yellow-400"
          >
            Confirm ⚡
          </button>
        </div>
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
          disabled={status === 'loading' || status === 'paying'}
          className="flex-1 rounded-full bg-yellow-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-yellow-400 disabled:opacity-50"
        >
          {status === 'loading' ? 'Preparing…' : status === 'paying' ? 'Paying…' : `Zap ${customAmount || amount} sats ⚡`}
        </button>
      </div>
    </div>
  )
}
