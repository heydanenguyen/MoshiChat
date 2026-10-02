import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import sharp from 'sharp'
import { PALS_STICKERS } from '../src/shared/pals-stickers'

// each GIF takes a few seconds: the shortest loop (cuoi), the longest (ngu) and an odd frame count (ngac, 105 frames)
const SAMPLE = PALS_STICKERS.filter((s) => ['cuoi', 'ngu', 'ngac'].includes(s.id))

const temp = mkdtempSync(join(tmpdir(), 'pals-gif-'))
vi.mock('electron', () => ({ app: { getPath: () => temp } }))
const { stickerAsGif } = await import('../src/main/media/sticker-gif')

afterAll(() => rmSync(temp, { recursive: true, force: true }))

/**
 * Pals stickers go to Zalo and Messenger as GIFs. Their 60 fps WebP loops are halved to 30 fps for GIF (players crawl
 * on delays under 20 ms) and the delays are whole hundredths, so the GIF has to keep the loop's real length.
 */
describe('Pals stickers as GIF', () => {
  it.each(SAMPLE.map((s) => [s.id, s.loop] as const))('%s keeps its %i ms loop', async (id, loop) => {
    const src = resolve('resources/stickers/pals', `${id}.webp`)
    const { pages: srcPages = 1 } = await sharp(src, { animated: true }).metadata()
    const gif = await stickerAsGif(src)
    const meta = await sharp(gif, { animated: true }).metadata()
    const delays = meta.delay ?? []

    expect(meta.format).toBe('gif')
    expect([meta.width, meta.pageHeight]).toEqual([180, 180])
    expect(meta.pages).toBe(Math.ceil(srcPages / 2))
    expect(meta.loop).toBe(0)
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(20)
    expect(delays.every((d) => d % 10 === 0)).toBe(true)
    expect(delays.reduce((a, b) => a + b, 0)).toBe(loop)
    // small enough for chat apps (Zalo and Messenger take a few MB)
    expect(statSync(gif).size).toBeLessThan(2_000_000)
  }, 60_000)
})
