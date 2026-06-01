import { describe, it, expect } from 'vitest'
import { slugify } from '@/screens/Upload/slugify'

describe('slugify', () => {
  it('lowercases and trims', () => {
    expect(slugify('  Hello World  ')).toBe('hello-world')
  })

  it('replaces spaces and underscores with hyphens', () => {
    expect(slugify('My_Comic Title')).toBe('my-comic-title')
  })

  it('strips non-word characters', () => {
    expect(slugify('One Piece! Vol.1')).toBe('one-piece-vol1')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('A---B')).toBe('a-b')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello')
  })

  it('handles Japanese characters (keeps unicode word chars)', () => {
    expect(slugify('進撃の巨人')).toBe('進撃の巨人')
  })
})
