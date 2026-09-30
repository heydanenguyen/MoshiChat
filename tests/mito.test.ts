import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import { MITO_STICKERS, isMitoId, mitoUrl } from '../src/shared/mito'
import { isStickerId } from '../src/shared/stickers'

const dir = join(__dirname, '../resources/stickers/mito')

describe('Mito sticker pack', () => {
  it('has twelve stickers, all animated, with unique plain ids', () => {
    expect(MITO_STICKERS).toHaveLength(12)
    expect(MITO_STICKERS.filter((s) => s.loop)).toHaveLength(12)
    expect(new Set(MITO_STICKERS.map((s) => s.id)).size).toBe(12)
    for (const s of MITO_STICKERS) expect(s.id).toMatch(/^[a-z]+$/)
  })

  it('accepts only its own ids (no paths), and never collides with the logo pack', () => {
    expect(isMitoId('mito:chao')).toBe(true)
    expect(isMitoId('mito:nhayday')).toBe(true)
    expect(isMitoId('mito:../../etc/passwd')).toBe(false)
    expect(isMitoId('mito:unknown')).toBe(false)
    expect(isMitoId('chao')).toBe(false)
    expect(isMitoId(undefined)).toBe(false)
    for (const s of MITO_STICKERS) expect(isStickerId(`mito:${s.id}`)).toBe(false)
  })

  it('ships a 384 px transparent still, a copy on white, and the animation', async () => {
    for (const s of MITO_STICKERS) {
      const still = await sharp(join(dir, `${s.id}.png`)).metadata()
      expect([still.width, still.height, still.hasAlpha]).toEqual([384, 384, true])
      const white = await sharp(join(dir, `${s.id}-white.png`)).metadata()
      expect([white.width, white.height, white.hasAlpha]).toEqual([384, 384, false])
      expect(existsSync(join(dir, `${s.id}.webp`))).toBe(!!s.loop)
      if (s.loop) {
        const anim = await sharp(join(dir, `${s.id}.webp`), { animated: true }).metadata()
        expect(anim.width).toBe(384)
        // one loop at 25 fps
        expect(anim.pages).toBe(Math.round((s.loop / 1000) * 25))
      }
    }
  })

  it('loads its pictures through the app protocol, a fresh animation per play', () => {
    expect(mitoUrl('mito:chao', 'still')).toBe('unison-img://sticker/mito/chao.png')
    expect(mitoUrl('mito:chao', 'animated', 3)).toBe('unison-img://sticker/mito/chao.webp?play=3')
  })
})
