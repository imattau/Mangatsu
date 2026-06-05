import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { webTorrentService, DEFAULT_TRACKERS } from '../services/WebTorrentService'
import { useSettingsStore } from '../stores/settingsStore'

// Mock webtorrent
const mockAdd = vi.fn()
const mockSeed = vi.fn()
const mockDestroy = vi.fn()

vi.mock('webtorrent', () => {
  return {
    default: class MockWebTorrent {
      add = mockAdd
      seed = mockSeed
      destroy = mockDestroy
    }
  }
})

describe('WebTorrentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webTorrentService.cleanupAll()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes the client lazily', () => {
    const client = webTorrentService.getClient()
    expect(client).toBeDefined()
    expect(client.add).toBeDefined()
  })

  it('respects web settings store configuration', () => {
    // Default enabled
    expect(webTorrentService.isWebTorrentEnabled()).toBe(true)
    expect(webTorrentService.getTrackers()).toEqual(DEFAULT_TRACKERS)

    // Set to disabled
    useSettingsStore.getState().setEnableWebTorrent(false)
    expect(webTorrentService.isWebTorrentEnabled()).toBe(false)

    // Re-enable
    useSettingsStore.getState().setEnableWebTorrent(true)
    expect(webTorrentService.isWebTorrentEnabled()).toBe(true)
  })

  it('seeds files correctly', async () => {
    const file = new File(['dummy content'], 'test.webp', { type: 'image/webp' })
    const expectedMagnet = 'magnet:?xt=urn:btih:dummy'
    const expectedInfoHash = 'dummy'

    mockSeed.mockImplementation((files, options, cb) => {
      // Simulate ready event and callback
      const torrent = {
        magnetURI: expectedMagnet,
        infoHash: expectedInfoHash,
        on: vi.fn().mockReturnThis(),
      }
      queueMicrotask(() => cb(torrent))
      return torrent
    })

    const result = await webTorrentService.seedFiles([file], 'test-chapter')
    expect(mockSeed).toHaveBeenCalledWith(
      [file],
      expect.objectContaining({ name: 'test-chapter' }),
      expect.any(Function)
    )
    expect(result.magnetURI).toBe(expectedMagnet)
    expect(result.infoHash).toBe(expectedInfoHash)
  })
})
