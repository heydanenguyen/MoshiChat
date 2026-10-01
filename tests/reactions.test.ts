import { describe, expect, it } from 'vitest'
import { tally, toggleReaction, ZALO_ALL, ZALO_EMOJI, ZALO_QUICK, zaloCode, zaloEmoji } from '../src/shared/reactions'

describe('Zalo reactions', () => {
  it('maps every code to its own emoji and back, quick ones first', () => {
    const emoji = Object.values(ZALO_EMOJI)
    expect(new Set(emoji).size).toBe(emoji.length)
    for (const [code, e] of Object.entries(ZALO_EMOJI)) expect(zaloCode(e)).toBe(code)
    expect(ZALO_ALL.slice(0, 6)).toEqual(ZALO_QUICK)
    expect(new Set(ZALO_ALL).size).toBe(ZALO_ALL.length)
    for (const e of ZALO_QUICK) expect(zaloCode(e)).toBeDefined()
  })

  it('never shows a raw code, and refuses emoji Zalo cannot send', () => {
    expect(zaloEmoji(':>')).toBe('😆')
    expect(zaloEmoji('/-something-new')).toBe('✨')
    expect(zaloCode('🦄')).toBeUndefined()
  })
})

describe('tally', () => {
  it('counts one reaction per person, most used first, marks mine and names the others', () => {
    const names: Record<string, string> = { a: 'Lan', b: 'Tài' }
    const result = tally({ a: '❤️', b: '❤️', me: '😆', c: '❤️' }, 'me', (p) => names[p])
    expect(result).toEqual([
      { emoji: '❤️', count: 3, byMe: false, names: ['Lan', 'Tài'] },
      { emoji: '😆', count: 1, byMe: true }
    ])
  })

  it('agrees with the optimistic toggle when I change my reaction', () => {
    const before = tally({ a: '❤️', me: '❤️' }, 'me')
    expect(toggleReaction(before, '😆')).toEqual([
      { emoji: '❤️', count: 1, byMe: false },
      { emoji: '😆', count: 1, byMe: true }
    ])
  })
})
