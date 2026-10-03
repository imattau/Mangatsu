import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { decode } from 'light-bolt11-decoder'
import { bech32 } from '@scure/base'
import type { RelayPool } from 'applesauce-relay'
import { useNwcStore } from '@/stores/nwcStore'
import { useNostr } from '@/context/NostrContext'
import { NwcClient } from '@/lib/nwc'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

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

function decodeLud06(lud06: string): string {
  const { words } = bech32.decode(lud06 as `${string}1${string}`, 1000)
  const raw = new TextDecoder().decode(bech32.fromWords(words))
  const u = new URL(raw)
  if (u.protocol !== 'https:') throw new Error('LNURL must use https')
  if (u.username || u.password) throw new Error('LNURL must not contain userinfo')
  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new Error('LNURL host not allowed')
  }
  return u.toString()
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
  lud16: string | undefined,
  lud06: string | undefined,
  amountSats: number,
): Promise<{ nwc: NwcClient; invoice: string; amountSats: number }> {
  // Validate amount
  const parsed = parseInt(String(amountSats), 10)
  if (isNaN(parsed) || parsed <= 0 || parsed > 1_000_000) {
    throw new Error('Invalid amount')
  }

  // Resolve LNURL endpoint and expected domain
  let lnurlEndpoint: string
  let expectedDomain: string
  if (lud16) {
    const addr = validateLud16(lud16)
    if (!addr) throw new Error('Invalid Lightning address format')
    lnurlEndpoint = `https://${addr.domain}/.well-known/lnurlp/${encodeURIComponent(addr.user)}`
    expectedDomain = addr.domain
  } else if (lud06) {
    lnurlEndpoint = decodeLud06(lud06)
    expectedDomain = new URL(lnurlEndpoint).hostname
  } else {
    throw new Error('No Lightning address on profile')
  }

  const nwc = new NwcClient({ connectionString, relayPool })
  await nwc.blockUntilReady()

  const lnurlRes = await fetch(lnurlEndpoint)
  const lnurlData = (await lnurlRes.json()) as { callback: string }

  // Validate callback hostname matches expected domain
  if (!validateCallback(lnurlData.callback, expectedDomain)) {
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
  const closeTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    },
    [],
  )

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setStatus('idle')
      setErrorMsg('')
      setPendingInvoice(null)
    }
  }

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
        lud16,
        lud06,
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
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null
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

  const selectedAmount = customAmount || String(amount)
  const busy = status === 'loading' || status === 'paying'

  let content: ReactNode
  if (!connectionString || errorMsg === 'no-wallet') {
    content = (
      <>
        <p className="text-muted-foreground">
          Connect a Lightning wallet in{' '}
          <Link to="/settings" className="text-yellow-400 underline underline-offset-2">Settings → Wallet (NWC)</Link>{' '}
          to enable zapping.
        </p>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </>
    )
  } else if (errorMsg === 'no-lightning') {
    content = (
      <>
        <p className="text-muted-foreground">This user has no Lightning address on their profile.</p>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </>
    )
  } else if ((status === 'confirming' || status === 'paying') && pendingInvoice) {
    content = (
      <>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Confirm Payment</p>
        <p>
          Pay <span className="font-semibold text-yellow-400">{pendingInvoice.amountSats} sats</span> via Lightning?
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-9 rounded-full px-4" disabled={busy} onClick={handleCancelPay}>
            Cancel
          </Button>
          <Button
            type="button"
            className="h-9 flex-1 rounded-full bg-yellow-500 text-zinc-950 hover:bg-yellow-400"
            disabled={busy}
            onClick={() => void handleConfirmPay()}
          >
            {status === 'paying' ? 'Paying…' : 'Confirm'}
            <Zap data-icon="inline-end" />
          </Button>
        </div>
      </>
    )
  } else {
    content = (
      <>
        <p id="zap-amount-label" className="text-xs uppercase tracking-widest text-muted-foreground">Zap amount (sats)</p>
        <div role="group" aria-labelledby="zap-amount-label" className="flex flex-wrap gap-2">
          {PRESET_AMOUNTS.map((a) => {
            const selected = amount === a && !customAmount
            return (
              <Button
                key={a}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={selected}
                onClick={() => { setAmount(a); setCustomAmount('') }}
                className={cn('rounded-full px-3', selected && 'border-yellow-500 text-yellow-400 dark:border-yellow-500')}
              >
                {a}
              </Button>
            )
          })}
        </div>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="Custom amount"
          aria-label="Custom amount in sats"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
        />
        {status === 'error' && (
          <p role="alert" className="text-destructive">{errorMsg}</p>
        )}
        {status === 'success' && <p role="status" className="text-emerald-400">Zapped! ⚡</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-9 rounded-full px-4" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="h-9 flex-1 rounded-full bg-yellow-500 text-zinc-950 hover:bg-yellow-400"
            disabled={busy}
            onClick={() => void handleZap()}
          >
            {status === 'loading' ? 'Preparing…' : `Zap ${selectedAmount} sats`}
            {status !== 'loading' && <Zap data-icon="inline-end" />}
          </Button>
        </div>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="lg"
          aria-label="Zap"
          className="h-10 rounded-full px-3 text-yellow-400 hover:border-yellow-600 hover:bg-yellow-500/10 hover:text-yellow-400 dark:hover:bg-yellow-500/10 sm:px-4"
        >
          <Zap />
          <span className="hidden sm:inline">Zap</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-3 text-sm">
        {content}
      </PopoverContent>
    </Popover>
  )
}
