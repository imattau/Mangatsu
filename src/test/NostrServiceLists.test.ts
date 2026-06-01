import { describe, it, expect, vi } from 'vitest'
import { NostrService } from '../services/NostrService'

describe('NostrService.subscribeToUserLists', () => {
  it('returns a subscription with unsubscribe', () => {
    const svc = new NostrService()
    const sub = svc.subscribeToUserLists('abc123', vi.fn(), vi.fn())
    expect(typeof sub.unsubscribe).toBe('function')
    sub.unsubscribe()
  })
})
