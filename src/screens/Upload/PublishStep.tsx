import { useState } from 'react'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { usePublishQueueStore } from '@/stores/publishQueueStore'
import type { Comic } from '@/types'
import type { MetadataFormValues } from './MetadataStep'
import type { ChapterFormValues } from './ChapterStep'
import { buildPublishDraft, publishDraft, type PublishDraft, type UploadArtifact } from './publishDraft'
import type { ServerResult } from './UploadStep'

interface PublishStepProps {
  isNewComic: boolean
  existingDTag?: string
  metadata: MetadataFormValues
  chapter?: ChapterFormValues
  pageUploads: UploadArtifact[]
  coverUpload: UploadArtifact | null
  serverResults: ServerResult[]
  existingComic?: Comic | null
  syncLibraryList?: boolean
  onDone: (comicDTag: string) => void
}

export function PublishStep({
  isNewComic,
  existingDTag,
  metadata,
  chapter,
  pageUploads,
  coverUpload,
  serverResults,
  existingComic,
  syncLibraryList = true,
  onDone,
}: PublishStepProps) {
  const { service } = useNostr()
  const pubkey = useAuthStore((state) => state.pubkey)
  const secretKey = useAuthStore((state) => state.secretKey)
  const savedATags = useLibraryStore((state) => state.savedATags)
  const addToLibrary = useLibraryStore((state) => state.add)
  const queueDraft = usePublishQueueStore((state) => state.queueDraft)
  const [status, setStatus] = useState<'review' | 'publishing' | 'done' | 'error'>('review')
  const [errorMsg, setErrorMsg] = useState('')

  async function publish() {
    let draft: PublishDraft | null = null
    try {
      draft = await buildPublishDraft(service, {
        isNewComic,
        existingDTag,
        metadata,
        chapter,
        pageUploads,
        coverUpload,
        existingComic,
        publishComic: isNewComic || !chapter,
      })

      await publishDraft(service, draft)
      if (syncLibraryList && pubkey) {
        const comicATag = `30040:${pubkey}:${draft.comicDTag}`
        addToLibrary(comicATag)
        try {
          await service.publishLibraryList(
            [...savedATags, comicATag],
            { secretKey: secretKey ?? undefined, pubkey },
          )
        } catch {
          // Keep local saved state even if the library publish fails.
        }
      }
      setStatus('done')
      onDone(draft.comicDTag)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!draft) {
        setErrorMsg(message)
        setStatus('error')
        return
      }
      queueDraft(draft, message)
      setStatus('done')
      onDone(draft.comicDTag)
    }
  }

  function handlePublish() {
    setStatus('publishing')
    void publish()
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-zinc-100">Step 4 — Publish</h2>

      {serverResults.length > 0 && (status === 'review' || status === 'publishing' || status === 'error') && (
        <>
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="px-4 py-2 font-medium">Server</th>
                  <th className="px-4 py-2 font-medium text-right">Files</th>
                  <th className="px-4 py-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {serverResults.map((r) => {
                  const isPartial = r.uploaded < r.total
                  return (
                    <tr key={r.url} className="border-b border-zinc-800/50 last:border-0">
                      <td className="px-4 py-2 text-zinc-300 font-mono text-xs truncate max-w-[180px]">
                        {new URL(r.url).hostname}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-400">
                        {r.uploaded}/{r.total}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isPartial ? (
                          <span className="text-yellow-400">⚠ partial</span>
                        ) : (
                          <span className="text-green-400">✓</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {serverResults.some((r) => r.uploaded < r.total) && (
            <p className="text-sm text-yellow-400">
              Some servers accepted only part of the upload — they won't be recorded in the event.
            </p>
          )}
        </>
      )}
      {serverResults.length === 0 && status === 'review' && (
        <p className="text-sm text-zinc-400">No new Blossom uploads required.</p>
      )}

      {status === 'review' && (
        <button
          type="button"
          onClick={handlePublish}
          className="w-full rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200"
        >
          Publish
        </button>
      )}

      {status === 'publishing' && (
        <p className="text-sm text-zinc-400">Signing and publishing events to relays...</p>
      )}

      {status === 'error' && (
        <p className="text-sm text-red-400">Error: {errorMsg}</p>
      )}
    </div>
  )
}
