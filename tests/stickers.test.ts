import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { STICKER_EXPRESSIONS, isStickerId, stickerIds, stickerSvg } from '../src/shared/stickers'
import { LOGO_ORDER, LOGOS } from '../src/shared/logos'

const dir = mkdtempSync(join(tmpdir(), 'moshi-stickers-'))
vi.mock('electron', () => ({ app: { getPath: () => dir }, dialog: {} }))

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

describe('custom stickers as outgoing files', () => {
  it('an animated one also carries a still of its first frame on white', async () => {
    const { customStickerFile } = await import('../src/main/stickers')
    const frame = (colour: string): Promise<Buffer> =>
      sharp({ create: { width: 20, height: 10, channels: 4, background: colour } })
        .png()
        .toBuffer()
    const folder = join(dir, 'stickers')
    mkdirSync(folder, { recursive: true })
    await sharp([await frame('#ff000080'), await frame('blue')], { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100] })
      .toFile(join(folder, 'anim01.webp'))
    writeFileSync(join(folder, 'index.json'), JSON.stringify([{ id: 'anim01', name: 'a', file: 'anim01.webp', mime: 'image/webp', animated: true, createdAt: 1 }]))
    const file = await customStickerFile('anim01')
    const opaque = file.alternates?.find((alt) => alt.role === 'opaque')
    expect(opaque).toMatchObject({ mime: 'image/png' })
    const meta = await sharp(opaque!.path).metadata()
    expect([meta.width, meta.height, meta.pages ?? 1, meta.hasAlpha]).toEqual([20, 10, 1, false])
    // Made once, then reused.
    expect((await customStickerFile('anim01')).alternates).toEqual(file.alternates)
  })

  it('logs, not swallows, a still it could not make, and still returns the sticker', async () => {
    const { customStickerFile } = await import('../src/main/stickers')
    const folder = join(dir, 'stickers')
    writeFileSync(join(folder, 'bad01.webp'), 'not a picture')
    writeFileSync(join(folder, 'index.json'), JSON.stringify([{ id: 'bad01', name: 'b', file: 'bad01.webp', mime: 'image/webp', animated: true, createdAt: 1 }]))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const file = await customStickerFile('bad01')
    expect(file.alternates).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[stickers] no still on white for', 'bad01', expect.any(String))
    warn.mockRestore()
  })
})
