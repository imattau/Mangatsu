import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PublishDraft } from '@/screens/Upload/publishDraft'

export interface PendingPublishDraft extends PublishDraft {
  queuedAt: number
  lastError: string | null
}

interface PublishQueueState {
  draftsByComicDTag: Record<string, PendingPublishDraft>
  queueDraft: (draft: PublishDraft, error?: string | null) => void
  removeDraft: (comicDTag: string) => void
  clearDrafts: () => void
}

export const usePublishQueueStore = create<PublishQueueState>()(
  persist(
    (set) => ({
      draftsByComicDTag: {},
      queueDraft: (draft, error = null) =>
        set((state) => ({
          draftsByComicDTag: {
            ...state.draftsByComicDTag,
            [draft.comicDTag]: {
              ...draft,
              queuedAt: state.draftsByComicDTag[draft.comicDTag]?.queuedAt ?? Date.now(),
              lastError: error,
            },
          },
        })),
      removeDraft: (comicDTag) =>
        set((state) => {
          const draftsByComicDTag = { ...state.draftsByComicDTag }
          delete draftsByComicDTag[comicDTag]
          return { draftsByComicDTag }
        }),
      clearDrafts: () => set({ draftsByComicDTag: {} }),
    }),
    { name: 'publish-queue' },
  ),
)

export function selectPendingPublishDraft(comicDTag: string) {
  return (state: PublishQueueState) => state.draftsByComicDTag[comicDTag] ?? null
}

export function selectPendingPublishCount(state: PublishQueueState) {
  return Object.keys(state.draftsByComicDTag).length
}
