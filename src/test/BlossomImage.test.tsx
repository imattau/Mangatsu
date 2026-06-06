import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { BlossomImage } from '../components/BlossomImage'
import { webTorrentService } from '../services/WebTorrentService'
import { probeBlossomAssetExists } from '../lib/blossom'
import { useBlossomStore } from '../stores/blossomStore'

// Mock dependencies
vi.mock('../services/WebTorrentService', () => {
  return {
    webTorrentService: {
      getFile: vi.fn(),
      isWebTorrentEnabled: vi.fn().mockReturnValue(true),
      getResolvedBlobUrl: vi.fn(),
      setResolvedBlobUrl: vi.fn(),
    },
  }
})

vi.mock('../lib/blossom', () => {
  return {
    probeBlossomAssetExists: vi.fn(),
    normalizeBlossomServer: (url: string) => url,
    buildBlossomBlobUrl: (server: string, hash: string) => `${server}/${hash}`,
  }
})

describe('BlossomImage WebTorrent Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBlossomStore.setState({
      servers: [],
      cachedHashes: {},
      cachedDimensions: {},
    })
    // Suppress react-act console logs in testing output if desired
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('attempts to resolve via WebTorrent first when torrent is provided', async () => {
    const mockBlob = new Blob(['image data'], { type: 'image/png' })
    const getFileSpy = vi.mocked(webTorrentService.getFile).mockResolvedValue(mockBlob)

    // Stub URL.createObjectURL
    const createObjectURLMock = vi.fn().mockReturnValue('blob:dummy-url')
    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: vi.fn(),
    })

    await act(async () => {
      render(
        <BlossomImage
          hash="page-hash"
          alt="Page Image"
          torrent="magnet:?xt=urn:btih:dummy"
        />
      )
    })

    expect(getFileSpy).toHaveBeenCalledWith('magnet:?xt=urn:btih:dummy', 'page-hash')
    expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob)
    const img = screen.getByAltText('Page Image')
    expect(img).toHaveAttribute('src', 'blob:dummy-url')
  })

  it('falls back to Blossom server when WebTorrent fails', async () => {
    vi.mocked(webTorrentService.getFile).mockRejectedValue(new Error('Swarm failed'))
    const probeSpy = vi.mocked(probeBlossomAssetExists).mockResolvedValue(true)

    await act(async () => {
      render(
        <BlossomImage
          hash="page-hash"
          alt="Page Image"
          torrent="magnet:?xt=urn:btih:dummy"
          server="https://blossom.example"
        />
      )
    })

    expect(probeSpy).toHaveBeenCalled()
    const img = screen.getByAltText('Page Image')
    expect(img).toHaveAttribute('src', 'https://blossom.example/page-hash')
  })

  it('reserves layout space when intrinsic dimensions are provided', async () => {
    vi.mocked(webTorrentService.getResolvedBlobUrl).mockReturnValue('')
    vi.mocked(probeBlossomAssetExists).mockResolvedValue(true)

    await act(async () => {
      render(
        <BlossomImage
          hash="page-hash"
          alt="Page Image"
          server="https://blossom.example"
          intrinsicWidth={1200}
          intrinsicHeight={1800}
        />
      )
    })

    const img = screen.getByAltText('Page Image')
    expect(img).toHaveAttribute('width', '1200')
    expect(img).toHaveAttribute('height', '1800')
    expect(img).toHaveStyle({ aspectRatio: '1200 / 1800' })
  })

  it('caches legacy image dimensions after load and reuses them later', async () => {
    vi.mocked(webTorrentService.getResolvedBlobUrl).mockReturnValue('')
    vi.mocked(probeBlossomAssetExists).mockResolvedValue(true)

    const { rerender } = render(
      <BlossomImage
        hash="legacy-page"
        alt="Legacy Page"
        server="https://blossom.example"
      />,
    )

    const img = screen.getByAltText('Legacy Page')
    Object.defineProperty(img, 'naturalWidth', { value: 900, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 1500, configurable: true })

    await act(async () => {
      fireEvent.load(img)
    })

    expect(useBlossomStore.getState().cachedDimensions['legacy-page']).toEqual({ width: 900, height: 1500 })

    rerender(
      <BlossomImage
        hash="legacy-page"
        alt="Legacy Page"
        server="https://blossom.example"
      />,
    )

    expect(screen.getByAltText('Legacy Page')).toHaveAttribute('width', '900')
    expect(screen.getByAltText('Legacy Page')).toHaveAttribute('height', '1500')
  })
})
