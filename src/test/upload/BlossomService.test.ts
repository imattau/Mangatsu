import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the blossom-client-sdk Actions module before importing BlossomService
vi.mock('blossom-client-sdk', () => ({
  Actions: {
    uploadBlob: vi.fn(),
  },
}))

import { Actions } from 'blossom-client-sdk'
import { BlossomService } from '@/services/BlossomService'

const mockSigner = {
  signEvent: vi.fn(async (template: object) => ({ ...template, id: 'abc', sig: 'sig', pubkey: 'pk' })),
}

describe('BlossomService.upload', () => {
  let service: BlossomService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new BlossomService()
  })

  it('returns sha256 from BlobDescriptor on success', async () => {
    const mockFile = new File(['data'], 'page.jpg', { type: 'image/jpeg' })
    ;(Actions.uploadBlob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sha256: 'abc123',
      url: 'https://server/blob/abc123',
      size: 4,
      type: 'image/jpeg',
      created: 0,
    })

    const result = await service.upload(mockFile, 'https://blossom.example.com', mockSigner as never)

    expect(result).toEqual({ sha256: 'abc123', url: 'https://server/blob/abc123' })
    expect(Actions.uploadBlob).toHaveBeenCalledWith(
      'https://blossom.example.com',
      mockFile,
      expect.objectContaining({ onAuth: expect.any(Function) }),
    )
  })

  it('calls onAuth to get a signed event when challenged', async () => {
    const mockFile = new File(['x'], 'p.jpg', { type: 'image/jpeg' })
    type OnAuth = (server: string, sha256: string, authType: string, blob: File) => Promise<object>
    ;(Actions.uploadBlob as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_server: string, _blob: File, opts: { onAuth?: OnAuth }) => {
        // simulate calling onAuth
        const authEvent = await opts.onAuth!('https://blossom.example.com', 'deadbeef', 'upload', mockFile)
        expect(authEvent).toHaveProperty('kind', 24242)
        return { sha256: 'deadbeef', url: '', size: 1, type: 'image/jpeg', created: 0 }
      },
    )

    const result = await service.upload(mockFile, 'https://blossom.example.com', mockSigner as never)
    expect(result.sha256).toBe('deadbeef')
    expect(mockSigner.signEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 24242 }),
    )
  })

  it('resolveUrl builds correct URL', () => {
    const service2 = new BlossomService()
    expect(service2.resolveUrl('abc123', 'https://blossom.example.com')).toBe(
      'https://blossom.example.com/blob/abc123',
    )
  })
})
