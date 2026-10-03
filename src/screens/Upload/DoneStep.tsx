import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useNostr } from '@/context/NostrContext'
import { usePublishQueueStore } from '@/stores/publishQueueStore'
import { publishDraft } from './publishDraft'
import { CircleCheck, CloudOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DoneStepProps {
  comicDTag: string
  onUploadAnother: () => void
}

export function DoneStep({ comicDTag, onUploadAnother }: DoneStepProps) {
  const { service } = useNostr()
  const pendingDraft = usePublishQueueStore((state) => state.draftsByComicDTag[comicDTag] ?? null)
  const removeDraft = usePublishQueueStore((state) => state.removeDraft)
  const queueDraft = usePublishQueueStore((state) => state.queueDraft)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')

  async function handleRetry() {
    if (!pendingDraft) return
    setRetrying(true)
    setRetryError('')
    try {
      await publishDraft(service, pendingDraft)
      removeDraft(comicDTag)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      queueDraft(pendingDraft, message)
      setRetryError(message)
    } finally {
      setRetrying(false)
    }
  }

  const queued = Boolean(pendingDraft)

  const StatusIcon = queued ? CloudOff : CircleCheck

  return (
    <div className="space-y-6 text-center">
      <StatusIcon
        aria-hidden="true"
        className={queued ? 'mx-auto size-10 text-amber-300' : 'mx-auto size-10 text-emerald-400'}
      />
      <h2 role="status" className="text-2xl font-semibold">
        {queued ? 'Saved offline' : 'Published!'}
      </h2>
      <p className="text-sm text-muted-foreground">
        {queued
          ? 'The Blossom upload completed, but publishing to Nostr is queued locally until you retry.'
          : 'Your comic has been published to the Nostr network.'}
      </p>

      {queued && pendingDraft?.lastError ? (
        <p className="text-sm text-amber-200">Last publish error: {pendingDraft.lastError}</p>
      ) : null}
      {retryError ? <p role="alert" className="text-sm text-destructive">{retryError}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        {queued ? (
          <Button
            type="button"
            size="lg"
            onClick={() => void handleRetry()}
            disabled={retrying}
            className="h-11 rounded-full px-6"
          >
            {retrying ? 'Retrying…' : 'Retry Publish'}
          </Button>
        ) : (
          <Button asChild size="lg" className="h-11 rounded-full px-6">
            <Link to={`/comic/${comicDTag}`}>View Comic</Link>
          </Button>
        )}
        <Button type="button" variant="outline" size="lg" onClick={onUploadAnother} className="h-11 rounded-full px-6">
          Upload Another
        </Button>
      </div>

      {!queued ? null : (
        <p className="text-xs text-muted-foreground">
          Once publish succeeds, the queue entry is cleared and the comic will be available normally.
        </p>
      )}
    </div>
  )
}
