import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { useNostr } from '@/context/NostrContext'
import { BrandMark } from '@/components/BrandMark'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { useComicStore } from '@/stores/comicStore'
import type { Chapter, Comic } from '@/types'
import { MetadataStep, type MetadataFormValues } from './MetadataStep'
import { ChapterStep, type ChapterFormValues } from './ChapterStep'
import { UploadStep, type UploadResult } from './UploadStep'
import { PublishStep } from './PublishStep'
import { DoneStep } from './DoneStep'

type Step = 'metadata' | 'chapter' | 'upload' | 'publish' | 'done'

const STEP_LABELS: Record<Step, string> = {
  metadata: 'Details',
  chapter: 'Chapter',
  upload: 'Upload',
  publish: 'Publish',
  done: 'Done',
}

const STEP_ORDER: Step[] = ['metadata', 'chapter', 'upload', 'publish', 'done']
const EDIT_STEP_ORDER: Step[] = ['metadata', 'upload', 'publish', 'done']
const CHAPTER_EDIT_STEP_ORDER: Step[] = ['chapter', 'upload', 'publish', 'done']
const EMPTY_EVENTS: NostrEvent[] = []

function defaultMetadata(): MetadataFormValues {
  return {
    title: '',
    authorName: '',
    authorPubkey: '',
    authorDisplayName: '',
    description: '',
    tags: '',
    language: '',
    coverFile: null,
    coverMode: 'file',
    nsfw: false,
  }
}

function defaultChapter(): ChapterFormValues {
  return {
    chapterTitle: '',
    chapterNumber: 1,
    pages: [],
    firstPageObjectUrl: null,
  }
}

function parseTag(event: NostrEvent, name: string) {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? ''
}

function parseTagTail(event: NostrEvent, name: string, startIndex: number) {
  const tag = event.tags.find((entry) => entry[0] === name)
  return tag ? tag.slice(startIndex).filter(Boolean) : []
}

function parseAnyTag(event: NostrEvent, names: string[]) {
  for (const name of names) {
    const value = parseTag(event, name)
    if (value) {
      return value
    }
  }
  return ''
}

function parsePageUploads(event: NostrEvent): Array<{ hash: string; server: string }> {
  return event.tags
    .filter((tag) => tag[0] === 'page')
    .map((tag) => {
      const raw = tag[1] ?? ''
      const hash = raw.startsWith('blossom://') ? raw.slice('blossom://'.length) : raw
      return { hash, server: tag[2] ?? '' }
    })
    .filter((upload) => upload.hash.length > 0)
}

function parseComicEvent(event: NostrEvent, server: string | undefined): Comic | null {
  const dTag = parseTag(event, 'd')
  if (!dTag) {
    return null
  }

  const coverServers = [...parseTagTail(event, 'cover', 2), ...parseTagTail(event, 'image', 2)]
  const coverServer = coverServers[0] || ''

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: parseTag(event, 'title') || event.content || 'Untitled',
    author: parseTag(event, 'author'),
    authorPubkey: parseTag(event, 'author_pubkey'),
    description: parseTag(event, 'description') || event.content || '',
    coverHash: parseAnyTag(event, ['cover', 'cover_hash', 'image']),
    blossomServer: parseAnyTag(event, ['blossom', 'blossom_server']) || coverServer || server || '',
    coverServer,
    coverServers,
    tags: event.tags
      .filter((tag) => tag[0] === 't')
      .map((tag) => tag[1])
      .filter(Boolean),
    eventId: event.id,
  }
}

function parseChapterNumberFromDTag(dTag: string): number {
  const match = dTag.match(/(\d+(?:\.\d+)?)$/)
  return match ? parseFloat(match[1]) : 1
}

function parseChapterEvent(event: NostrEvent, comicDTag: string): Chapter | null {
  const dTag = parseTag(event, 'd')
  if (!dTag || !dTag.startsWith(`${comicDTag}/`)) {
    return null
  }

  const pageUploads = parsePageUploads(event)
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    parentDTag: comicDTag,
    title: parseTag(event, 'title') || dTag,
    pageHashes: pageUploads.map((upload) => upload.hash),
    blossomServer: parseTag(event, 'blossom') || pageUploads[0]?.server || '',
    pageServers: pageUploads.map((upload) => upload.server),
    pageServerLists: event.tags
      .filter((tag) => tag[0] === 'page')
      .map((tag) => tag.slice(2).filter(Boolean)),
    publishedAt: event.created_at ?? 0,
    eventId: event.id,
  }
}

