import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

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
