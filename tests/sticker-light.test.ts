import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'moshi-light-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))
const { lightSticker } = await import('../src/main/media/sticker-light')

describe('lighter moving stickers for the chat', () => {
  it('draws a 60 fps Pals sticker at 240 px and 30 fps, same loop, far lighter', async () => {
    const source = 'resources/stickers/pals/chao.webp'
    const body = await lightSticker(source, 'pals-chao')
    const meta = await sharp(body, { animated: true }).metadata()
    const original = await sharp(source, { animated: true }).metadata()
    expect(meta.width).toBe(240)
    expect(meta.pages).toBe(Math.round((original.pages ?? 0) / 2))
    expect(meta.delay?.reduce((a, b) => a + b, 0)).toBe(original.delay?.reduce((a, b) => a + b, 0))
    // The file is ~2.5x smaller; the decoding is the point: 39% of the pixels a frame at half the frames a second.
    expect(body.length).toBeLessThan(statSync(source).size / 2)
    // Made once: the second ask is the kept copy.
    const again = await lightSticker(source, 'pals-chao')
    expect(again.equals(body)).toBe(true)
    expect((await sharp(again, { animated: true }).metadata()).pages).toBe(meta.pages)
  }, 60_000)
})
