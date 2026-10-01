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
        // exactly one loop (25 fps, or 30 for the fast ones), so hover play stops on a loop boundary
        expect(anim.delay?.reduce((a, b) => a + b, 0)).toBe(s.loop)
        expect([Math.round((s.loop / 1000) * 25), Math.round((s.loop / 1000) * 30)]).toContain(anim.pages)
      }
    }
  })

  it('loads its pictures through the app protocol, a fresh animation per play', () => {
    expect(mitoUrl('mito:chao', 'still')).toBe('unison-img://sticker/mito/chao.png')
    expect(mitoUrl('mito:chao', 'animated', 3)).toBe('unison-img://sticker/mito/chao.webp?play=3')
  })
})

describe('Mito on GIPHY', () => {
  it('maps only real Mito stickers to well-formed GIPHY ids, each used once', async () => {
    const { MITO_GIPHY, isMitoId } = await import('../src/shared/mito')
    const ids = Object.values(MITO_GIPHY)
    for (const key of Object.keys(MITO_GIPHY)) expect(isMitoId(key)).toBe(true)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{10,}$/)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
