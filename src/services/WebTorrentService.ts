import { useSettingsStore } from '@/stores/settingsStore'

type WebTorrentInstance = import('webtorrent').Instance
type WebTorrentTorrent = import('webtorrent').Torrent

export const DEFAULT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.files.fm:7073/announce',
]

export class WebTorrentService {
  private client: WebTorrentInstance | null = null
  private clientPromise: Promise<WebTorrentInstance> | null = null
  private torrents = new Map<string, WebTorrentTorrent>()
  private pendingTorrents = new Map<string, Promise<WebTorrentTorrent>>()
  private objectUrls = new Set<string>()
  private activeQueue: string[] = []
  private readonly MAX_ACTIVE_TORRENTS = 50

  private createMockTorrent(): WebTorrentTorrent {
    const torrent = {
      files: [],
      on: () => torrent,
      once: (_event: string, handler: () => void) => {
        queueMicrotask(handler)
        return torrent
      },
      destroy: () => {},
      magnetURI: 'magnet:?xt=urn:btih:mock',
      infoHash: 'mock',
      numPeers: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
    }

    return torrent as unknown as WebTorrentTorrent
  }

  private createMockClient(): WebTorrentInstance {
    const client = {
      add: (_torrentId: string, _opts: unknown, cb?: (torrent: WebTorrentTorrent) => void) => {
        const torrent = this.createMockTorrent()
        if (cb) queueMicrotask(() => cb(torrent))
        return torrent
      },
      seed: (_files: File[], _opts: unknown, cb?: (torrent: WebTorrentTorrent) => void) => {
        const torrent = this.createMockTorrent()
        if (cb) queueMicrotask(() => cb(torrent))
        return torrent
      },
      destroy: () => {},
      torrents: [],
      downloadSpeed: 0,
      uploadSpeed: 0,
    }

    return client as unknown as WebTorrentInstance
  }

  async getClient(): Promise<WebTorrentInstance> {
    if (!this.client) {
      if (!this.clientPromise) {
        const isTestMode = import.meta.env.MODE === 'test'

        if (typeof window === 'undefined' || isTestMode) {
          this.client = this.createMockClient()
          this.clientPromise = Promise.resolve(this.client)
        } else {
          this.clientPromise = import('webtorrent')
            .then((module) => {
              try {
                const WebTorrent = module.default as unknown as new () => WebTorrentInstance
                this.client = new WebTorrent()
                return this.client
              } catch (err) {
                console.warn('Failed to initialize WebTorrent client:', err)
                this.client = this.createMockClient()
                return this.client
              }
            })
            .catch((err) => {
              this.clientPromise = null
              throw err
            })
        }
      }

      this.client = await this.clientPromise
    }

    return this.client
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

  private registerTorrent(torrentId: string, torrent: WebTorrentTorrent) {
    this.torrents.set(torrentId, torrent)
    
    // Remove if already in queue to move it to the end
    this.activeQueue = this.activeQueue.filter((id) => id !== torrentId)
    this.activeQueue.push(torrentId)

    // Enforce LRU limit
    if (this.activeQueue.length > this.MAX_ACTIVE_TORRENTS) {
      const oldestId = this.activeQueue.shift()
      if (oldestId) {
        this.cleanupTorrent(oldestId)
      }
    }
  }

  async getFile(magnetOrInfoHash: string, fileHash: string): Promise<Blob> {
    if (!this.isWebTorrentEnabled()) {
      throw new Error('WebTorrent is disabled in settings')
    }

    const client = await this.getClient()
    
    // Normalize magnet or infohash as key
    const torrentId = magnetOrInfoHash

    let torrent = this.torrents.get(torrentId)
    if (!torrent) {
      let promise = this.pendingTorrents.get(torrentId)
      if (!promise) {
        promise = new Promise<WebTorrentTorrent>((resolve, reject) => {
          const t = client.add(torrentId, { announce: this.getTrackers() }, (torrentInstance) => {
            this.pendingTorrents.delete(torrentId)
            this.registerTorrent(torrentId, torrentInstance as WebTorrentTorrent)
            resolve(torrentInstance as WebTorrentTorrent)
          })
          
          t.on('error', (err) => {
            this.pendingTorrents.delete(torrentId)
            reject(err)
          })
        })
        this.pendingTorrents.set(torrentId, promise)
      }
      torrent = await promise
    } else {
      // Refresh its position in LRU queue
      this.activeQueue = this.activeQueue.filter((id) => id !== torrentId)
      this.activeQueue.push(torrentId)
    }

    if (!torrent) {
      throw new Error('Failed to initialize WebTorrent torrent')
    }

    // Wait for metadata to resolve if not loaded yet
    if (!(torrent as any).metadata) {
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
      (file as any).blob((err: Error | undefined, blob: Blob | undefined) => {
        if (err) reject(err)
        else if (blob) resolve(blob)
        else reject(new Error('No blob returned'))
      })
    })
  }

  async seedFiles(
    files: File[],
    name: string,
    urlList: string[] = [],
  ): Promise<{ magnetURI: string; infoHash: string }> {
    const client = await this.getClient()
    const trackers = this.getTrackers()

    return new Promise((resolve, reject) => {
      client.seed(
        files,
        {
          name,
          announceList: trackers.map((t) => [t]),
          urlList,
        } as any,
        (torrent) => {
          this.registerTorrent(torrent.magnetURI, torrent)
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

  private resolvedBlobUrls = new Map<string, string>()

  getResolvedBlobUrl(hash: string): string | undefined {
    return this.resolvedBlobUrls.get(hash)
  }

  setResolvedBlobUrl(hash: string, url: string) {
    this.resolvedBlobUrls.set(hash, url)
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
    this.resolvedBlobUrls.clear()
    this.pendingTorrents.clear()

    if (this.client) {
      this.client.destroy()
      this.client = null
    }
    this.clientPromise = null
    this.torrents.clear()
  }

  getStats() {
    const client = this.client
    if (!client) {
      return {
        activeTorrents: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
      }
    }

    let numPeers = 0
    client.torrents.forEach((t) => {
      numPeers += t.numPeers
    })

    return {
      activeTorrents: client.torrents.length,
      downloadSpeed: client.downloadSpeed,
      uploadSpeed: client.uploadSpeed,
      numPeers,
    }
  }
}

export const webTorrentService = new WebTorrentService()
