import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CHAPTER_PAGES, MAX_CHAPTER_SOURCE_BYTES } from '@/screens/Upload/limits'

const mocks = vi.hoisted(() => {
  const mockGetDocument = vi.fn()
  const mockWorkerOptions = { workerSrc: '' }
  return { mockGetDocument, mockWorkerOptions }
})

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: mocks.mockWorkerOptions,
  getDocument: mocks.mockGetDocument,
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'worker-url',
}))

describe('convertPdfFileToWebpPages', () => {
  beforeEach(() => {
    mocks.mockGetDocument.mockReset()
    mocks.mockWorkerOptions.workerSrc = ''

    class FakeOffscreenCanvas {
      width: number
      height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
      getContext = vi.fn(() => ({
        fillStyle: '',
        fillRect: vi.fn(),
      }))
      convertToBlob = vi.fn(async () => new Blob(['webp-bytes'], { type: 'image/webp' }))
    }

    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:first-page')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders PDF pages into webp files', async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve() }))
    const cleanup = vi.fn()
    const getPage = vi.fn(async (_pageNumber: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 800 * scale, height: 1200 * scale }),
      render,
      cleanup,
    }))
    mocks.mockGetDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    })

    const { convertPdfFileToWebpPages } = await import('@/screens/Upload/pdf')
    const file = new File(['pdf-bytes'], 'Chapter 03 - The Beginning.pdf', {
      type: 'application/pdf',
    })

    const result = await convertPdfFileToWebpPages(file)

    expect(mocks.mockGetDocument).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.any(Uint8Array) }),
    )
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(render).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]).toHaveProperty('name', 'Chapter 03 - The Beginning-page-001.webp')
    expect(result.pages[0]).toHaveProperty('type', 'image/webp')
    expect(result.pageDimensions).toEqual([
      { width: 800, height: 1200 },
      { width: 800, height: 1200 },
    ])
    expect(result.firstPageObjectUrl).toBe('blob:first-page')
  })

  it('rejects oversized PDFs before rendering', async () => {
    const { convertPdfFileToWebpPages } = await import('@/screens/Upload/pdf')
    const file = new File(['pdf-bytes'], 'chapter.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: MAX_CHAPTER_SOURCE_BYTES + 1 })

    await expect(convertPdfFileToWebpPages(file)).rejects.toThrow(/too large/i)
    expect(mocks.mockGetDocument).not.toHaveBeenCalled()
  })

  it('rejects PDFs that exceed the page limit before rendering pages', async () => {
    const getPage = vi.fn()
    mocks.mockGetDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: MAX_CHAPTER_PAGES + 1, getPage }),
    })

    const { convertPdfFileToWebpPages } = await import('@/screens/Upload/pdf')
    const file = new File(['pdf-bytes'], 'chapter.pdf', { type: 'application/pdf' })

    await expect(convertPdfFileToWebpPages(file)).rejects.toThrow(/maximum allowed/i)
    expect(getPage).not.toHaveBeenCalled()
  })
})
