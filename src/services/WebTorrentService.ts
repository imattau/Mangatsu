import WebTorrent from 'webtorrent'
import { useSettingsStore } from '@/stores/settingsStore'

export const DEFAULT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.files.fm:7073/announce',
]

export class WebTorrentService {
  private client: WebTorrent.Instance | null = null
  private torrents = new Map<string, WebTorrent.Torrent>()
  private objectUrls = new Set<string>()

  getClient(): WebTorrent.Instance {
    if (!this.client) {
      try {
        this.client = new WebTorrent()
      } catch (err) {
        console.warn('Failed to initialize WebTorrent client:', err)
        // Return a mock instance for test/jsdom environments to avoid crashes
        this.client = {
          add: () => ({ on: () => {} }),
          seed: () => ({ on: () => {} }),
          destroy: () => {},
        } as any
      }
    }
    return this.client!
  }

  getTrackers(): string[] {
    try {
      const state = useSettingsStore.getState() as any
      if (state && Array.isArray(state.torrentTrackers) && state.torrentTrackers.length > 0) {
        return state.torrentTrackers
      }
    } catch {
      // settings store might not be loaded yet
    }
    return DEFAULT_TRACKERS
  }

  isWebTorrentEnabled(): boolean {
    try {
      const state = useSettingsStore.getState() as any
      return state?.enableWebTorrent ?? true
    } catch {
      return true
    }
  }

  async getFile(magnetOrInfoHash: string, fileHash: string): Promise<Blob> {
    if (!this.isWebTorrentEnabled()) {
      throw new Error('WebTorrent is disabled in settings')
    }

    const client = this.getClient()
    
    // Normalize magnet or infohash as key
    const torrentId = magnetOrInfoHash

    let torrent = this.torrents.get(torrentId)
    if (!torrent) {
      torrent = await new Promise<WebTorrent.Torrent>((resolve, reject) => {
        const t = client.add(torrentId, { announce: this.getTrackers() }, (torrentInstance) => {
          resolve(torrentInstance)
        })
        t.on('error', (err) => {
          reject(err)
        })
      })
      this.torrents.set(torrentId, torrent)
    }

    // Wait for metadata to resolve if not loaded yet
    if (!torrent.metadata) {
      await new Promise<void>((resolve) => {
        torrent!.once('ready', () => resolve())
      })
    }

    // Find the file whose name contains or matches the hash
    const file = torrent.files.find((f) => 
      f.name.toLowerCase().includes(fileHash.toLowerCase()) || 
      fileHash.toLowerCase().includes(f.name.toLowerCase())
    )

    if (!file) {
      throw new Error(`File with hash ${fileHash} not found in torrent`)
    }

    return new Promise<Blob>((resolve, reject) => {
      file.blob((err, blob) => {
        if (err) reject(err)
        else if (blob) resolve(blob)
        else reject(new Error('No blob returned'))
      })
    })
  }

  async seedFiles(files: File[], name: string): Promise<{ magnetURI: string; infoHash: string }> {
    const client = this.getClient()
    const trackers = this.getTrackers()

    return new Promise((resolve, reject) => {
      client.seed(
        files,
        {
          name,
          announceList: trackers.map((t) => [t]),
        },
        (torrent) => {
          this.torrents.set(torrent.magnetURI, torrent)
          resolve({
            magnetURI: torrent.magnetURI,
            infoHash: torrent.infoHash,
          })
        }
      ).on('error', (err) => {
        reject(err)
      })
    })
  }

  createObjectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob)
    this.objectUrls.add(url)
    return url
  }

  cleanupTorrent(magnetOrInfoHash: string) {
    const torrent = this.torrents.get(magnetOrInfoHash)
    if (torrent) {
      torrent.destroy()
      this.torrents.delete(magnetOrInfoHash)
    }
  }

  cleanupAll() {
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url)
    }
    this.objectUrls.clear()

    if (this.client) {
      this.client.destroy()
      this.client = null
    }
    this.torrents.clear()
  }
}

export const webTorrentService = new WebTorrentService()
