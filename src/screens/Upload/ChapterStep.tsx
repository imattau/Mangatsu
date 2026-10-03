import { useState, useCallback, useId } from 'react'
import JSZip from 'jszip'
import { convertPdfFileToWebpPages } from './pdf'
import { readImageDimensions } from './webp'
import { MAX_CHAPTER_PAGES, MAX_CHAPTER_SOURCE_BYTES } from './limits'
import type { PageDimensions } from '@/types'
import { FileUp } from 'lucide-react'
import { FilePicker } from './FilePicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface ChapterFormValues {
  chapterTitle: string
  chapterNumber: number
  pages: File[]
  pageDimensions: PageDimensions[]
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
  const id = useId()
  const previousPreviewUrl = values.firstPageObjectUrl

  /** Replace the chapter, releasing the previous first-page preview URL. */
  const commitChapter = useCallback(
    (next: ChapterFormValues) => {
      if (previousPreviewUrl && previousPreviewUrl !== next.firstPageObjectUrl) {
        URL.revokeObjectURL(previousPreviewUrl)
      }
      onChange(next)
    },
    [onChange, previousPreviewUrl],
  )

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

        const parsedPages = await Promise.all(
          imageEntries.map(async (entry) => {
            const blob = await entry.async('blob')
            const ext = entry.name.match(/\.\w+$/)?.[0] ?? '.jpg'
            const mimeMap: Record<string, string> = {
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.png': 'image/png',
              '.webp': 'image/webp',
            }
            return {
              file: new File([blob], entry.name, { type: mimeMap[ext] ?? 'image/jpeg' }),
              dimensions: await readImageDimensions(blob),
            }
          }),
        )
        const pages: File[] = parsedPages.map((page) => page.file)
        const pageDimensions: PageDimensions[] = parsedPages.map((page) => page.dimensions)

        const firstPageObjectUrl = URL.createObjectURL(pages[0])

        commitChapter({ chapterTitle, chapterNumber, pages, pageDimensions, firstPageObjectUrl })
      } catch (err) {
        setParseError(`Failed to parse CBZ: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setParsing(false)
      }
    },
    [commitChapter],
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
        const { pages, pageDimensions, firstPageObjectUrl } = await convertPdfFileToWebpPages(file)

        if (pages.length > MAX_CHAPTER_PAGES) {
          setParseError(
            `Chapter has ${pages.length} pages. Maximum allowed is ${MAX_CHAPTER_PAGES} pages.`,
          )
          return
        }

        commitChapter({
          chapterTitle: fallback.title,
          chapterNumber: fallback.number,
          pages,
          pageDimensions,
          firstPageObjectUrl,
        })
      } catch (err) {
        setParseError(`Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setParsing(false)
      }
    },
    [commitChapter],
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

  const canProceed = editing ? values.chapterTitle.trim().length > 0 : values.pages.length > 0

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (canProceed) onNext()
      }}
    >
      <h2 className="text-lg font-semibold">Chapter</h2>

      {!editing && (
        <FilePicker
          accept=".cbz,.pdf,application/pdf"
          label="Choose a .cbz or .pdf chapter file"
          onFile={(file) => void handleFile(file)}
          onDragStateChange={setDragging}
          disabled={parsing}
          className={cn(
            'flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 text-center',
            dragging ? 'border-ring bg-muted' : 'bg-card/50 hover:border-ring',
          )}
        >
          <FileUp aria-hidden="true" className="size-6 text-muted-foreground" />
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {parsing ? 'Parsing chapter file...' : 'Drop a .cbz or .pdf file here, or tap to browse'}
          </p>
        </FilePicker>
      )}

      {editing && (
        <div className="rounded-2xl border bg-card/50 p-4 text-sm text-muted-foreground">
          Existing pages will be reused unless you publish a replacement chapter later.
        </div>
      )}

      {parseError && <p role="alert" className="text-sm text-destructive">{parseError}</p>}

      {(values.pages.length > 0 || editing) && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {values.pages.length > 0 ? `${values.pages.length} pages found` : 'Using the existing chapter pages'}
          </p>

          {values.firstPageObjectUrl && (
            <img
              src={values.firstPageObjectUrl}
              alt="First page preview"
              className="h-24 w-auto rounded-lg object-cover"
            />
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-number`} className="text-xs text-muted-foreground">Chapter Number</Label>
            <Input
              id={`${id}-number`}
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              value={values.chapterNumber}
              onChange={(e) => onChange({ ...values, chapterNumber: parseFloat(e.target.value) || 1 })}
              className="w-24"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-title`} className="text-xs text-muted-foreground">Chapter Title</Label>
            <Input
              id={`${id}-title`}
              type="text"
              value={values.chapterTitle}
              onChange={(e) => onChange({ ...values, chapterTitle: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack} className="h-11 rounded-full px-5">
          Back
        </Button>
        <Button type="submit" size="lg" disabled={!canProceed} className="h-11 flex-1 rounded-full">
          {editing ? 'Next: Publish' : 'Next: Upload'}
        </Button>
      </div>
    </form>
  )
}
