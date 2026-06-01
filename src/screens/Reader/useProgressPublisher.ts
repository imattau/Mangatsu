import { useEffect, useRef } from 'react'
import { useNostr } from '@/context/NostrContext'

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
]

const DEBOUNCE_MS = 2000

export function useProgressPublisher(chapterDTag: string, currentPage: number) {
  const { service } = useNostr()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!chapterDTag || currentPage < 1) return

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      const account = service.accountManager.active
      if (!account) return

      try {
        const template = await service.eventFactory.build({
          kind: 30301,
          tags: [
            ['d', chapterDTag],
            ['page', String(currentPage)],
          ],
          content: '',
        })
        const signed = await account.signer.signEvent(template)
        service.relayPool.group(DEFAULT_RELAYS).publish(signed)
      } catch {
        // Silently ignore publish failures — progress is already saved locally
      }
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [chapterDTag, currentPage, service])
}
