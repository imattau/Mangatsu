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
import { AlertTriangle, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/** Hostname for display; server lists can come from relays, so don't trust them to parse. */
function serverHost(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

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
  const setLibrary = useLibraryStore((state) => state.setAll)
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
                  torrentURI:
                    existingChapter.pageTorrents?.[index] ??
                    existingChapter.torrent ??
                    undefined,
                }))
              : []
        const pageDimensions =
          chapter.pageDimensions.length > 0 ? chapter.pageDimensions : existingChapter?.pageDimensions ?? []
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
          pageDimensions,
          blossomServer: pageArtifacts[0]?.servers[0] ?? existingChapter?.blossomServer ?? '',
          pageServers: pageArtifacts.map((upload) => upload.servers[0] ?? ''),
          pageServerLists: pageArtifacts.map((upload) => upload.servers),
          pageTorrents: pageArtifacts.map((upload) => upload.torrentURI ?? ''),
          publishedAt: draft.createdAt,
          eventId: draft.events.at(-1)?.id ?? existingChapter?.eventId ?? nextChapterDTag,
          torrent: pageArtifacts[0]?.torrentURI ?? existingChapter?.torrent,
        })
      }

      if (syncLibraryList && pubkey) {
        const comicATag = `30040:${pubkey}:${draft.comicDTag}`
        addToLibrary(comicATag)
        try {
          setLibrary(await service.setLibraryEntry(comicATag, true, { secretKey: secretKey ?? undefined }))
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
      <h2 className="text-lg font-semibold">Publish</h2>

      {serverResults.length > 0 && (status === 'review' || status === 'publishing' || status === 'error') && (
        <>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Server</th>
                  <th className="px-4 py-2 text-right font-medium">Files</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {serverResults.map((r) => {
                  const isPartial = r.uploaded < r.total
                  return (
                    <tr key={r.url} className="border-b border-border/50 last:border-0">
                      <td className="max-w-[180px] truncate px-4 py-2 font-mono text-xs">
                        {serverHost(r.url)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {r.uploaded}/{r.total}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isPartial ? (
                          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                            <AlertTriangle aria-hidden="true" />
                            Partial
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                            <Check aria-hidden="true" />
                            Done
                          </Badge>
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
              <p className="text-sm text-amber-300">
                Some servers accepted only part of the upload. Publish will record the servers that
                actually stored each asset, so the event can still go out.
              </p>
              <div className="rounded-xl border bg-card/60 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Missing assets</p>
                <div className="mt-3 space-y-3">
                  {Object.entries(missingAssetsByServer).map(([server, labels]) => (
                    <div key={server} className="rounded-lg border bg-muted/30 p-3">
                      <p className="truncate text-sm font-medium">{serverHost(server)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
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
        <p className="text-sm text-muted-foreground">No new Blossom uploads required.</p>
      )}

      {status === 'review' && (
        <div className="rounded-xl border bg-card/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">WebTorrent Sharing</p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            {magnetURI ? (
              <>
                <span className="flex size-2 animate-pulse rounded-full bg-emerald-500" />
                <span>Active — Seeding page torrents for P2P fallback</span>
              </>
            ) : (
              <>
                <span className="flex size-2 rounded-full bg-muted-foreground/50" />
                <span className="text-muted-foreground">Inactive — Seeding disabled in global settings</span>
              </>
            )}
          </div>
        </div>
      )}

      {(status === 'review' || status === 'error') && (
        <Button type="button" size="lg" onClick={handlePublish} className="h-11 w-full rounded-full">
          {status === 'error' ? 'Try again' : 'Publish'}
        </Button>
      )}

      {status === 'publishing' && (
        <p role="status" className="text-sm text-muted-foreground">Signing and publishing events to relays...</p>
      )}

      {status === 'error' && (
        <p role="alert" className="text-sm text-destructive">Error: {errorMsg}</p>
      )}
    </div>
  )
}
