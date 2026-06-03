import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useNostr } from '@/context/NostrContext'
import { usePublishQueueStore } from '@/stores/publishQueueStore'
import { publishDraft } from './publishDraft'

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

  return (
    <div className="space-y-6 text-center">
      <h2 className="text-2xl font-semibold text-zinc-100">
        {queued ? 'Saved offline' : 'Published!'}
      </h2>
      <p className="text-sm text-zinc-400">
        {queued
          ? 'The Blossom upload completed, but publishing to Nostr is queued locally until you retry.'
          : 'Your comic has been published to the Nostr network.'}
      </p>

      {queued && pendingDraft?.lastError ? (
        <p className="text-sm text-amber-200">Last publish error: {pendingDraft.lastError}</p>
      ) : null}
      {retryError ? <p className="text-sm text-red-400">{retryError}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        {queued ? (
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={retrying}
            className="rounded-full bg-white px-6 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retrying ? 'Retrying…' : 'Retry Publish'}
          </button>
        ) : (
          <Link
            to={`/comic/${comicDTag}`}
            className="rounded-full bg-white px-6 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200"
          >
            View Comic
          </Link>
        )}
        <button
          type="button"
          onClick={onUploadAnother}
          className="rounded-full border border-zinc-700 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500"
        >
          Upload Another
        </button>
      </div>

      {!queued ? null : (
        <p className="text-xs text-zinc-500">
          Once publish succeeds, the queue entry is cleared and the comic will be available normally.
        </p>
      )}
    </div>
  )
}