function metadataFromComic(comic: Comic | null | undefined): MetadataFormValues {
  if (!comic) return defaultMetadata()
  return {
    title: comic.title,
    authorName: comic.author,
    authorPubkey: comic.authorPubkey || comic.pubkey,
    authorDisplayName: '',
    description: comic.description,
    tags: comic.tags.join(', '),
    language: '',
    coverFile: null,
    coverMode: 'file',
    nsfw: false,
  }
}

function UploadHeader({ title }: { title: string }) {
  return (
    <div className="mb-8 flex items-center gap-3">
      <BrandMark size="sm" showLabel={false} />
      <div>
        <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
    </div>
  )
}

export function UploadScreen() {
  const { dTag: existingDTag, chapterId } = useParams<{ dTag?: string; chapterId?: string }>()
  const { pathname } = useLocation()
  const isNewComic = !existingDTag
  const isEditComic = Boolean(existingDTag) && !chapterId && pathname.endsWith('/edit')
  const isEditChapter = Boolean(existingDTag) && Boolean(chapterId) && pathname.endsWith('/edit')

  const eventStore = useEventStore()
  const { service, syncGeneration } = useNostr()
  const pubkey = useAuthStore((state) => state.pubkey)
  const comics = useComicStore((state) => state.comics)
  const chapters = useComicStore((state) => state.chapters)
  const setComic = useComicStore((state) => state.setComic)
  const setStoredChapter = useComicStore((state) => state.setChapter)
  const primaryServer = useBlossomStore((state) => state.primaryServer)
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>(isNewComic ? 'metadata' : isEditComic ? 'metadata' : 'chapter')
  const [metadata, setMetadata] = useState<MetadataFormValues>(defaultMetadata)
  const [chapter, setChapterForm] = useState<ChapterFormValues>(defaultChapter)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [publishedDTag, setPublishedDTag] = useState('')
  const editPrefilledRef = useRef(false)
  const chapterEditPrefilledRef = useRef(false)

  const comicFilter = useMemo(
    () =>
      pubkey && existingDTag && isEditComic
        ? [{ kinds: [30040], authors: [pubkey], '#d': [existingDTag] }]
        : null,
    [existingDTag, isEditComic, pubkey],
  )
  const comicTimeline$ = useMemo(
    () => (comicFilter ? eventStore.timeline(comicFilter) : of([])),
    [comicFilter, eventStore],
  )
  const liveComicEvents = useObservableState(comicTimeline$) ?? EMPTY_EVENTS
  const storedComic = existingDTag ? comics[existingDTag] : undefined
  const liveComic = useMemo(() => {
    for (const event of liveComicEvents) {
      const comic = parseComicEvent(event, primaryServer())
      if (comic) return comic
    }
    return null
  }, [liveComicEvents, primaryServer])
  const existingComic = storedComic ?? liveComic ?? null

  const chapterFilter = useMemo(
    () =>
      pubkey && chapterId && isEditChapter
        ? [{ kinds: [30041], authors: [pubkey], '#d': [chapterId] }]
        : null,
    [chapterId, isEditChapter, pubkey],
  )
  const chapterTimeline$ = useMemo(
    () => (chapterFilter ? eventStore.timeline(chapterFilter) : of([])),
    [chapterFilter, eventStore],
  )
  const liveChapterEvents = useObservableState(chapterTimeline$) ?? EMPTY_EVENTS
  const storedChapter = chapterId ? chapters[chapterId] : undefined
  const liveChapter = useMemo(() => {
    for (const event of liveChapterEvents) {
      const parsed = parseChapterEvent(event, existingDTag ?? '')
      if (parsed) return parsed
    }
    return null
  }, [existingDTag, liveChapterEvents])
  const existingChapter = storedChapter ?? liveChapter ?? null

  useEffect(() => {
    if (existingComic) {
      setComic(existingComic)
    }
  }, [existingComic, setComic])

  useEffect(() => {
    if (isEditChapter && existingComic) {
      setMetadata(metadataFromComic(existingComic))
    }
  }, [existingComic, isEditChapter])

  useEffect(() => {
    if (!isEditChapter || !pubkey) return
    const sub = service.subscribeToChapters(pubkey, existingDTag ?? '')
    return () => sub.unsubscribe()
  }, [existingDTag, isEditChapter, pubkey, service, syncGeneration])

  useEffect(() => {
    if (existingChapter) {
      setStoredChapter(existingChapter)
    }
  }, [existingChapter, setStoredChapter])

  useEffect(() => {
    if (!isEditComic || !existingComic || editPrefilledRef.current) return
    setMetadata(metadataFromComic(existingComic))
    editPrefilledRef.current = true
    setStep('metadata')
  }, [existingComic, isEditComic])

  useEffect(() => {
    if (!isEditChapter || !existingChapter || chapterEditPrefilledRef.current) return
    setChapterForm({
      chapterTitle: existingChapter.title,
      chapterNumber: parseChapterNumberFromDTag(existingChapter.dTag),
      pages: [],
      firstPageObjectUrl: null,
    })
    chapterEditPrefilledRef.current = true
    setStep('chapter')
  }, [existingChapter, isEditChapter])

  function reset() {
    setStep(isNewComic ? 'metadata' : isEditComic ? 'metadata' : 'chapter')
    setMetadata(metadataFromComic(isEditComic ? existingComic : null))
    setChapterForm(isEditChapter && existingChapter
      ? {
          chapterTitle: existingChapter.title,
          chapterNumber: parseChapterNumberFromDTag(existingChapter.dTag),
          pages: [],
          firstPageObjectUrl: null,
        }
      : defaultChapter())
    setUploadResult(null)
    setPublishedDTag('')
    editPrefilledRef.current = Boolean(isEditComic && existingComic)
    chapterEditPrefilledRef.current = Boolean(isEditChapter && existingChapter)
  }

  const handleUploadDone = useCallback((result: UploadResult) => {
    setUploadResult(result)
    setStep('publish')
  }, [])

  const handlePublishDone = useCallback((comicDTag: string) => {
    setPublishedDTag(comicDTag)
    setStep('done')
  }, [])

  const visibleSteps = isNewComic
    ? STEP_ORDER
    : isEditComic
      ? EDIT_STEP_ORDER
      : isEditChapter
        ? CHAPTER_EDIT_STEP_ORDER
        : STEP_ORDER.filter((s) => s !== 'metadata')
  const visibleIndex = visibleSteps.indexOf(step)

  if ((isEditComic && !existingComic) || (isEditChapter && !existingChapter)) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,rgba(9,9,11,1),rgba(15,15,18,1)_50%,rgba(9,9,11,1))] px-4 py-6 text-zinc-100">
        <div className="mx-auto w-full max-w-lg">
          <UploadHeader title={isEditComic ? 'Edit Comic Details' : 'Edit Chapter'} />
          <p className="text-sm text-zinc-400">Loading details…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(9,9,11,1),rgba(15,15,18,1)_50%,rgba(9,9,11,1))] px-4 py-6 text-zinc-100">
      <div className="mx-auto w-full max-w-lg">
        <UploadHeader
          title={isNewComic ? 'Upload Comic' : isEditComic ? 'Edit Comic Details' : isEditChapter ? 'Edit Chapter' : 'Add Chapter'}
        />

        {step !== 'done' && (
          <div className="mb-8 flex gap-2">
            {visibleSteps.filter((s) => s !== 'done').map((s, i) => (
              <div
                key={s}
                className={`flex-1 rounded-full py-1 text-center text-xs font-medium transition ${
                  i <= visibleIndex
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-900 text-zinc-600'
                }`}
              >
                {STEP_LABELS[s]}
              </div>
            ))}
          </div>
        )}

        {step === 'metadata' && (
          <MetadataStep
            values={metadata}
            onChange={setMetadata}
            onNext={() => setStep(isEditComic ? 'upload' : 'chapter')}
            allowFirstPage={!isEditComic}
          />
        )}
        {step === 'chapter' && (
          <ChapterStep
            values={chapter}
            onChange={setChapterForm}
            editing={isEditChapter}
            onNext={() => setStep('upload')}
            onBack={() => {
              if (isEditComic || isEditChapter) {
                navigate(`/comic/${existingDTag}`)
                return
              }
              setStep(isNewComic ? 'metadata' : 'chapter')
            }}
          />
        )}
        {step === 'upload' && (
          <UploadStep
            pages={isEditComic || isEditChapter ? [] : chapter.pages}
            coverFile={isEditComic ? metadata.coverFile : null}
            coverMode={isEditComic ? 'file' : metadata.coverMode}
            onDone={handleUploadDone}
            onBack={() => setStep(isEditComic ? 'metadata' : 'chapter')}
          />
        )}
        {step === 'publish' && uploadResult && (
          <PublishStep
            isNewComic={isNewComic}
            existingDTag={existingDTag}
            metadata={metadata}
            chapter={isEditComic ? undefined : chapter}
            existingChapter={isEditChapter ? existingChapter : undefined}
            pageUploads={uploadResult.pageUploads}
            coverUpload={uploadResult.coverUpload}
            serverResults={uploadResult.serverResults}
            existingComic={existingComic}
            publishChapter={isEditChapter ? true : undefined}
            syncLibraryList={!isEditComic && !isEditChapter}
            onDone={handlePublishDone}
          />
        )}
        {step === 'done' && (
          <DoneStep
            comicDTag={publishedDTag}
            onUploadAnother={reset}
          />
        )}
      </div>
    </div>
  )
}
