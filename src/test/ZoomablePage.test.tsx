import { fireEvent, render, waitFor } from '@testing-library/react'
import { forwardRef } from 'react'
import type { CSSProperties } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalSetPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
        value: originalSetPointerCapture,
        configurable: true,
      })
    }
  })

  it('resets zoom on a double tap', async () => {
    const { container } = render(
      <ZoomableReaderSurface>
        <img alt="Page 1" />
      </ZoomableReaderSurface>,
    )
    const wrapper = container.firstElementChild as HTMLElement
    const content = wrapper.firstElementChild as HTMLElement

    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      value: vi.fn(() => ({
        width: 400,
        height: 600,
        top: 0,
        left: 0,
        right: 400,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })),
      configurable: true,
    })
    Object.defineProperty(content, 'scrollWidth', { value: 1200, configurable: true })
    Object.defineProperty(content, 'scrollHeight', { value: 1800, configurable: true })

    fireEvent.pointerDown(wrapper, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    fireEvent.pointerDown(wrapper, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 200 })
    fireEvent.pointerMove(wrapper, { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 260 })

    await waitFor(() => {
      expect(content.style.transform).not.toBe('translate3d(0px, 0px, 0) scale(1)')
    })

    fireEvent.pointerUp(wrapper, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    fireEvent.pointerUp(wrapper, { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 260 })

    fireEvent.pointerDown(wrapper, { pointerId: 3, pointerType: 'touch', clientX: 120, clientY: 120 })
    fireEvent.pointerUp(wrapper, { pointerId: 3, pointerType: 'touch', clientX: 120, clientY: 120 })
    fireEvent.pointerDown(wrapper, { pointerId: 4, pointerType: 'touch', clientX: 122, clientY: 122 })
    fireEvent.pointerUp(wrapper, { pointerId: 4, pointerType: 'touch', clientX: 122, clientY: 122 })

    await waitFor(() => {
      expect(content.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
    })
  })
})
