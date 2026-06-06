import { render, act } from '@testing-library/react'
import { forwardRef } from 'react'
import type { CSSProperties } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../components/BlossomImage', () => ({
  BlossomImage: forwardRef<
    HTMLImageElement,
    {
      hash: string
      alt: string
      className?: string
      style?: CSSProperties
      loading?: 'eager' | 'lazy'
      server?: string
      servers?: string[]
      torrent?: string
      draggable?: boolean
    }
  >(({ alt, className, style }, ref) => <img ref={ref} alt={alt} className={className} style={style} />),
}))

import { ZoomableReaderSurface } from '../screens/Reader/ZoomableReaderSurface'

describe('ZoomableReaderSurface', () => {
  it('renders children inside the component', () => {
    const { getByAltText } = render(
      <ZoomableReaderSurface>
        <img alt="Page 1" />
      </ZoomableReaderSurface>,
    )
    expect(getByAltText('Page 1')).toBeTruthy()
  })

  it('renders without error with new props', () => {
    const onPageChange = vi.fn()
    const { container } = render(
      <ZoomableReaderSurface initialPage={1} onPageChange={onPageChange}>
        <img alt="Page 1" />
      </ZoomableReaderSurface>,
    )
    expect(container.firstElementChild).toBeTruthy()
  })

  it('continues to render children when resetKey changes', () => {
    const onPageChange = vi.fn()
    const { rerender, getByAltText } = render(
      <ZoomableReaderSurface resetKey="chapter-1" initialPage={1} onPageChange={onPageChange}>
        <img alt="Page 1" />
      </ZoomableReaderSurface>,
    )

    expect(getByAltText('Page 1')).toBeTruthy()

    act(() => {
      rerender(
        <ZoomableReaderSurface resetKey="chapter-2" initialPage={1} onPageChange={onPageChange}>
          <img alt="Page 1" />
        </ZoomableReaderSurface>,
      )
    })

    expect(getByAltText('Page 1')).toBeTruthy()
  })
})
