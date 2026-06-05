import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chapter, Comic } from '@/types'

const mockProbeBlossomAssetExists = vi.fn(async (_url: string) => true)

vi.mock('@/lib/blossom', async () => {
  const actual = await vi.importActual<typeof import('@/lib/blossom')>('@/lib/blossom')
  return {
    ...actual,
    probeBlossomAssetExists: (url: string) => mockProbeBlossomAssetExists(url),
  }
})

describe('offline comic caching', () => {
  beforeEach(() => {
    mockProbeBlossomAssetExists.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds one offline target per asset instead of duplicating every blossom server', async () => {
    const { comicOfflineTargets } = await import('@/lib/offline')

    const comic: Comic = {
      id: 'comic-1',
      pubkey: 'pubkey',
      dTag: 'comic',
      title: 'Comic',
      author: '',
      authorPubkey: '',
      description: '',
      coverHash: 'cover-hash',
      blossomServer: 'https://blossom.primary',
      coverServer: 'https://blossom.primary',
      coverServers: ['https://blossom.primary', 'https://blossom.backup'],
      tags: [],
      eventId: 'event-1',
    }
    const chapters: Chapter[] = [
      {
        id: 'chapter-1',
        pubkey: 'pubkey',
        dTag: 'comic/chapter-1',
        parentDTag: 'comic',
        title: 'Chapter 1',
        pageHashes: ['page-hash'],
        blossomServer: 'https://blossom.primary',
        pageServers: ['https://blossom.primary', 'https://blossom.backup'],
        pageServerLists: [['https://blossom.primary', 'https://blossom.backup']],
        publishedAt: 123,
        eventId: 'chapter-1',
      },
    ]

    const targets = comicOfflineTargets(comic, chapters)
    expect(targets).toHaveLength(2)
    expect(targets[0]).toMatchObject({
      key: 'Cover::cover-hash',
      candidates: ['https://blossom.primary/cover-hash', 'https://blossom.backup/cover-hash'],
    })
    expect(targets[1]).toMatchObject({
      key: 'Chapter 1 page 1::page-hash',
      candidates: ['https://blossom.primary/page-hash', 'https://blossom.backup/page-hash'],
    })
  })

  it('caches the first reachable url for each target', async () => {
    const put = vi.fn(async () => undefined)
    const cache = {
      match: vi.fn(async () => null),
      put,
      delete: vi.fn(async () => true),
    }

    vi.stubGlobal('caches', {
      open: vi.fn(async () => cache),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        clone: () => ({ url }) as never,
      } as unknown as Response)),
    )
    mockProbeBlossomAssetExists.mockImplementation(((url: string) =>
      Promise.resolve(url.includes('backup'))) as never)

    const { cacheTargetsForOffline } = await import('@/lib/offline')

    await cacheTargetsForOffline([
      {
        key: 'Cover::cover-hash',
        label: 'Cover',
        candidates: ['https://blossom.primary/cover-hash', 'https://blossom.backup/cover-hash'],
      },
      {
        key: 'Chapter 1 page 1::page-hash',
        label: 'Chapter 1 page 1',
        candidates: ['https://blossom.primary/page-hash', 'https://blossom.backup/page-hash'],
      },
    ])

    expect(put).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenNthCalledWith(1, 'https://blossom.backup/cover-hash', expect.anything())
    expect(put).toHaveBeenNthCalledWith(2, 'https://blossom.backup/page-hash', expect.anything())
  })
})
