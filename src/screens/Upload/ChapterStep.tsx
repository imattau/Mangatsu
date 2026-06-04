import { useState, useCallback } from 'react'
import JSZip from 'jszip'
import { convertPdfFileToWebpPages } from './pdf'
import { MAX_CHAPTER_PAGES, MAX_CHAPTER_SOURCE_BYTES } from './limits'

export interface ChapterFormValues {
  chapterTitle: string
  chapterNumber: number
  pages: File[]
  firstPageObjectUrl: string | null
}

interface ChapterStepProps {
  values: ChapterFormValues
  onChange: (values: ChapterFormValues) => void
  onNext: () => void
  onBack: () => void
  editing?: boolean
}

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp)$/i

function parseTitleFromFilename(filename: string): { number: number; title: string } {
  const withoutExt = filename.replace(/\.(cbz|pdf)$/i, '')
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

export function ChapterStep({ values, onChange, onNext, onBack, editing = false }: ChapterStepProps) {
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')

  const handleCbz = useCallback(
    async (file: File) => {
      setParseError('')
      setParsing(true)
      try {
        if (file.size > MAX_CHAPTER_SOURCE_BYTES) {
          setParseError(
            `File is too large. Maximum allowed size is ${Math.round(MAX_CHAPTER_SOURCE_BYTES / (1024 * 1024))} MB.`,
          )
          return
        }

        const zip = await JSZip.loadAsync(file)

        const imageEntries = Object.values(zip.files)
          .filter((entry) => !entry.dir && IMAGE_EXTENSIONS.test(entry.name))
          .sort((a, b) => a.name.localeCompare(b.name))

        if (imageEntries.length === 0) {
          setParseError('No images found in the CBZ file')
          return
        }

        if (imageEntries.length > MAX_CHAPTER_PAGES) {
          setParseError(
            `Chapter has ${imageEntries.length} pages. Maximum allowed is ${MAX_CHAPTER_PAGES} pages.`,
          )
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

  const handlePdf = useCallback(
    async (file: File) => {
      setParseError('')
      setParsing(true)
      try {
        if (file.size > MAX_CHAPTER_SOURCE_BYTES) {
          setParseError(
            `File is too large. Maximum allowed size is ${Math.round(MAX_CHAPTER_SOURCE_BYTES / (1024 * 1024))} MB.`,
          )
          return
        }

        const fallback = parseTitleFromFilename(file.name)
        const { pages, firstPageObjectUrl } = await convertPdfFileToWebpPages(file)

        if (pages.length > MAX_CHAPTER_PAGES) {
          setParseError(
            `Chapter has ${pages.length} pages. Maximum allowed is ${MAX_CHAPTER_PAGES} pages.`,
          )
          return
        }

        onChange({
          chapterTitle: fallback.title,
          chapterNumber: fallback.number,
          pages,
          firstPageObjectUrl,
        })
      } catch (err) {
        setParseError(`Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setParsing(false)
      }
    },
    [onChange],
  )

  const handleFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.cbz')) {
        await handleCbz(file)
        return
      }
      if (lower.endsWith('.pdf')) {
        await handlePdf(file)
        return
      }
      setParseError('Please select a .cbz or .pdf file')
    },
    [handleCbz, handlePdf],
  )

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const canProceed = editing ? values.chapterTitle.trim().length > 0 : values.pages.length > 0

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-zinc-100">Step 2 — Chapter</h2>

      {!editing && (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex min-h-[12rem] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition ${
            dragging ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-700 bg-zinc-900/50'
          }`}
        >
          <p className="text-sm text-zinc-400">
            {parsing ? 'Parsing chapter file...' : 'Drop a .cbz or .pdf file here, or click to browse'}
          </p>
          <input type="file" accept=".cbz,.pdf,application/pdf" className="hidden" onChange={handleFileInput} />
        </label>
      )}

      {editing && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
          Existing pages will be reused unless you publish a replacement chapter later.
        </div>
      )}

      {parseError && <p className="text-sm text-red-400">{parseError}</p>}

      {(values.pages.length > 0 || editing) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <p className="text-sm text-zinc-400">
            {values.pages.length > 0 ? `${values.pages.length} pages found` : 'Using the existing chapter pages'}
          </p>

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
          {editing ? 'Next: Publish' : 'Next: Upload'}
        </button>
      </div>
    </div>
  )
}
