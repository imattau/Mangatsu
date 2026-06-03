import { useLibraryStore } from '@/stores/libraryStore'

beforeEach(() => {
  useLibraryStore.setState({ savedATags: [] })
})

describe('libraryStore', () => {
  it('adds an a-tag', () => {
    useLibraryStore.getState().add('30040:abc:slug1')
    expect(useLibraryStore.getState().savedATags).toContain('30040:abc:slug1')
  })

  it('does not duplicate', () => {
    useLibraryStore.getState().add('30040:abc:slug1')
    useLibraryStore.getState().add('30040:abc:slug1')
    expect(useLibraryStore.getState().savedATags.length).toBe(1)
  })

  it('removes an a-tag', () => {
    useLibraryStore.getState().add('30040:abc:slug1')
    useLibraryStore.getState().remove('30040:abc:slug1')
    expect(useLibraryStore.getState().savedATags).not.toContain('30040:abc:slug1')
  })

  it('isIn returns correct boolean', () => {
    useLibraryStore.getState().add('30040:abc:slug1')
    expect(useLibraryStore.getState().isIn('30040:abc:slug1')).toBe(true)
    expect(useLibraryStore.getState().isIn('30040:xyz:other')).toBe(false)
  })

  it('setAll replaces all tags', () => {
    useLibraryStore.getState().add('30040:abc:slug1')
    useLibraryStore.getState().setAll(['30040:def:slug2', '30040:ghi:slug3'])
    expect(useLibraryStore.getState().savedATags).toEqual(['30040:def:slug2', '30040:ghi:slug3'])
  })
})
