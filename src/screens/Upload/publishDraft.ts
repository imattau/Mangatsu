import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { NostrService } from '@/services/NostrService'
import type { Comic } from '@/types'
import type { MetadataFormValues } from './MetadataStep'
import type { ChapterFormValues } from './ChapterStep'
import { slugify } from './slugify'

export interface UploadArtifact {
  hash: string
  servers: string[]
}

export interface PublishDraftInput {
  isNewComic: boolean
  existingDTag?: string
  metadata: MetadataFormValues
  chapter?: ChapterFormValues
  pageUploads: UploadArtifact[]
  coverUpload: UploadArtifact | null
  existingComic?: Comic | null
  publishComic?: boolean
}

export interface PublishDraft {
  comicDTag: string
  title: string
  createdAt: number
  events: NostrEvent[]
}

export async function buildPublishDraft(
  service: NostrService,
  input: PublishDraftInput,
): Promise<PublishDraft> {
  const account = service.accountManager.active
  if (!account) {
    throw new Error('Not logged in')
  }

  const createdAt = Math.floor(Date.now() / 1000)
  const comicDTag = input.existingDTag ?? slugify(input.metadata.title)
  const events: NostrEvent[] = []
  const publishComic = input.publishComic ?? input.isNewComic

  if (publishComic) {
    const existingCoverUpload =
      !input.coverUpload && input.existingComic?.coverHash
        ? {
            hash: input.existingComic.coverHash,
            servers: [...new Set([
              ...(input.existingComic.coverServers ?? []),
              ...(input.existingComic.coverServer ? [input.existingComic.coverServer] : []),
              ...(input.existingComic.blossomServer ? [input.existingComic.blossomServer] : []),
            ].filter(Boolean))],
          }
        : null
    const coverUpload = input.coverUpload ?? existingCoverUpload
    const comicTags: string[][] = [
      ['d', comicDTag],
      ['title', input.metadata.title],
    ]
    if (input.metadata.authorName) comicTags.push(['author', input.metadata.authorName])
    if (input.metadata.authorPubkey) comicTags.push(['author_pubkey', input.metadata.authorPubkey])
    if (input.metadata.description) comicTags.push(['description', input.metadata.description])
    if (coverUpload) {
      comicTags.push(['cover', coverUpload.hash, ...(coverUpload.servers ?? [])])
    }
    for (const t of input.metadata.tags.split(',').map((s) => s.trim()).filter(Boolean)) {
      comicTags.push(['t', t])
    }
    if (input.metadata.language) comicTags.push(['language', input.metadata.language])

    const comicTemplate = {
      kind: 30040,
      created_at: createdAt,
      tags: comicTags,
      content: input.metadata.description,
    }
    events.push(await account.signer.signEvent(comicTemplate))
  }

  if (input.chapter) {
    const chapterDTag = `${comicDTag}/chapter-${input.chapter.chapterNumber}`
    const chapterTags: string[][] = [
      ['d', chapterDTag],
      ['title', input.chapter.chapterTitle],
      ...input.pageUploads.map((upload) => ['page', `blossom://${upload.hash}`, ...upload.servers]),
    ]
    const chapterTemplate = {
      kind: 30041,
      created_at: createdAt,
      tags: chapterTags,
      content: '',
    }
    events.push(await account.signer.signEvent(chapterTemplate))
  }

  return {
    comicDTag,
    title: input.metadata.title,
    createdAt,
    events,
  }
}

export async function publishDraft(service: NostrService, draft: PublishDraft): Promise<void> {
  for (const event of draft.events) {
    await service.publishEvent(event)
  }
}
