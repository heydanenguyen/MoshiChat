import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'moshi-photo-sticker-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { photoStickerFiles } = await import('../src/main/adapters/zalo-photo-sticker')
const { stickerIds } = await import('../src/shared/stickers')

describe('photoStickerFiles', () => {
  it('keeps a sticker see-through in both the WebP and the PNG', async () => {
    // A red dot on nothing, wider than tall, so the square output has empty corners.
    const src = join(dir, 'dot.png')
    const dot = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg width="300" height="200"><circle cx="150" cy="100" r="80" fill="red"/></svg>') }])
      .png()
      .toBuffer()
    writeFileSync(src, dot)
    const files = await photoStickerFiles({ path: src, sticker: 'custom:dot' })
    for (const path of [files.webp, files.png]) {
      const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect([info.width, info.height]).toEqual([files.width, files.height])
      expect(data[3]).toBe(0) // the top-left corner stays empty, not white
      const centre = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4
      expect(data[centre + 3]).toBe(255)
    }
    expect((await sharp(files.webp).metadata()).format).toBe('webp')
  })

  it('makes a pack sticker move in the WebP, with a still PNG beside it', async () => {
    const id = stickerIds()[0]
    const still = join(dir, 'still.png')
    writeFileSync(still, await sharp({ create: { width: 180, height: 180, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer())
    const files = await photoStickerFiles({ path: still, sticker: id })
    const webp = await sharp(files.webp, { animated: true }).metadata()
    expect(webp.pages).toBeGreaterThan(1)
    expect(webp.loop).toBe(0)
    expect((await sharp(files.png).metadata()).pages ?? 1).toBe(1)
  })
})

describe('photoStickerFiles at a size', () => {
  // A wide red dot on nothing, and a moving GIF of random-colour frames (heavy as WebP, so a small budget is easy to bust).
  const wide = join(dir, 'wide.png')
  const noisy = join(dir, 'noisy.gif')
  beforeAll(async () => {
    writeFileSync(wide, await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer())
    const frame = (): Promise<Buffer> =>
      sharp(randomBytes(48 * 48 * 3), { raw: { width: 48, height: 48, channels: 3 } })
        .png()
        .toBuffer()
    const frames = await Promise.all(Array.from({ length: 40 }, frame))
    await sharp(frames, { join: { animated: true } })
      .gif({ delay: Array(40).fill(25), loop: 0 })
      .toFile(noisy)
  })

  it('keeps the Zalo size and bytes when asked for nothing', async () => {
    const files = await photoStickerFiles({ path: wide, sticker: 'custom:wide' })
    expect([files.width, files.height]).toEqual([180, 180])
    expect(files).not.toHaveProperty('still')
    const expected = await sharp(wide).resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toBuffer()
    expect(readFileSync(files.webp).equals(expected)).toBe(true)
  })

  it('draws exactly 512 x 512 for WhatsApp, padded rather than cropped', async () => {
    const files = await photoStickerFiles({ path: wide, sticker: 'custom:wide' }, { size: 512 })
    expect([files.width, files.height]).toEqual([512, 512])
    for (const path of [files.webp, files.png]) {
      const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect([info.width, info.height]).toEqual([512, 512])
      expect(data[3]).toBe(0) // the padding is see-through
    }
  })

  it('bounds the longest side to 512 for Telegram, with no padding', async () => {
    const files = await photoStickerFiles({ path: wide, sticker: 'custom:wide' }, { size: 512, fit: 'inside' })
    expect([files.width, files.height]).toEqual([512, 341])
    expect((await sharp(files.webp).metadata()).width).toBe(512)
  })

  it('draws a pack sticker at 512 from its vector, moving, with its white outline, and fast', async () => {
    const id = stickerIds()[0]
    const began = Date.now()
    const files = await photoStickerFiles({ path: join(dir, 'still.png'), sticker: id }, { size: 512 })
    // The outline filter took ~14 s a send here; drawn without it this is ~2 s. The limit leaves room for a slow machine.
    expect(Date.now() - began).toBeLessThan(8000)
    const webp = await sharp(files.webp, { animated: true }).metadata()
    expect([webp.width, webp.pageHeight]).toEqual([512, 512])
    expect(webp.pages).toBeGreaterThan(1)
    const { data, info } = await sharp(files.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(512)
    let white = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250 && data[i + 3] > 250) white++
    expect(white).toBeGreaterThan(2000) // the ring around the character
    expect(data[3]).toBe(0) // the corner stays see-through
  })

  it('redraws a heavy moving sticker at fewer frames a second to fit a budget', async () => {
    const source = { path: noisy, sticker: 'giphy:noisy', alternates: [{ path: noisy, mime: 'image/gif', size: 1, role: 'animated' as const }] }
    const free = await photoStickerFiles(source, { size: 128 })
    const freeSize = readFileSync(free.webp).length
    const tight = await photoStickerFiles(source, { size: 128, maxBytes: Math.floor(freeSize * 0.6) })
    expect(tight.still).toBeUndefined()
    expect(readFileSync(tight.webp).length).toBeLessThanOrEqual(Math.floor(freeSize * 0.6))
    expect((await sharp(tight.webp, { animated: true }).metadata()).pages).toBeLessThan(40)
  })

  it('falls back to a 512 still of the first frame, flagged, when no redraw fits the budget', async () => {
    const source = { path: noisy, sticker: 'giphy:noisy', alternates: [{ path: noisy, mime: 'image/gif', size: 1, role: 'animated' as const }] }
    const files = await photoStickerFiles(source, { size: 512, maxBytes: 100 })
    expect(files.still).toBe(true)
    const meta = await sharp(files.webp, { animated: true }).metadata()
    expect([meta.width, meta.height, meta.pages ?? 1]).toEqual([512, 512, 1])
    expect(files.webp).not.toBe(files.png)
    // the answer is remembered, so the next send does not redraw it all
    expect((await photoStickerFiles(source, { size: 512, maxBytes: 100 })).still).toBe(true)
  })
})


describe('framesAt', async () => {
  const { framesAt } = await import('../src/main/adapters/zalo-photo-sticker')
  it('keeps about 10 of 60 frames a second without changing the loop length', () => {
    const delays = Array.from({ length: 144 }, (_, i) => (i % 3 === 0 ? 17 : i % 3 === 1 ? 16 : 17))
    const kept = framesAt(delays, 10)
    expect(kept.pages.length).toBe(24)
    expect(kept.pages.slice(0, 3)).toEqual([0, 6, 12])
    expect(kept.delays.reduce((a, b) => a + b, 0)).toBe(delays.reduce((a, b) => a + b, 0))
  })
  it('takes 40 of 60 frames a second at even moments, keeping the loop length', () => {
    const delays = Array.from({ length: 144 }, (_, i) => (i % 3 === 1 ? 16 : 17))
    const kept = framesAt(delays, 40)
    expect(kept.pages.length).toBe(96)
    expect(kept.pages.slice(0, 4)).toEqual([0, 1, 3, 4])
    expect(new Set(kept.delays)).toEqual(new Set([25]))
    expect(kept.delays.reduce((a, b) => a + b, 0)).toBe(delays.reduce((a, b) => a + b, 0))
  })
  it('leaves a slow animation alone', () => {
    expect(framesAt([100, 100, 100], 10)).toEqual({ pages: [0, 1, 2], delays: [100, 100, 100] })
  })
})
