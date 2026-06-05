import { useState } from 'react'
import { useNostr } from '@/context/NostrContext'
import { useAuthStore } from '@/stores/authStore'
import { useComicStore } from '@/stores/comicStore'
import { useReadStore } from '@/stores/readStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { usePublishQueueStore } from '@/stores/publishQueueStore'
import type { Chapter, Comic } from '@/types'
import type { MetadataFormValues } from './MetadataStep'
import type { ChapterFormValues } from './ChapterStep'
import { buildPublishDraft, publishDraft, type PublishDraft, type UploadArtifact } from './publishDraft'
import type { ServerResult } from './UploadStep'

interface PublishStepProps {
  isNewComic: boolean
  existingDTag?: string
  metadata: MetadataFormValues
  chapter?: ChapterFormValues
  existingChapter?: Chapter | null
  pageUploads: UploadArtifact[]
  coverUpload: UploadArtifact | null
  serverResults: ServerResult[]
  existingComic?: Comic | null
  publishChapter?: boolean
  syncLibraryList?: boolean
  magnetURI?: string
  onDone: (comicDTag: string) => void
}

export function PublishStep({
  isNewComic,
  existingDTag,
  metadata,
  chapter,
  existingChapter,
  pageUploads,
  coverUpload,
  serverResults,
  existingComic,
  publishChapter,
  syncLibraryList = true,
  magnetURI,
  onDone,
}: PublishStepProps) {
  const { service } = useNostr()
  const pubkey = useAuthStore((state) => state.pubkey)
  const secretKey = useAuthStore((state) => state.secretKey)
  const setChapter = useComicStore((state) => state.forceSetChapter)
  const removeChapter = useComicStore((state) => state.removeChapter)
  const removeProgressForChapter = useReadStore((state) => state.removeProgressForChapter)
  const savedATags = useLibraryStore((state) => state.savedATags)
  const addToLibrary = useLibraryStore((state) => state.add)
  const queueDraft = usePublishQueueStore((state) => state.queueDraft)
  const [status, setStatus] = useState<'review' | 'publishing' | 'done' | 'error'>('review')
  const [errorMsg, setErrorMsg] = useState('')
  const uploads = [
    ...pageUploads.map((upload, index) => ({ label: `Page ${index + 1}`, upload })),
    ...(coverUpload ? [{ label: 'Cover', upload: coverUpload }] : []),
  ]
  const missingAssetsByServer = uploads.reduce<Record<string, string[]>>((acc, { label, upload }) => {
    for (const server of upload.missingServers ?? []) {
      if (!acc[server]) {
        acc[server] = []
      }
      acc[server].push(label)
    }
    return acc
  }, {})

  async function publish() {
    let draft: PublishDraft | null = null
    try {
      draft = await buildPublishDraft(service, {
        isNewComic,
        existingDTag,
        metadata,
        chapter,
        existingChapter,
        pageUploads,
        coverUpload,
        existingComic,
        publishComic: isNewComic || !chapter,
        publishChapter,
        magnetURI,
      })

      await publishDraft(service, draft)
      if (chapter) {
        const nextChapterDTag = `${draft.comicDTag}/chapter-${chapter.chapterNumber}`
        const pageArtifacts =
          pageUploads.length > 0
            ? pageUploads
            : existingChapter
              ? existingChapter.pageHashes.map((hash, index) => ({
                  hash,
                  servers: [
                    ...(existingChapter.pageServerLists?.[index] ?? []),
                    existingChapter.pageServers?.[index],
                    existingChapter.blossomServer,
                    existingComic?.blossomServer,
                    ...(existingComic?.coverServers ?? []),
                    existingComic?.coverServer,
                  ].filter(Boolean) as string[],
                }))
              : []
        if (existingChapter && existingChapter.dTag !== nextChapterDTag) {
          removeChapter(existingChapter.dTag)
          removeProgressForChapter(existingChapter.dTag)
        }

        setChapter({
          id: draft.events.at(-1)?.id ?? existingChapter?.id ?? nextChapterDTag,
          pubkey: pubkey ?? existingChapter?.pubkey ?? '',
          dTag: nextChapterDTag,
          parentDTag: draft.comicDTag,
          title: chapter.chapterTitle,
          pageHashes: pageArtifacts.map((upload) => upload.hash),
          blossomServer: pageArtifacts[0]?.servers[0] ?? existingChapter?.blossomServer ?? '',
          pageServers: pageArtifacts.map((upload) => upload.servers[0] ?? ''),
          pageServerLists: pageArtifacts.map((upload) => upload.servers),
          publishedAt: draft.createdAt,
          eventId: draft.events.at(-1)?.id ?? existingChapter?.eventId ?? nextChapterDTag,
          torrent: magnetURI ?? existingChapter?.torrent,
        })
      }

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
            <div className="space-y-3">
              <p className="text-sm text-yellow-400">
                Some servers accepted only part of the upload. Publish will record the servers that
                actually stored each asset, so the event can still go out.
              </p>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Missing assets</p>
                <div className="mt-3 space-y-3">
                  {Object.entries(missingAssetsByServer).map(([server, labels]) => (
                    <div key={server} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <p className="truncate text-sm font-medium text-zinc-200">{new URL(server).hostname}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Missing {labels.length} asset{labels.length === 1 ? '' : 's'}: {labels.join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {serverResults.length === 0 && status === 'review' && (
        <p className="text-sm text-zinc-400">No new Blossom uploads required.</p>
      )}

      {status === 'review' && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">WebTorrent Sharing</p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            {magnetURI ? (
              <>
                <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-zinc-200">Active — Seeding chapter P2P (magnet link generated)</span>
              </>
            ) : (
              <>
                <span className="flex h-2 w-2 rounded-full bg-zinc-600" />
                <span className="text-zinc-500">Inactive — Seeding disabled in global settings</span>
              </>
            )}
          </div>
        </div>
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
