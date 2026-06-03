import { describe, it, expect, vi, afterEach } from 'vitest'
import { probeBlossomAssetExists, probeBlossomImage } from '../lib/blossom'

describe('probeBlossomImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('checks http status for blossom blob availability', async () => {
    const fetchMock = vi.fn(async () => {
      return { ok: true, status: 206 } as Response
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(probeBlossomAssetExists('https://blossom.example/ok')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://blossom.example/ok',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        mode: 'cors',
        headers: { Range: 'bytes=0-0' },
      }),
    )
  })

  it('reports successful and missing blossom blobs', async () => {
    class MockImage {
      onload: null | (() => void) = null
      onerror: null | (() => void) = null

      set src(value: string) {
        queueMicrotask(() => {
          if (value.includes('missing')) {
            this.onerror?.()
          } else {
            this.onload?.()
          }
        })
      }
    }

    vi.stubGlobal('Image', MockImage)

    await expect(probeBlossomImage('https://blossom.example/ok')).resolves.toBe(true)
    await expect(probeBlossomImage('https://blossom.example/missing')).resolves.toBe(false)
  })
})
