import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { BlossomImage } from '../components/BlossomImage'
import { webTorrentService } from '../services/WebTorrentService'
import { probeBlossomAssetExists } from '../lib/blossom'

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
})
