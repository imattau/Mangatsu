import { useEffect, useRef, useState } from 'react'
import { useNostr } from '@/context/NostrContext'
import { usePublishQueueStore } from '@/stores/publishQueueStore'
import type { MetadataFormValues } from './MetadataStep'
import type { ChapterFormValues } from './ChapterStep'
import { buildPublishDraft, publishDraft, type PublishDraft, type UploadArtifact } from './publishDraft'

interface PublishStepProps {
  isNewComic: boolean
  existingDTag?: string
  metadata: MetadataFormValues
  chapter: ChapterFormValues
  pageUploads: UploadArtifact[]
  coverUpload: UploadArtifact | null
  onDone: (comicDTag: string) => void
}

export function PublishStep({
  isNewComic,
  existingDTag,
  metadata,
  chapter,
  pageUploads,
  coverUpload,
  onDone,
}: PublishStepProps) {
  const { service } = useNostr()
  const queueDraft = usePublishQueueStore((state) => state.queueDraft)
  const [status, setStatus] = useState<'publishing' | 'done' | 'error'>('publishing')
  const [errorMsg, setErrorMsg] = useState('')
  const ranRef = useRef(false)

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
      })

      await publishDraft(service, draft)
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

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    void publish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-100">Step 4 — Publishing</h2>
      {status === 'publishing' && (
        <p className="text-sm text-zinc-400">Signing and publishing events to relays...</p>
      )}
      {status === 'error' && (
        <p className="text-sm text-red-400">Error: {errorMsg}</p>
      )}
    </div>
  )
}
