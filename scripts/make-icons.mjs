// Renders the app icons from the SVG sources in build/.
//   build/icon.svg        two "Unison buddies" (large sizes)
//   build/icon-small.svg  the orange buddy alone (16-48 px, stays legible)
// Outputs: build/icon.png (1024), build/icon.ico (16-256), resources/icon.png (256, window icon).
// Run: node scripts/make-icons.mjs
import sharp from 'sharp'
import { writeFile } from 'fs/promises'

/** Rasterise at 2x the target size (density is relative to the SVG's own viewBox width), then downsample. */
const VIEWBOX = { 'build/icon.svg': 1024, 'build/icon-small.svg': 64 }
const render = (file, size) =>
  sharp(file, { density: Math.max(1, Math.ceil(((72 * size) / VIEWBOX[file]) * 2)) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()

/** ICO container with PNG-compressed entries (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const large = 'build/icon.svg'
const small = 'build/icon-small.svg'
await writeFile('build/icon.png', await render(large, 1024))
await writeFile('resources/icon.png', await render(large, 256))
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const images = []
for (const size of icoSizes) images.push({ size, data: await render(size <= 48 ? small : large, size) })
await writeFile('build/icon.ico', ico(images))
console.log('icons written:', ['build/icon.png (1024)', 'resources/icon.png (256)', `build/icon.ico (${icoSizes.join(', ')})`].join(' · '))
