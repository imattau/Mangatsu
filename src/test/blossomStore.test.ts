import { beforeEach, describe, expect, it } from 'vitest'
import { useBlossomStore } from '../stores/blossomStore'

describe('blossomStore persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    useBlossomStore.setState({
      servers: [],
      cachedHashes: {},
      cachedDimensions: {},
    })
  })

  it('persists servers and cached dimensions but not cached blob URLs', () => {
    useBlossomStore.getState().setServers([{ url: 'https://blossom.example' }])
    useBlossomStore.getState().setCachedHash('hash1', 'blob:cached-url')
    useBlossomStore.getState().setCachedDimensions('hash1', { width: 1200, height: 1800 })

    const stored = JSON.parse(localStorage.getItem('blossom') ?? '{}')

    expect(stored.state.servers).toEqual([{ url: 'https://blossom.example' }])
    expect(stored.state.cachedHashes).toBeUndefined()
    expect(stored.state.cachedDimensions).toEqual({ hash1: { width: 1200, height: 1800 } })
  })

  it('drops stale cached blob URLs on hydrate', () => {
    localStorage.setItem(
      'blossom',
      JSON.stringify({
        state: {
          servers: [{ url: 'https://blossom.example' }],
          cachedHashes: { hash1: 'blob:stale-url' },
          cachedDimensions: { hash1: { width: 1200, height: 1800 } },
        },
        version: 0,
      }),
    )

    useBlossomStore.persist.rehydrate()

    expect(useBlossomStore.getState().servers).toEqual([{ url: 'https://blossom.example' }])
    expect(useBlossomStore.getState().cachedHashes).toEqual({})
    expect(useBlossomStore.getState().cachedDimensions).toEqual({ hash1: { width: 1200, height: 1800 } })
  })
})
