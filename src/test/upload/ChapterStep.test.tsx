import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChapterStep } from '@/screens/Upload/ChapterStep'
import { MAX_CHAPTER_SOURCE_BYTES } from '@/screens/Upload/limits'

const mockConvertPdfFileToWebpPages = vi.fn()

vi.mock('@/screens/Upload/pdf', () => ({
  convertPdfFileToWebpPages: (...args: unknown[]) => mockConvertPdfFileToWebpPages(...args),
}))

describe('ChapterStep PDF import', () => {
  beforeEach(() => {
    mockConvertPdfFileToWebpPages.mockReset()
  })

  function renderChapterStep() {
    const onChange = vi.fn()
    const result = render(
      <ChapterStep
        values={{
          chapterTitle: '',
          chapterNumber: 1,
          pages: [],
          pageDimensions: [],
          firstPageObjectUrl: null,
        }}
        onChange={onChange}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    return { onChange, container: result.container }
  }

  it('accepts pdf files and hydrates the chapter from the pdf helper', async () => {
    const user = userEvent.setup()
    const { onChange, container } = renderChapterStep()
    const input = container.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    const file = new File(['pdf-bytes'], 'Chapter 03 - The Beginning.pdf', {
      type: 'application/pdf',
    })
    mockConvertPdfFileToWebpPages.mockResolvedValueOnce({
      pages: [
        new File(['webp-1'], 'Chapter 03 - The Beginning-page-001.webp', { type: 'image/webp' }),
        new File(['webp-2'], 'Chapter 03 - The Beginning-page-002.webp', { type: 'image/webp' }),
      ],
      pageDimensions: [
        { width: 800, height: 1200 },
        { width: 800, height: 1200 },
      ],
      firstPageObjectUrl: 'blob:first-page',
    })

    await user.upload(input as HTMLInputElement, file)

    await waitFor(() => {
      expect(mockConvertPdfFileToWebpPages).toHaveBeenCalledWith(file)
      expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            chapterTitle: 'The Beginning',
            chapterNumber: 3,
            pages: expect.arrayContaining([
              expect.objectContaining({ name: 'Chapter 03 - The Beginning-page-001.webp' }),
            ]),
            pageDimensions: [
              { width: 800, height: 1200 },
              { width: 800, height: 1200 },
            ],
            firstPageObjectUrl: 'blob:first-page',
          }),
      )
    })
  })

  it('rejects oversized pdf files before conversion', async () => {
    const user = userEvent.setup()
    const { container } = renderChapterStep()
    const input = container.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    const file = new File(['pdf-bytes'], 'volume.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: MAX_CHAPTER_SOURCE_BYTES + 1 })

    await user.upload(input as HTMLInputElement, file)

    expect(await screen.findByText(/file is too large/i)).toBeInTheDocument()
    expect(mockConvertPdfFileToWebpPages).not.toHaveBeenCalled()
  })
})
