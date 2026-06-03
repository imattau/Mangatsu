import { encodeLibraryList, decodeLibraryList } from '@/lib/nip51'

describe('encodeLibraryList / decodeLibraryList', () => {
  it('round-trips an a-tag list', () => {
    const tags = ['30040:abc:slug1', '30040:def:slug2']
    expect(decodeLibraryList(encodeLibraryList(tags))).toEqual(tags)
  })

  it('returns [] for malformed JSON', () => {
    expect(decodeLibraryList('not-json')).toEqual([])
  })

  it('returns [] for empty string', () => {
    expect(decodeLibraryList('')).toEqual([])
  })
})
