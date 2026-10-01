import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

vi.mock('electron', () => ({ app: { getPath: () => '' }, dialog: {} }))
const { stickerEdge } = await import('../src/main/stickers')

/** A red disc of radius r in the middle of a transparent w×h picture. */
async function disc(w: number, h: number, r: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="#ff0000"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function pixel(png: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

describe('sticker edge', () => {
  it('trims to the subject and rings it in white, leaving the corners clear', async () => {
    const out = await stickerEdge(await disc(400, 300, 60))
    const { width, height } = await sharp(out).metadata()
    // 120 px subject plus a few edges of room on each side, not the 400×300 frame.
    expect(width).toBeLessThan(200)
    expect(width).toBe(height)
    const mid = Math.floor(width! / 2)
    expect(await pixel(out, mid, mid)).toEqual([255, 0, 0, 255])
    // Just outside the disc: solid white edge.
    const ring = await pixel(out, mid, Math.floor(height! / 2 - 60 - 3))
    expect(ring.slice(0, 3)).toEqual([255, 255, 255])
    expect(ring[3]).toBeGreaterThan(200)
    expect((await pixel(out, 0, 0))[3]).toBe(0)
  })

  it('fits a subject that fills the picture, edge and all, into 512 px', async () => {
    // A 512 px photo whose subject nearly fills it: with its edge it is wider than 512 and is shrunk back.
    const out = await stickerEdge(await disc(512, 512, 250))
    const { width, height } = await sharp(out).metadata()
    expect(Math.max(width!, height!)).toBe(512)
  })

  it('leaves a picture with no clear background alone', async () => {
    const full = await sharp({ create: { width: 64, height: 48, channels: 4, background: '#3366ff' } }).png().toBuffer()
    expect(await stickerEdge(full)).toBe(full)
    const empty = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    expect(await stickerEdge(empty)).toBe(empty)
  })
})
