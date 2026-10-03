import { useEffect, useMemo, useRef, useState } from 'react'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { Check, Loader2, Repeat2 } from 'lucide-react'
import type { Comic } from '@/types'
import { useNostr } from '@/context/NostrContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  buildComicBoostContent,
  buildComicBoostTags,
  resolveComicBoostCoverUrl,
} from '@/lib/boost'

interface BoostButtonProps {
  comic: Comic
  comicUrl: string
  appOrigin: string
  blossomServers: string[]
}

type BoostStatus = 'idle' | 'loading' | 'success' | 'error'

export function BoostButton({ comic, comicUrl, appOrigin, blossomServers }: BoostButtonProps) {
  const { service } = useNostr()
  const [status, setStatus] = useState<BoostStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const successTimerRef = useRef<number | null>(null)
  const hasSigner = Boolean(service.activeAccount)

  const buttonLabel = useMemo(() => {
    if (status === 'loading') return 'Boosting…'
    if (status === 'success') return 'Boosted'
    if (status === 'error') return 'Retry boost'
    return 'Boost'
  }, [status])

  useEffect(
    () => () => {
      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current)
      }
    },
    [],
  )

  async function handleBoost() {
    if (!comic.coverHash) {
      setStatus('error')
      setErrorMsg('Missing cover image')
      return
    }

    if (!service.activeAccount) {
      setStatus('error')
      setErrorMsg('Sign in to boost comics')
      return
    }

    setStatus('loading')
    setErrorMsg('')

    try {
      const coverUrl = await resolveComicBoostCoverUrl(comic, blossomServers)
      if (!coverUrl) {
        throw new Error('Cover image is not reachable on any Blossom server')
      }

      const template = {
        kind: 1 as const,
        created_at: Math.floor(Date.now() / 1000),
        content: buildComicBoostContent(comic, comicUrl, coverUrl, appOrigin),
        tags: buildComicBoostTags(comic, coverUrl, comicUrl),
      }

      const signed = await service.activeAccount.signer.signEvent(template)
      if (!signed) {
        throw new Error('Unable to sign boost note')
      }

      await service.publishEvent(signed as NostrEvent)
      setStatus('success')
      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current)
      }
      successTimerRef.current = window.setTimeout(() => {
        setStatus('idle')
        successTimerRef.current = null
      }, 1500)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to boost comic')
    }
  }

  const disabled = !hasSigner || !comic.coverHash || status === 'loading'

  const Icon = status === 'loading' ? Loader2 : status === 'success' ? Check : Repeat2

  return (
    <Button
      type="button"
      variant={status === 'error' ? 'destructive' : 'outline'}
      size="lg"
      onClick={() => void handleBoost()}
      disabled={disabled}
      aria-label="Boost comic"
      title={errorMsg || 'Publish a Nostr note for this comic'}
      className="h-10 rounded-xl px-3 sm:px-4"
    >
      <Icon className={cn(status === 'loading' && 'animate-spin')} />
      <span className="hidden sm:inline">{buttonLabel}</span>
    </Button>
  )
}
