import { useEffect, useMemo, useRef, useState } from 'react'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { Comic } from '@/types'
import { useNostr } from '@/context/NostrContext'
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

  return (
    <button
      type="button"
      onClick={() => void handleBoost()}
      disabled={disabled}
      aria-label="Boost comic"
      title={errorMsg || 'Publish a Nostr note for this comic'}
      className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
    >
      <BoostIcon />
      <span className="hidden sm:inline">{buttonLabel}</span>
      <span className="sm:hidden">{buttonLabel === 'Boosting…' ? '…' : ''}</span>
    </button>
  )
}

function BoostIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
      <path d="M7 17L17 7" />
      <path d="M10 7h7v7" />
      <path d="M5 19h14" />
    </svg>
  )
}
