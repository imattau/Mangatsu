import { describe, it, expect } from 'vitest'
import { NostrService } from '../services/NostrService'

describe('NostrService.subscribeToChapters', () => {
  it('returns a subscription object with unsubscribe', () => {
    const svc = new NostrService()
    const sub = svc.subscribeToChapters('pubkey', 'one-piece')
    expect(typeof sub.unsubscribe).toBe('function')
    sub.unsubscribe()
  })
})
