import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UploadStep } from '../../screens/Upload/UploadStep'
import { webTorrentService } from '../../services/WebTorrentService'

const mockUpload = vi.fn()
const mockSetCachedHash = vi.fn()

vi.mock('../../services/BlossomService', () => ({
  blossomService: {
    upload: (...args: unknown[]) => mockUpload(...args),
  },
}))

vi.mock('../../screens/Upload/webp', () => ({
  convertImageFileToWebp: async (file: File) => file,
}))

vi.mock('../../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      accountManager: {
        active: {
          signer: {},
        },
      },
    },
  }),
}))

vi.mock('../../stores/blossomStore', () => ({
  DEFAULT_BLOSSOM_SERVERS: ['https://default.example'],
  useBlossomStore: (sel: (s: {
    servers: { url: string }[]
    setCachedHash: (hash: string, url: string) => void
  }) => unknown) =>
    sel({
      servers: [{ url: 'https://a.example' }, { url: 'https://b.example' }],
      setCachedHash: mockSetCachedHash,
    }),
}))

describe('UploadStep', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUpload.mockReset()
    mockSetCachedHash.mockReset()
  })

  it('allows publish when each asset has at least one successful blossom server', async () => {
    const onDone = vi.fn()
    const file = new File(['page'], 'page.webp', { type: 'image/webp' })
    const seedFilesSpy = vi.spyOn(webTorrentService, 'seedFiles').mockResolvedValue({
      magnetURI: 'magnet:?xt=urn:btih:test',
      infoHash: 'info',
    })

    mockUpload.mockImplementation(async (_file: File, serverUrl: string) => {
      if (serverUrl === 'https://a.example') {
        return { sha256: 'hash-1', url: `${serverUrl}/hash-1` }
      }
      throw new Error('upload failed')
    })

    render(
      <UploadStep
        pages={[file]}
        coverFile={null}
        coverMode="file"
        onDone={onDone}
        onBack={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(
        expect.objectContaining({
          pageUploads: [
            expect.objectContaining({
              hash: 'hash-1',
              servers: ['https://a.example'],
              missingServers: ['https://b.example', 'https://default.example'],
              torrentURI: 'magnet:?xt=urn:btih:test',
            }),
          ],
          magnetURI: 'magnet:?xt=urn:btih:test',
        }),
      )
    })

    expect(seedFilesSpy).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'hash-1' })],
      'hash-1',
      ['https://a.example/'],
    )
  })
})
