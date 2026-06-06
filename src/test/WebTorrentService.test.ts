import { describe, it, expect, beforeEach } from 'vitest'
import { webTorrentService, DEFAULT_TRACKERS } from '../services/WebTorrentService'
import { useSettingsStore } from '../stores/settingsStore'

describe('WebTorrentService', () => {
  beforeEach(() => {
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

    const result = await webTorrentService.seedFiles([file], 'test-chapter')
    expect(result.magnetURI).toBe('magnet:?xt=urn:btih:mock')
    expect(result.infoHash).toBe('mock')
  })
})
