import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePublishQueueStore } from '@/stores/publishQueueStore'
import type { NostrService } from '@/services/NostrService'
import { buildPublishDraft, publishDraft } from '@/screens/Upload/publishDraft'

const mockSigner = {
  signEvent: vi.fn(async (template: object) => ({ ...template, id: 'event-id', sig: 'sig', pubkey: 'pubkey' })),
}

const mockService = {
  accountManager: { active: { signer: mockSigner } },
  publishEvent: vi.fn(async () => undefined),
} as unknown as NostrService

describe('publishDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePublishQueueStore.getState().clearDrafts()
  })

  it('builds a reusable draft with signed comic and chapter events', async () => {
    const draft = await buildPublishDraft(mockService, {
      isNewComic: true,
      metadata: {
        title: 'Test Comic',
        authorName: 'Author',
        authorPubkey: 'pub',
        authorDisplayName: '',
        description: 'Desc',
        tags: 'action, drama',
        language: 'en',
        coverFile: null,
        coverMode: 'file',
      },
      chapter: {
        chapterTitle: 'Chapter 1',
        chapterNumber: 1,
        pages: [],
        firstPageObjectUrl: null,
      },
      pageUploads: [
        { hash: 'hash1', servers: ['https://blossom-a.example', 'https://blossom-b.example'] },
        { hash: 'hash2', servers: ['https://blossom-a.example'] },
      ],
      coverUpload: { hash: 'cover-hash', servers: ['https://blossom-a.example', 'https://blossom-cover.example'] },
    })

    expect(draft.comicDTag).toBe('test-comic')
    expect(draft.events).toHaveLength(2)
    expect(mockSigner.signEvent).toHaveBeenCalledTimes(2)
    expect(draft.events[0]).toMatchObject({
      kind: 30040,
      tags: expect.arrayContaining([
        ['cover', 'cover-hash', 'https://blossom-a.example', 'https://blossom-cover.example'],
      ]),
    })
    expect(draft.events[1]).toMatchObject({
      kind: 30041,
      tags: expect.arrayContaining([
        ['page', 'blossom://hash1', 'https://blossom-a.example', 'https://blossom-b.example'],
        ['page', 'blossom://hash2', 'https://blossom-a.example'],
      ]),
    })
  })

  it('publishes the stored signed events in order', async () => {
    const draft = {
      comicDTag: 'test-comic',
      title: 'Test Comic',
      createdAt: 123,
      events: [
        { id: 'comic', kind: 30040 } as never,
        { id: 'chapter', kind: 30041 } as never,
      ],
    }

    await publishDraft(mockService, draft)

    expect(mockService.publishEvent).toHaveBeenCalledTimes(2)
    expect(mockService.publishEvent).toHaveBeenNthCalledWith(1, draft.events[0])
    expect(mockService.publishEvent).toHaveBeenNthCalledWith(2, draft.events[1])
  })

  it('queues and removes pending drafts by comic dTag', () => {
    const draft = {
      comicDTag: 'test-comic',
      title: 'Test Comic',
      createdAt: 123,
      events: [],
    }

    usePublishQueueStore.getState().queueDraft(draft)
    expect(usePublishQueueStore.getState().draftsByComicDTag['test-comic']).toMatchObject({
      comicDTag: 'test-comic',
      title: 'Test Comic',
      queuedAt: expect.any(Number),
      lastError: null,
    })

    usePublishQueueStore.getState().removeDraft('test-comic')
    expect(usePublishQueueStore.getState().draftsByComicDTag['test-comic']).toBeUndefined()
  })
})
