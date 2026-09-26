import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

const { fromGiphy, fromKlipy } = await import('../src/main/gifs')
const { imageSize } = await import('../src/main/media/image-size')

describe('GIF providers', () => {
  it('maps KLIPY results and skips ads', () => {
    const f = (q: string, ext: string, w = 200, h = 150) => ({ url: `https://static.klipy.com/${q}.${ext}`, width: w, height: h, size: 1000 })
    const { items, hasNext } = fromKlipy({
      result: true,
      data: {
        has_next: true,
        data: [
          {
            id: 1,
            slug: 'happy-cat',
            title: 'Happy cat',
            type: 'gif',
            file: { md: { gif: f('md', 'gif', 320, 240), mp4: f('md', 'mp4') }, sm: { webp: f('sm', 'webp'), gif: f('sm', 'gif') } }
          },
          { id: 2, type: 'ad', file: { md: { gif: f('ad', 'gif') } } },
          { id: 3, type: 'gif', file: {} }
        ]
      }
    })
    expect(hasNext).toBe(true)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'klipy:happy-cat', provider: 'klipy', title: 'Happy cat' })
    expect(items[0].gif).toMatchObject({ url: 'https://static.klipy.com/md.gif', width: 320, height: 240 })
    expect(items[0].preview.url).toBe('https://static.klipy.com/sm.webp')
    expect(items[0].mp4?.url).toBe('https://static.klipy.com/md.mp4')
  })

  it('maps GIPHY results with string sizes and pagination', () => {
    const { items, hasNext } = fromGiphy({
      data: [
        {
          id: 'abc',
          title: 'wave',
          images: {
            fixed_width: { url: 'https://media.giphy.com/fw.gif', webp: 'https://media.giphy.com/fw.webp', width: '200', height: '112' },
            downsized_medium: { url: 'https://media.giphy.com/dm.gif', width: '480', height: '270', size: '900000' },
            original: { url: 'https://media.giphy.com/o.gif', width: '480', height: '270', mp4: 'https://media.giphy.com/o.mp4', mp4_size: '120000' }
          }
        },
        { id: 'broken', images: {} }
      ],
      pagination: { total_count: 100, count: 24, offset: 0 }
    })
    expect(hasNext).toBe(true)
    expect(items).toHaveLength(1)
    expect(items[0].preview).toEqual({ url: 'https://media.giphy.com/fw.webp', width: 200, height: 112 })
    expect(items[0].gif).toMatchObject({ url: 'https://media.giphy.com/dm.gif', width: 480, size: 900000 })
    expect(items[0].mp4).toMatchObject({ url: 'https://media.giphy.com/o.mp4', size: 120000 })
    expect(fromGiphy({ data: [], pagination: { total_count: 24, count: 24, offset: 0 } }).hasNext).toBe(false)
  })
})

describe('image header sizes (Zalo uploads)', () => {
  it('reads GIF, PNG, JPEG and WebP dimensions', () => {
    const gif = Buffer.alloc(16)
    gif.write('GIF89a')
    gif.writeUInt16LE(320, 6)
    gif.writeUInt16LE(240, 8)
    expect(imageSize(gif)).toEqual({ width: 320, height: 240 })

    const png = Buffer.alloc(32)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(640, 16)
    png.writeUInt32BE(480, 20)
    expect(imageSize(png)).toEqual({ width: 640, height: 480 })

    // SOI, an APP0 segment, then SOF0 with height 100, width 200
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x03, 0, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ width: 200, height: 100 })

    const webp = Buffer.alloc(32)
    webp.write('RIFF')
    webp.write('WEBPVP8X', 8)
    webp.writeUIntLE(799, 24, 3)
    webp.writeUIntLE(599, 27, 3)
    expect(imageSize(webp)).toEqual({ width: 800, height: 600 })

    expect(imageSize(Buffer.from('hello world, not an image'))).toBeUndefined()
  })
})
