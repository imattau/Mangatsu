import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublishStep } from '../../screens/Upload/PublishStep'

const mockBuildPublishDraft = vi.fn()
const mockPublishDraft = vi.fn()
const mockPublishLibraryList = vi.fn(async () => undefined)
const mockAddToLibrary = vi.fn()

vi.mock('../../screens/Upload/publishDraft', () => ({
  buildPublishDraft: (...args: unknown[]) => mockBuildPublishDraft(...args),
  publishDraft: (...args: unknown[]) => mockPublishDraft(...args),
}))

vi.mock('../../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      publishLibraryList: mockPublishLibraryList,
    },
  }),
}))

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string | null; secretKey: Uint8Array | null }) => unknown) =>
    sel({ pubkey: 'abc', secretKey: null }),
}))

vi.mock('../../stores/libraryStore', () => ({
  useLibraryStore: (sel: (s: {
    savedATags: string[]
    add: (aTag: string) => void
  }) => unknown) =>
    sel({ savedATags: ['30040:abc:existing-comic'], add: mockAddToLibrary }),
}))

vi.mock('../../stores/publishQueueStore', () => ({
  usePublishQueueStore: (sel: (s: { queueDraft: (draft: unknown, error?: string) => void }) => unknown) =>
    sel({ queueDraft: vi.fn() }),
}))

describe('PublishStep', () => {
  beforeEach(() => {
    mockBuildPublishDraft.mockReset()
    mockPublishDraft.mockReset()
    mockPublishLibraryList.mockClear()
    mockAddToLibrary.mockClear()

    mockBuildPublishDraft.mockResolvedValue({
      comicDTag: 'new-comic',
      title: 'New Comic',
      createdAt: 123,
      events: [],
    })
    mockPublishDraft.mockResolvedValue(undefined)
  })

  it('auto-saves a published comic to the library list', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()

    render(
      <PublishStep
        isNewComic
        metadata={{
          title: 'New Comic',
          authorName: '',
          authorPubkey: '',
          authorDisplayName: '',
        description: '',
        tags: '',
        language: '',
        nsfw: false,
        coverFile: null,
        coverMode: 'file',
      }}
        chapter={{
          chapterTitle: 'Chapter 1',
          chapterNumber: 1,
          pages: [],
          firstPageObjectUrl: null,
        }}
        pageUploads={[]}
        coverUpload={null}
        serverResults={[{ url: 'https://blossom.example', uploaded: 1, total: 1 }]}
        onDone={onDone}
      />,
    )

    await user.click(screen.getByRole('button', { name: /publish/i }))

      await waitFor(() => {
        expect(mockAddToLibrary).toHaveBeenCalledWith('30040:abc:new-comic')
        expect(mockPublishLibraryList).toHaveBeenCalledWith(
          ['30040:abc:existing-comic', '30040:abc:new-comic'],
          expect.objectContaining({ pubkey: 'abc' }),
        )
        expect(onDone).toHaveBeenCalledWith('new-comic')
      })
  })

  it('can publish metadata without altering the library list', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()

    render(
      <PublishStep
        isNewComic={false}
        existingDTag="existing-comic"
        metadata={{
          title: 'Existing Comic',
          authorName: '',
          authorPubkey: '',
          authorDisplayName: '',
        description: '',
        tags: '',
        language: '',
        nsfw: false,
        coverFile: null,
        coverMode: 'file',
      }}
        pageUploads={[]}
        coverUpload={null}
        serverResults={[]}
        syncLibraryList={false}
        onDone={onDone}
      />,
    )

    await user.click(screen.getByRole('button', { name: /publish/i }))

    await waitFor(() => {
      expect(mockAddToLibrary).not.toHaveBeenCalled()
      expect(mockPublishLibraryList).not.toHaveBeenCalled()
      expect(onDone).toHaveBeenCalledWith('new-comic')
    })
  })

  it('shows missing assets by server when an upload is partial', () => {
    render(
      <PublishStep
        isNewComic
        metadata={{
          title: 'New Comic',
          authorName: '',
          authorPubkey: '',
          authorDisplayName: '',
        description: '',
        tags: '',
        language: '',
        nsfw: false,
        coverFile: null,
        coverMode: 'file',
      }}
        chapter={{
          chapterTitle: 'Chapter 1',
          chapterNumber: 1,
          pages: [],
          firstPageObjectUrl: null,
        }}
        pageUploads={[
          {
            hash: 'page-1',
            servers: ['https://a.example'],
            missingServers: ['https://b.example'],
          },
          {
            hash: 'page-2',
            servers: ['https://a.example'],
            missingServers: ['https://b.example'],
          },
        ]}
        coverUpload={{
          hash: 'cover-1',
          servers: ['https://a.example'],
          missingServers: ['https://c.example'],
        }}
        serverResults={[
          { url: 'https://a.example', uploaded: 3, total: 3 },
          { url: 'https://b.example', uploaded: 0, total: 3 },
          { url: 'https://c.example', uploaded: 0, total: 3 },
        ]}
        onDone={vi.fn()}
      />,
    )

    expect(screen.getByText(/missing assets/i)).toBeInTheDocument()
    expect(screen.getAllByText(/b\.example/).length).toBeGreaterThan(0)
    expect(screen.getByText(/missing 2 assets: page 1, page 2/i)).toBeInTheDocument()
    expect(screen.getAllByText(/c\.example/).length).toBeGreaterThan(0)
    expect(screen.getByText(/missing 1 asset: cover/i)).toBeInTheDocument()
  })
})

