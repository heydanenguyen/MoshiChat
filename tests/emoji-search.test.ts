import { describe, expect, it } from 'vitest'
import { searchEmoji } from '../src/renderer/src/emojiKeywords'

const groups = [
  { id: 'smileys', emoji: ['😀', '😂', '😭', '🥰'] },
  { id: 'hearts', emoji: ['❤️', '💔', '🔥'] },
  { id: 'food', emoji: ['🍜', '🧋'] }
]

describe('searchEmoji', () => {
  it('finds an emoji by its English or Vietnamese words', () => {
    expect(searchEmoji('laugh', groups)).toContain('😂')
    expect(searchEmoji('joy', groups)).toContain('😂')
    expect(searchEmoji('cười', groups)).toContain('😂')
    expect(searchEmoji('tim', groups)[0]).toBe('❤️')
    expect(searchEmoji('phở', groups)).toEqual(['🍜'])
  })

  it('ignores case and Vietnamese marks', () => {
    expect(searchEmoji('CUOI', groups)).toContain('😂')
    expect(searchEmoji('Khóc', groups)).toEqual(searchEmoji('khoc', groups))
    expect(searchEmoji('khoc', groups)).toContain('😭')
    expect(searchEmoji('tra sua', groups)).toEqual(['🧋'])
  })

  it('falls back to the group name, and still matches the emoji itself', () => {
    expect(searchEmoji('food', groups)).toEqual(['🍜', '🧋'])
    expect(searchEmoji('đồ ăn', groups)).toEqual(['🍜', '🧋'])
    expect(searchEmoji('🔥', groups)).toEqual(['🔥'])
    expect(searchEmoji('xyzzy', groups)).toEqual([])
  })
})
