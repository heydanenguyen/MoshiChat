import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { imageTypeOf } = await import('../src/main/media/image-type')
const { loopSeconds } = await import('../src/main/adapters/zalo')

describe('Zalo stickers', () => {
  it("tells a picture by its bytes when Zalo's file store calls it octet-stream", async () => {
    const blank = sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    expect(imageTypeOf(await blank.clone().webp().toBuffer())).toBe('image/webp')
    expect(imageTypeOf(await blank.clone().png().toBuffer())).toBe('image/png')
    expect(imageTypeOf(await blank.clone().gif().toBuffer())).toBe('image/gif')
    expect(imageTypeOf(await blank.clone().jpeg().toBuffer())).toBe('image/jpeg')
    expect(imageTypeOf(Buffer.from('<html>not found</html>'))).toBeUndefined()
  })

  it('plays a sprite sheet at Zalo’s pace: duration is per frame, 250 ms without one (as Zalo Web does)', () => {
    expect(loopSeconds(120, 10)).toBe(1.2)
    expect(loopSeconds(0, 6)).toBe(1.5)
    expect(loopSeconds(undefined, 12)).toBe(3)
  })
})
