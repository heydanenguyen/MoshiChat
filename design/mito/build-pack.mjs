// Builds the Mito sticker pack (Mito, the black cat) for the app from the design sources in this folder.
//
//   node design/mito/build-pack.mjs [ids…]   (all stickers when none are named)
//
// Still stickers: stills/<id>.png (the drawing cut from its sheet, any size, transparent), if any.
// Animated stickers: frames/<id>/NNN.png (one loop at 25 fps, or the rate in frames/<id>/fps.txt; rendered from
// animation.html with export-frames.mjs;
// the frames are not kept in git, render them again before rebuilding).
// Output, in resources/stickers/mito/: <id>.png (384 px, transparent, white sticker outline), <id>-white.png (the same
// on white, for platforms that flatten transparency) and, for animated ones, <id>.webp (the looping animation).
import sharp from 'sharp'
import { SIZE, outline, stack, fit, raw } from '../lib/sticker-edge.mjs'
import { mkdirSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const only = process.argv.slice(2)
const wanted = (id) => !only.length || only.includes(id)
const out = join(here, '../../resources/stickers/mito')
mkdirSync(out, { recursive: true })

const FPS = 25

async function writeStill(id, rgba) {
  await raw(rgba).png({ compressionLevel: 9, palette: false }).toFile(join(out, `${id}.png`))
  await raw(rgba).flatten({ background: '#ffffff' }).png({ compressionLevel: 9 }).toFile(join(out, `${id}-white.png`))
}

const stillsDir = join(here, 'stills')
for (const file of existsSync(stillsDir) ? readdirSync(stillsDir).filter((f) => f.endsWith('.png')) : []) {
  const id = file.replace(/\.png$/, '')
  if (!wanted(id)) continue
  await writeStill(id, outline(await fit(join(here, 'stills', file), 'trim')))
  console.log('still', id)
}

const framesDir = join(here, 'frames')
for (const id of existsSync(framesDir) ? readdirSync(framesDir).filter(wanted) : []) {
  // Frames come in layers: NNN.png (the cat, which gets the sticker edge) and, when there are effects,
  // NNN-back.png / NNN-front.png (drawn behind / over it, without an edge).
  const files = readdirSync(join(framesDir, id)).filter((f) => /^\d+\.png$/.test(f)).sort()
  const layer = (f, suffix) => {
    const path = join(framesDir, id, f.replace('.png', `${suffix}.png`))
    return existsSync(path) ? path : undefined
  }
  // Every frame gets the same framing, so nothing jumps: the box around everything that shows in any frame of the loop.
  let box = null
  for (const f of files) {
    for (const path of [join(framesDir, id, f), layer(f, '-back'), layer(f, '-front')].filter(Boolean)) {
      const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3] < 8) continue
        box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y }
      }
    }
  }
  const crop = (file) => sharp(file).extract({ left: box.x0, top: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 }).png().toBuffer()
  const frame = async (f) => {
    let rgba = outline(await fit(await crop(join(framesDir, id, f)), 'keep'))
    const back = layer(f, '-back'), front = layer(f, '-front')
    if (back) rgba = stack(await fit(await crop(back), 'keep'), rgba)
    if (front) rgba = stack(rgba, await fit(await crop(front), 'keep'))
    return rgba
  }
  const frames = []
  for (const f of files) frames.push(await raw(await frame(f)).png().toBuffer())
  const fpsFile = join(framesDir, id, 'fps.txt')
  const fps = existsSync(fpsFile) ? Number(readFileSync(fpsFile, 'utf8')) || FPS : FPS
  // Whole-millisecond delays that add up to the exact loop (30 fps: 33 and 34 ms), so the app's loop length in
  // src/shared/mito.ts stays true and hover play still stops on a loop boundary.
  const total = Math.round((frames.length * 1000) / fps)
  const delay = frames.map((_, i) => Math.round((total * (i + 1)) / frames.length) - Math.round((total * i) / frames.length))
  await sharp(frames, { join: { animated: true } })
    .webp({ loop: 0, delay, quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toFile(join(out, `${id}.webp`))
  // The still for the picker, previews and platforms that cannot show the animation: the first frame, which each
  // loop is made to start and end on (the drawing's own pose).
  await writeStill(id, await frame(files[0]))
  console.log('animated', id, frames.length, 'frames')
}
