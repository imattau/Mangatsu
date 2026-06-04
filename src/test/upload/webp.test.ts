import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { convertImageFileToWebp } from '@/screens/Upload/webp'

describe('convertImageFileToWebp', () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap
  const originalCreateElement = document.createElement.bind(document)

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.createImageBitmap = originalCreateImageBitmap
  })

  it('converts non-webp files to webp files', async () => {
    const close = vi.fn()
    globalThis.createImageBitmap = vi.fn(async () => ({
      width: 320,
      height: 200,
      close,
    })) as never

    const drawImage = vi.fn()
    const toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(['webp-bytes'], { type: 'image/webp' })))
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob,
    } as unknown as HTMLCanvasElement

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return canvas as never
      }
      return originalCreateElement(tagName)
    })

    const result = await convertImageFileToWebp(
      new File(['image-bytes'], 'page.jpg', { type: 'image/jpeg' }),
    )

    expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1)
    expect(drawImage).toHaveBeenCalled()
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9)
    expect(close).toHaveBeenCalled()
    expect(result).toHaveProperty('name', 'page.webp')
    expect(result).toHaveProperty('type', 'image/webp')
  })

  it('downscales large images to a 1600px long edge', async () => {
    const close = vi.fn()
    globalThis.createImageBitmap = vi.fn(async () => ({
      width: 3200,
      height: 2400,
      close,
    })) as never

    const drawImage = vi.fn()
    const toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(['webp-bytes'], { type: 'image/webp' })))
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob,
    } as unknown as HTMLCanvasElement

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return canvas as never
      }
      return originalCreateElement(tagName)
    })

    await convertImageFileToWebp(
      new File(['image-bytes'], 'page.jpg', { type: 'image/jpeg' }),
    )

    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(1200)
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200)
    expect(close).toHaveBeenCalled()
  })

  it('returns webp files unchanged', async () => {
    const file = new File(['webp'], 'page.webp', { type: 'image/webp' })
    const result = await convertImageFileToWebp(file)
    expect(result).toBe(file)
  })
})
