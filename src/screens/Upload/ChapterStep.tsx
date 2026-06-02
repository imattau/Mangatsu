import { useState, useCallback } from 'react'
import JSZip from 'jszip'

export interface ChapterFormValues {
  chapterTitle: string
  chapterNumber: number
  pages: File[]
  firstPageObjectUrl: string | null
}

interface ChapterStepProps {
  values: ChapterFormValues
  coverMode: 'file' | 'first-page'
  onChange: (values: ChapterFormValues) => void
  onNext: () => void
  onBack: () => void
}

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp)$/i

function parseTitleFromFilename(filename: string): { number: number; title: string } {
  const withoutExt = filename.replace(/\.cbz$/i, '')
  const numMatch = withoutExt.match(/\d+(?:\.\d+)?/)
  const number = numMatch ? parseFloat(numMatch[0]) : 1
  const title = withoutExt
    .replace(/^(chapter|ch\.?|vol\.?)\s*\d+(\.\d+)?\s*[-–—]?\s*/i, '')
    .trim() || withoutExt
  return { number, title }
}

async function parseComicInfoXml(
  xmlText: string,
): Promise<{ number: number | null; title: string | null }> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const numberEl = doc.querySelector('Number')
  const titleEl = doc.querySelector('Title')
  return {
    number: numberEl?.textContent ? parseFloat(numberEl.textContent) : null,
    title: titleEl?.textContent ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ChapterStep({ values, coverMode, onChange, onNext, onBack }: ChapterStepProps) {
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')

  const handleCbz = useCallback(
    async (file: File) => {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setParseError(
          'PDF files aren\'t supported. Convert to CBZ first using Calibre (https://calibre-ebook.com, free), then upload here.',
        )
        return
      }
      if (!file.name.toLowerCase().endsWith('.cbz')) {
        setParseError('Please select a .cbz file')
        return
      }
      setParseError('')
      setParsing(true)
      try {
        const zip = await JSZip.loadAsync(file)

        const imageEntries = Object.values(zip.files)
          .filter((entry) => !entry.dir && IMAGE_EXTENSIONS.test(entry.name))
          .sort((a, b) => a.name.localeCompare(b.name))

        if (imageEntries.length === 0) {
          setParseError('No images found in the CBZ file')
          setParsing(false)
          return
        }

        let infoNumber: number | null = null
        let infoTitle: string | null = null
        const comicInfoEntry = Object.values(zip.files).find(
          (e) => e.name.toLowerCase() === 'comicinfo.xml' ||
                 e.name.toLowerCase().endsWith('/comicinfo.xml'),
        )
        if (comicInfoEntry) {
          const xmlText = await comicInfoEntry.async('text')
          const parsed = await parseComicInfoXml(xmlText)
          infoNumber = parsed.number
          infoTitle = parsed.title
        }

        const fallback = parseTitleFromFilename(file.name)
        const chapterNumber = infoNumber ?? fallback.number
        const chapterTitle = infoTitle ?? fallback.title

        const pages: File[] = await Promise.all(
          imageEntries.map(async (entry) => {
            const blob = await entry.async('blob')
            const ext = entry.name.match(/\.\w+$/)?.[0] ?? '.jpg'
            const mimeMap: Record<string, string> = {
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.png': 'image/png',
              '.webp': 'image/webp',
            }
            return new File([blob], entry.name, { type: mimeMap[ext] ?? 'image/jpeg' })
          }),
        )

        const firstPageBlob = await imageEntries[0].async('blob')
        const firstPageObjectUrl = URL.createObjectURL(firstPageBlob)

        onChange({ chapterTitle, chapterNumber, pages, firstPageObjectUrl })
      } catch (err) {
        setParseError(`Failed to parse CBZ: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setParsing(false)
      }
    },
    [onChange],
  )

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleCbz(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleCbz(file)
  }

  const canProceed = values.pages.length > 0

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-zinc-100">Step 2 — Chapter</h2>

      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex min-h-[12rem] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition ${
          dragging ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-700 bg-zinc-900/50'
        }`}
      >
        <p className="text-sm text-zinc-400">
          {parsing ? 'Parsing CBZ...' : 'Drop a .cbz file here, or click to browse'}
        </p>
        <input type="file" accept=".cbz" className="hidden" onChange={handleFileInput} />
      </label>

      {parseError && <p className="text-sm text-red-400">{parseError}</p>}

      {values.pages.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <p className="text-sm text-zinc-400">{values.pages.length} pages found</p>

          {values.firstPageObjectUrl && (
            <img
              src={values.firstPageObjectUrl}
              alt="First page preview"
              className="h-24 w-auto rounded-lg object-cover"
            />
          )}

          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Chapter Number</label>
            <input
              type="number"
              min={1}
              value={values.chapterNumber}
              onChange={(e) => onChange({ ...values, chapterNumber: parseFloat(e.target.value) || 1 })}
              className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Chapter Title</label>
            <input
              type="text"
              value={values.chapterTitle}
              onChange={(e) => onChange({ ...values, chapterTitle: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-zinc-700 px-5 py-3 text-sm text-zinc-300 transition hover:border-zinc-500"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="flex-1 rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next: Upload
        </button>
      </div>
    </div>
  )
}
