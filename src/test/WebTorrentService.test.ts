import { describe, it, expect, beforeEach, vi } from 'vitest'
import { webTorrentService, DEFAULT_TRACKERS } from '../services/WebTorrentService'
import { useSettingsStore } from '../stores/settingsStore'

describe('WebTorrentService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    webTorrentService.cleanupAll()
  })

  it('initializes the client lazily', async () => {
    const client = await webTorrentService.getClient()
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
    const onMock = vi.fn().mockReturnThis()
    const seedMock = vi.fn(() => ({ on: onMock }))
    const getClientSpy = vi.spyOn(webTorrentService, 'getClient').mockResolvedValue({
      seed: seedMock,
    } as never)

    const result = await webTorrentService.seedFiles([file], 'test-chapter', [
      'https://blossom-a.example/',
      'https://blossom-b.example/',
    ])

    expect(getClientSpy).toHaveBeenCalled()
    expect(seedMock).toHaveBeenCalledWith(
      [file],
      expect.objectContaining({
        name: 'test-chapter',
        announceList: DEFAULT_TRACKERS.map((tracker) => [tracker]),
        urlList: ['https://blossom-a.example/', 'https://blossom-b.example/'],
      }),
      expect.any(Function),
    )
    expect(result.magnetURI).toBe('magnet:?xt=urn:btih:mock')
    expect(result.infoHash).toBe('mock')
  })
})
