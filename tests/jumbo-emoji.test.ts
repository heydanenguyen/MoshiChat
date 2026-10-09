import { describe, expect, it } from 'vitest'
import { jumboEmojiCount } from '../src/renderer/src/utils'

describe('jumboEmojiCount', () => {
  it('counts emoji-only messages up to three', () => {
    expect(jumboEmojiCount('🐸')).toBe(1)
    expect(jumboEmojiCount('❤️')).toBe(1)
    expect(jumboEmojiCount('😂😂')).toBe(2)
    expect(jumboEmojiCount(' 🥰 🥰 🥰 ')).toBe(3)
    expect(jumboEmojiCount('👍🏽')).toBe(1)
    expect(jumboEmojiCount('👨‍👩‍👧')).toBe(1)
    expect(jumboEmojiCount('🇻🇳')).toBe(1)
  })

  it('ignores text, digits alone and longer runs', () => {
    expect(jumboEmojiCount('ok 👍')).toBe(0)
    expect(jumboEmojiCount('😂😂😂😂')).toBe(0)
    expect(jumboEmojiCount('123')).toBe(0)
    expect(jumboEmojiCount('#')).toBe(0)
    expect(jumboEmojiCount('')).toBe(0)
  })

  it('treats text-style symbols as text unless they ask for the emoji look (U+FE0F)', () => {
    expect(jumboEmojiCount('©')).toBe(0)
    expect(jumboEmojiCount('®')).toBe(0)
    expect(jumboEmojiCount('™')).toBe(0)
    expect(jumboEmojiCount('↔')).toBe(0)
    expect(jumboEmojiCount('‼')).toBe(0)
    expect(jumboEmojiCount('© ®')).toBe(0)
    expect(jumboEmojiCount('©\uFE0F')).toBe(1)
    expect(jumboEmojiCount('‼️')).toBe(1)
    expect(jumboEmojiCount('⬅️⬅️')).toBe(2)
  })
})
