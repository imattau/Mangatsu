import { useEffect, useRef, useState } from 'react'
import { nostrService } from '@/services/NostrService'
import type { MetadataFormValues } from './MetadataStep'
import type { ChapterFormValues } from './ChapterStep'
import { slugify } from './slugify'

interface PublishStepProps {
  isNewComic: boolean
  existingDTag?: string
  metadata: MetadataFormValues
  chapter: ChapterFormValues
  pageHashes: string[]
  coverHash: string | null
  onDone: (comicDTag: string) => void
}

export function PublishStep({
  isNewComic,
  existingDTag,
  metadata,
  chapter,
  pageHashes,
  coverHash,
  onDone,
}: PublishStepProps) {
  const [status, setStatus] = useState<'publishing' | 'done' | 'error'>('publishing')
  const [errorMsg, setErrorMsg] = useState('')
  const ranRef = useRef(false)

  async function publish() {
    const account = nostrService.accountManager.active
    if (!account) {
      setErrorMsg('Not logged in')
      setStatus('error')
      return
    }
    const now = Math.floor(Date.now() / 1000)
    const comicDTag = existingDTag ?? slugify(metadata.title)

    try {
      if (isNewComic) {
        const comicTags: string[][] = [
          ['d', comicDTag],
          ['title', metadata.title],
        ]
        if (metadata.authorName) comicTags.push(['author', metadata.authorName])
        if (metadata.authorPubkey) comicTags.push(['author_pubkey', metadata.authorPubkey])
        if (metadata.description) comicTags.push(['description', metadata.description])
        if (coverHash) comicTags.push(['cover', coverHash])
        for (const t of metadata.tags.split(',').map((s) => s.trim()).filter(Boolean)) {
          comicTags.push(['t', t])
        }
        if (metadata.language) comicTags.push(['language', metadata.language])

        const comicTemplate = {
          kind: 30402,
          created_at: now,
          tags: comicTags,
          content: metadata.description,
        }
        const signedComic = await account.signer.signEvent(comicTemplate)
        await nostrService.publishEvent(signedComic as never)
      }

      const chapterDTag = `${comicDTag}/chapter-${chapter.chapterNumber}`
      const chapterTags: string[][] = [
        ['d', chapterDTag],
        ['title', chapter.chapterTitle],
        ...pageHashes.map((h) => ['page', `blossom://${h}`]),
      ]
      const chapterTemplate = {
        kind: 30403,
        created_at: now,
        tags: chapterTags,
        content: '',
      }
      const signedChapter = await account.signer.signEvent(chapterTemplate)
      await nostrService.publishEvent(signedChapter as never)

      setStatus('done')
      onDone(comicDTag)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
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
