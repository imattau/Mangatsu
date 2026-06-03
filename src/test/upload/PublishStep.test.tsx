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
})
