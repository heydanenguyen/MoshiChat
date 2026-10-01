import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'moshi-preview-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { previewOf, snapWidth } = await import('../src/main/media/preview')

const photo = (width: number, height: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 80 } } })
    .jpeg({ quality: 95 })
    .toBuffer()

describe('previewOf', () => {
  it('scales a big photo down to the next preview size, once', async () => {
    const big = await photo(4000, 6000)
    const fetchOriginal = vi.fn(async () => ({ type: 'image/jpeg', body: big }))
    const first = await previewOf('https://f1-zpc.zdn.vn/big.jpg', 900, fetchOriginal)
    expect(first?.type).toBe('image/webp')
    const meta = await sharp(first!.body).metadata()
    expect(meta.width).toBeLessThanOrEqual(960)
    expect(first!.body.length).toBeLessThan(big.length)
    // From the disk copy the second time: the platform is not asked again.
    const second = await previewOf('https://f1-zpc.zdn.vn/big.jpg', 900, fetchOriginal)
    expect(second?.body.equals(first!.body)).toBe(true)
    expect(fetchOriginal).toHaveBeenCalledTimes(1)
  })

  it('leaves small pictures and GIFs as they are, and says nothing when the platform has nothing', async () => {
    const small = await photo(300, 200)
    expect((await previewOf('https://x.zdn.vn/s.jpg', 960, async () => ({ type: 'image/jpeg', body: small })))?.body).toBe(small)
    const gif = Buffer.from('GIF89a')
    expect((await previewOf('https://x.dlfl.vn/g', 960, async () => ({ type: 'image/gif', body: gif })))?.type).toBe('image/gif')
    expect(await previewOf('https://x.zdn.vn/gone.jpg', 960, async () => undefined)).toBeUndefined()
  })

  it('asks for the same file only once when two bubbles want it at the same time', async () => {
    const big = await photo(3000, 2000)
    const fetchOriginal = vi.fn(async () => ({ type: 'image/jpeg', body: big }))
    await Promise.all([previewOf('https://y.zdn.vn/a.jpg', 960, fetchOriginal), previewOf('https://y.zdn.vn/a.jpg', 800, fetchOriginal)])
    expect(fetchOriginal).toHaveBeenCalledTimes(1)
    expect(snapWidth(800)).toBe(960)
    expect(snapWidth(5000)).toBe(2560)
  })
})
