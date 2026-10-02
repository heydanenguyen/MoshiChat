// Renders every icon from the logo characters in src/shared/logos.ts (single source of truth).
//   build/icon.svg, build/icon-small.svg   reference SVGs of the default logo (Buddies)
//   build/icon.png (1024), build/icon.ico  installer / executable icon (Buddies)
//   resources/icon.png (256)               fallback window icon
//   resources/icons/<logo>.png (256)       window/taskbar icon for each logo picked in Settings
// Run: npm run icons
import { buildSync } from 'esbuild'
import sharp from 'sharp'
import { mkdir, rm, writeFile } from 'fs/promises'
import { pathToFileURL } from 'url'

const load = async (entry) => {
  const bundle = `build/.${entry.replace(/\W/g, '_')}.bundle.mjs`
  buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'error' })
  const mod = await import(pathToFileURL(bundle).href)
  await rm(bundle, { force: true })
  return mod
}
const { ALL_LOGOS, logoIconSvg } = await load('src/shared/logos.ts')
const { stickerIds, stickerSvg } = await load('src/shared/stickers.ts')

/** Rasterise an SVG string at 2x the target size, then downsample (density is relative to its viewBox). */
async function render(svg, size) {
  const viewBoxWidth = Number(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/.exec(svg)?.[1] ?? 64)
  return sharp(Buffer.from(svg), { density: Math.max(1, Math.ceil(((72 * size) / viewBoxWidth) * 2)) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()
}

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
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const large = logoIconSvg('buddies')
const small = logoIconSvg('buddies', true)
await writeFile('build/icon.svg', large + '\n')
await writeFile('build/icon-small.svg', small + '\n')
await writeFile('build/icon.png', await render(large, 1024))
await writeFile('resources/icon.png', await render(large, 256))
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const images = []
for (const size of icoSizes) images.push({ size, data: await render(size <= 48 ? small : large, size) })
await writeFile('build/icon.ico', ico(images))

await mkdir('resources/icons', { recursive: true })
for (const id of ALL_LOGOS) await writeFile(`resources/icons/${id}.png`, await render(logoIconSvg(id), 256))
// Stickers: transparent PNG plus a copy on white (Instagram/Telegram flatten transparency).
await mkdir('resources/stickers', { recursive: true })
for (const id of stickerIds()) {
  const png = await render(stickerSvg(id), 384)
  await writeFile(`resources/stickers/${id}.png`, png)
  await writeFile(`resources/stickers/${id}-white.png`, await sharp(png).flatten({ background: '#ffffff' }).png({ compressionLevel: 9 }).toBuffer())
}
console.log(`stickers written: ${stickerIds().length} × 2`)
console.log(`icons written: build/icon.png, build/icon.ico (${icoSizes.join(', ')}), resources/icon.png, resources/icons/{${ALL_LOGOS.join(',')}}.png`)
