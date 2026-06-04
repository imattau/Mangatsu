import { canvasToBlob, replaceExtension } from './webp'
import {
  MAX_CHAPTER_PAGES,
  MAX_CHAPTER_SOURCE_BYTES,
  MAX_PDF_RENDER_DIMENSION,
} from './limits'
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFPageProxy,
} from 'pdfjs-dist'

let workerConfigured = false

async function loadPdfJs() {
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default

  if (!workerConfigured) {
    GlobalWorkerOptions.workerSrc = workerUrl
    workerConfigured = true
  }

  return { getDocument }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }

  return Object.assign(document.createElement('canvas'), { width, height })
}

function toPageFileName(fileName: string, pageNumber: number): string {
  const baseName = replaceExtension(fileName, '').replace(/[\s._-]+$/g, '')
  const pageSuffix = String(pageNumber).padStart(3, '0')
  return `${baseName}-page-${pageSuffix}.webp`
}

async function renderPageToWebp(
  page: PDFPageProxy,
  fileName: string,
  pageNumber: number,
): Promise<File> {
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(
    MAX_PDF_RENDER_DIMENSION / baseViewport.width,
    MAX_PDF_RENDER_DIMENSION / baseViewport.height,
    1,
  )
  const viewport = page.getViewport({ scale })
  const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null

  if (!context) {
    throw new Error('Canvas 2D context unavailable for PDF rendering')
  }

  if ('fillStyle' in context) {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, viewport.width, viewport.height)
  }

  await (page.render({ canvasContext: context as never, viewport } as never) as { promise: Promise<void> }).promise
  const blob = await canvasToBlob(canvas, 'image/webp', 0.9)
  return new File([blob], toPageFileName(fileName, pageNumber), { type: 'image/webp' })
}

export async function convertPdfFileToWebpPages(file: File): Promise<{
  pages: File[]
  firstPageObjectUrl: string
}> {
  if (file.size > MAX_CHAPTER_SOURCE_BYTES) {
    throw new Error(
      `PDF is too large. Maximum allowed size is ${Math.round(MAX_CHAPTER_SOURCE_BYTES / (1024 * 1024))} MB.`,
    )
  }

  const pdfjs = await loadPdfJs()
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise

  if (doc.numPages > MAX_CHAPTER_PAGES) {
    throw new Error(
      `PDF has ${doc.numPages} pages. Maximum allowed is ${MAX_CHAPTER_PAGES} pages.`,
    )
  }

  const pages: File[] = []
  let firstPageObjectUrl = ''

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    try {
      const webpPage = await renderPageToWebp(page, file.name, pageNumber)
      if (pageNumber === 1) {
        firstPageObjectUrl = URL.createObjectURL(webpPage)
      }
      pages.push(webpPage)
    } finally {
      page.cleanup()
    }
  }

  if (!firstPageObjectUrl) {
    throw new Error('PDF did not contain any renderable pages')
  }

  return { pages, firstPageObjectUrl }
}
