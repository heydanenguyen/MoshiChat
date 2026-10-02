import { describe, expect, it } from 'vitest'
import { isPictureStickerId, packOf, packStickerIds, pictureSticker, pictureUrl } from '../src/shared/picture-packs'
import { PALS_STICKERS } from '../src/shared/pals-stickers'
import { CAST, PAL_FACES } from '../src/shared/pals-art'

describe('picture packs', () => {
  it('lets through only stickers listed in a known pack', () => {
    expect(isPictureStickerId('mito:chao')).toBe(true)
    expect(isPictureStickerId('pals:khoc')).toBe(true)
    expect(isPictureStickerId('pals:nope')).toBe(false)
    expect(isPictureStickerId('other:chao')).toBe(false)
    expect(isPictureStickerId('pals:../../secret')).toBe(false)
    expect(isPictureStickerId('pals')).toBe(false)
    expect(isPictureStickerId(42)).toBe(false)
  })

  it('serves each sticker from its own pack folder', () => {
    expect(packOf('pals:vui')).toBe('pals')
    expect(pictureUrl('pals:vui', 'still')).toBe('unison-img://sticker/pals/vui.png')
    expect(pictureUrl('mito:chao', 'animated', 3)).toBe('unison-img://sticker/mito/chao.webp?play=3')
    expect(pictureSticker('pals:cuoi').loop).toBe(1600)
  })

  it('has twelve Pals stickers, each a real pal with a real expression and a file-safe id', () => {
    expect(packStickerIds('pals')).toHaveLength(12)
    expect(new Set(PALS_STICKERS.map((s) => s.id)).size).toBe(12)
    for (const s of PALS_STICKERS) {
      expect(s.id).toMatch(/^[a-z]+$/)
      expect(CAST.some((c) => c.id === s.pal)).toBe(true)
      expect(PAL_FACES).toContain(s.face)
      expect(s.loop).toBeGreaterThan(0)
    }
    // every expression appears once
    expect(new Set(PALS_STICKERS.map((s) => s.face)).size).toBe(12)
  })
})
