import { open } from 'fs/promises'

/** Width and height from an image header (PNG, GIF, JPEG, WebP); undefined for anything else. */
export function imageSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      // SOF0..SOF15 carry the frame size (C4 = DHT, C8 = JPG, CC = DAC are not frames).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += marker === 0xff ? 1 : 2
        continue
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return undefined
}

/** zca-js `imageMetadataGetter`: Zalo needs the size and dimensions of photos and GIFs it uploads. */
export async function imageMetadata(path: string): Promise<{ width: number; height: number; size: number } | null> {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    // JPEG frame headers can sit after large EXIF blocks; 256 KB covers real photos.
    const head = Buffer.alloc(Math.min(size, 256 * 1024))
    await file.read(head, 0, head.length, 0)
    const dims = imageSize(head)
    return dims ? { ...dims, size } : null
  } finally {
    await file.close()
  }
}
