// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { Subject } from 'rxjs'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { NostrService } from '../services/NostrService'
import { deletedProgressChapters, progressDeleteTags, progressFromEvent } from '../lib/progress'

const ME = 'me'.padEnd(64, '0')
const OTHER = 'other'.padEnd(64, '0')

function event(kind: number, tags: string[][], createdAt: number, pubkey = ME): NostrEvent {
  return { id: `${kind}-${createdAt}-${tags.length}`, pubkey, kind, created_at: createdAt, tags, content: '', sig: '' }
}
const progress = (dTag: string, page: string, createdAt: number, pubkey = ME) =>
  event(30301, [['d', dTag], ['page', page]], createdAt, pubkey)
const deletion = (dTags: string[], createdAt: number, pubkey = ME) =>
  event(5, progressDeleteTags(pubkey, dTags), createdAt, pubkey)

function setup() {
  const service = new NostrService()
  const relay$ = new Subject<NostrEvent>()
  const subscription = vi.fn(() => relay$)
  service.relayPool.subscription = subscription as never
  vi.spyOn(service.eventStore, 'add').mockImplementation((e) => e)
  const onProgress = vi.fn()
  const onDeleted = vi.fn()
  service.subscribeToReadingProgress(ME, { onProgress, onDeleted })
  return { relay$, subscription, onProgress, onDeleted }
}

describe('progress helpers', () => {
  it('parses progress events and rejects malformed pages', () => {
    expect(progressFromEvent(progress('c/chapter-1', '4', 100))).toEqual({
      id: 'c/chapter-1',
      chapterDTag: 'c/chapter-1',
      page: 4,
      updatedAt: 100_000,
    })
    expect(progressFromEvent(progress('c/chapter-1', '0', 100))).toBeNull()
    expect(progressFromEvent(progress('c/chapter-1', 'two', 100))).toBeNull()
  })

  it('builds deletion tags once per chapter, with a k tag', () => {
    expect(progressDeleteTags(ME, ['c/chapter-1', 'c/chapter-2', 'c/chapter-1'])).toEqual([
      ['a', `30301:${ME}:c/chapter-1`],
      ['a', `30301:${ME}:c/chapter-2`],
      ['k', '30301'],
    ])
    expect(progressDeleteTags(ME, [])).toEqual([])
  })

  it("only reads the user's own progress deletions", () => {
    const mixed = event(5, [['a', `30301:${ME}:c/chapter-1`], ['a', `30041:${ME}:c/chapter-1`], ['a', `30301:${OTHER}:x`]], 100)
    expect(deletedProgressChapters(mixed, ME)).toEqual(['c/chapter-1'])
    expect(deletedProgressChapters(deletion(['c/chapter-1'], 100, OTHER), ME)).toEqual([])
  })
})

describe('NostrService.subscribeToReadingProgress', () => {
  it('asks for progress and progress deletions by the user', () => {
    const { subscription } = setup()
    expect(subscription).toHaveBeenCalledWith(
      expect.any(Array),
      [
        { kinds: [30301], authors: [ME] },
        { kinds: [5], authors: [ME], '#k': ['30301'] },
      ],
      expect.any(Object),
    )
  })

  it('reports deletions and drops progress saved before them, in either order', () => {
    const { relay$, onProgress, onDeleted } = setup()

    relay$.next(progress('c/chapter-1', '4', 100)) // arrives before its deletion
    relay$.next(deletion(['c/chapter-1', 'c/chapter-2'], 200))
    relay$.next(progress('c/chapter-2', '7', 150)) // arrives after its deletion: dropped
    relay$.next(progress('c/chapter-2', '2', 300)) // read again after deleting: kept

    expect(onDeleted).toHaveBeenCalledWith('c/chapter-1', 200_000)
    expect(onDeleted).toHaveBeenCalledWith('c/chapter-2', 200_000)
    expect(onProgress.mock.calls.map(([p]) => [p.chapterDTag, p.page])).toEqual([
      ['c/chapter-1', 4],
      ['c/chapter-2', 2],
    ])
  })
})
