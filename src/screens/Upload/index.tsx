import { useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { MetadataStep, type MetadataFormValues } from './MetadataStep'
import { ChapterStep, type ChapterFormValues } from './ChapterStep'
import { UploadStep, type UploadResult, type ServerResult } from './UploadStep'
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

export function UploadScreen() {
  const { dTag: existingDTag } = useParams<{ dTag?: string }>()
  const isNewComic = !existingDTag

  const [step, setStep] = useState<Step>(isNewComic ? 'metadata' : 'chapter')
  const [metadata, setMetadata] = useState<MetadataFormValues>(defaultMetadata)
  const [chapter, setChapter] = useState<ChapterFormValues>(defaultChapter)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [publishedDTag, setPublishedDTag] = useState('')

  function reset() {
    setStep(isNewComic ? 'metadata' : 'chapter')
    setMetadata(defaultMetadata())
    setChapter(defaultChapter())
    setUploadResult(null)
    setPublishedDTag('')
  }

  const handleUploadDone = useCallback((result: UploadResult) => {
    setUploadResult(result)
    setStep('publish')
  }, [])

  const handlePublishDone = useCallback((comicDTag: string) => {
    setPublishedDTag(comicDTag)
    setStep('done')
  }, [])

  const visibleSteps = isNewComic ? STEP_ORDER : STEP_ORDER.filter((s) => s !== 'metadata')
  const visibleIndex = visibleSteps.indexOf(step)

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(9,9,11,1),rgba(15,15,18,1)_50%,rgba(9,9,11,1))] px-4 py-6 text-zinc-100">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <BrandMark size="sm" showLabel={false} />
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {isNewComic ? 'Upload Comic' : 'Add Chapter'}
            </h1>
          </div>
        </div>

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
            onNext={() => setStep('chapter')}
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
            pages={chapter.pages}
            coverFile={metadata.coverFile}
            coverMode={metadata.coverMode}
            onDone={handleUploadDone}
            onBack={() => setStep('chapter')}
          />
        )}
        {step === 'publish' && uploadResult && (
          <PublishStep
            isNewComic={isNewComic}
            existingDTag={existingDTag}
            metadata={metadata}
            chapter={chapter}
            pageUploads={uploadResult.pageUploads}
            coverUpload={uploadResult.coverUpload}
            serverResults={uploadResult.serverResults}
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
