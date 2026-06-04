import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useEventStore, useObservableState } from 'applesauce-react/hooks'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { of } from 'rxjs'
import { BrandMark } from '@/components/BrandMark'
import { useAuthStore } from '@/stores/authStore'
import { useBlossomStore } from '@/stores/blossomStore'
import { useComicStore } from '@/stores/comicStore'
import type { Comic } from '@/types'
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

function metadataFromComic(comic: Comic | null | undefined): MetadataFormValues {
  if (!comic) return defaultMetadata()
  return {
    title: comic.title,
    authorName: comic.author,
    authorPubkey: comic.pubkey,
    authorDisplayName: '',
    description: comic.description,
    tags: comic.tags.join(', '),
    language: '',
    coverFile: null,
    coverMode: 'file',
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
  const { dTag: existingDTag } = useParams<{ dTag?: string }>()
  const { pathname } = useLocation()
  const isNewComic = !existingDTag
  const isEditComic = Boolean(existingDTag) && pathname.endsWith('/edit')

  const eventStore = useEventStore()
  const pubkey = useAuthStore((state) => state.pubkey)
  const comics = useComicStore((state) => state.comics)
  const setComic = useComicStore((state) => state.setComic)
  const primaryServer = useBlossomStore((state) => state.primaryServer)

  const [step, setStep] = useState<Step>(isNewComic ? 'metadata' : isEditComic ? 'metadata' : 'chapter')
  const [metadata, setMetadata] = useState<MetadataFormValues>(defaultMetadata)
  const [chapter, setChapter] = useState<ChapterFormValues>(defaultChapter)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [publishedDTag, setPublishedDTag] = useState('')
  const editPrefilledRef = useRef(false)

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

  useEffect(() => {
    if (existingComic) {
      setComic(existingComic)
    }
  }, [existingComic, setComic])

  useEffect(() => {
    if (!isEditComic || !existingComic || editPrefilledRef.current) return
    setMetadata(metadataFromComic(existingComic))
    editPrefilledRef.current = true
    setStep('metadata')
  }, [existingComic, isEditComic])

  function reset() {
    setStep(isNewComic ? 'metadata' : isEditComic ? 'metadata' : 'chapter')
    setMetadata(metadataFromComic(isEditComic ? existingComic : null))
    setChapter(defaultChapter())
    setUploadResult(null)
    setPublishedDTag('')
    editPrefilledRef.current = Boolean(isEditComic && existingComic)
  }

  const handleUploadDone = useCallback((result: UploadResult) => {
    setUploadResult(result)
    setStep('publish')
  }, [])

  const handlePublishDone = useCallback((comicDTag: string) => {
    setPublishedDTag(comicDTag)
    setStep('done')
  }, [])

  const visibleSteps = isNewComic ? STEP_ORDER : isEditComic ? EDIT_STEP_ORDER : STEP_ORDER.filter((s) => s !== 'metadata')
  const visibleIndex = visibleSteps.indexOf(step)

  if (isEditComic && !existingComic) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,rgba(9,9,11,1),rgba(15,15,18,1)_50%,rgba(9,9,11,1))] px-4 py-6 text-zinc-100">
        <div className="mx-auto w-full max-w-lg">
          <UploadHeader title="Edit Comic Details" />
          <p className="text-sm text-zinc-400">Loading comic details…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(9,9,11,1),rgba(15,15,18,1)_50%,rgba(9,9,11,1))] px-4 py-6 text-zinc-100">
      <div className="mx-auto w-full max-w-lg">
        <UploadHeader
          title={isNewComic ? 'Upload Comic' : isEditComic ? 'Edit Comic Details' : 'Add Chapter'}
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
            onChange={setChapter}
            onNext={() => setStep('upload')}
            onBack={() => setStep(isNewComic ? 'metadata' : 'chapter')}
          />
        )}
        {step === 'upload' && (
          <UploadStep
            pages={isEditComic ? [] : chapter.pages}
            coverFile={metadata.coverFile}
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
            pageUploads={uploadResult.pageUploads}
            coverUpload={uploadResult.coverUpload}
            serverResults={uploadResult.serverResults}
            existingComic={existingComic}
            syncLibraryList={!isEditComic}
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
