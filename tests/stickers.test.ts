import { describe, expect, it } from 'vitest'
import { STICKER_EXPRESSIONS, isStickerId, stickerIds, stickerSvg } from '../src/shared/stickers'
import { LOGO_ORDER, LOGOS } from '../src/shared/logos'

describe('sticker pack', () => {
  it('has every expression for every logo character', () => {
    const ids = stickerIds()
    expect(ids).toHaveLength(LOGO_ORDER.length * STICKER_EXPRESSIONS.length)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('accepts only known ids (no paths)', () => {
    expect(isStickerId('sporty-party')).toBe(true)
    expect(isStickerId('buddies-love')).toBe(true)
    expect(isStickerId('../../etc-passwd')).toBe(false)
    expect(isStickerId('sporty-party-x')).toBe(false)
    expect(isStickerId('unknown-love')).toBe(false)
    expect(isStickerId('sporty')).toBe(false)
  })

  it('draws the character in its own colour with the white sticker outline', () => {
    for (const character of LOGO_ORDER) {
      const svg = stickerSvg(`${character}-haha`)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg).toContain(LOGOS[character].color)
      expect(svg).toContain('unison-sticker-outline')
    }
  })
})