describe('buildPublishDraft — nsfw flag', () => {
  it('emits content-warning tag when nsfw is true', async () => {
    const { buildPublishDraft } = await vi.importActual<typeof import('../../screens/Upload/publishDraft')>('../../screens/Upload/publishDraft')
    const signer = {
      signEvent: vi.fn(async (template: object) => ({ ...template, id: 'id1', sig: 'sig1' })),
    }
    const service = {
      accountManager: { active: { signer } },
    } as unknown as Parameters<typeof buildPublishDraft>[0]

    const metadata = {
      title: 'Test Comic',
      authorName: '',
      authorPubkey: '',
      authorDisplayName: '',
      description: '',
      tags: '',
      language: '',
      coverFile: null,
      coverMode: 'file' as const,
      nsfw: true,
    }

    const draft = await buildPublishDraft(service, {
      isNewComic: true,
      metadata,
      pageUploads: [],
      coverUpload: null,
    })

    const comicEvent = draft.events.find((e) => e.kind === 30040)
    expect(comicEvent).toBeDefined()
    expect(comicEvent!.tags).toContainEqual(['content-warning', 'NSFW'])
  })

  it('does not emit content-warning tag when nsfw is false', async () => {
    const { buildPublishDraft } = await vi.importActual<typeof import('../../screens/Upload/publishDraft')>('../../screens/Upload/publishDraft')
    const signer = {
      signEvent: vi.fn(async (template: object) => ({ ...template, id: 'id1', sig: 'sig1' })),
    }
    const service = {
      accountManager: { active: { signer } },
    } as unknown as Parameters<typeof buildPublishDraft>[0]

    const metadata = {
      title: 'Test Comic',
      authorName: '',
      authorPubkey: '',
      authorDisplayName: '',
      description: '',
      tags: '',
      language: '',
      coverFile: null,
      coverMode: 'file' as const,
      nsfw: false,
    }

    const draft = await buildPublishDraft(service, {
      isNewComic: true,
      metadata,
      pageUploads: [],
      coverUpload: null,
    })

    const comicEvent = draft.events.find((e) => e.kind === 30040)
    expect(comicEvent).toBeDefined()
    expect(comicEvent!.tags.every((t: string[]) => t[0] !== 'content-warning')).toBe(true)
  })
})
