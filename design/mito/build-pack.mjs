// Builds the Mito sticker pack (Mito, the black cat) for the app from the design sources in this folder.
//
//   node design/mito/build-pack.mjs [ids…]   (all stickers when none are named)
//
// Still stickers: stills/<id>.png (the drawing cut from its sheet, any size, transparent), if any.
// Animated stickers: frames/<id>/NNN.png (one loop at 25 fps, rendered from animation.html with export-frames.mjs;
// the frames are not kept in git, render them again before rebuilding).
// Output, in resources/stickers/mito/: <id>.png (384 px, transparent, white sticker outline), <id>-white.png (the same
// on white, for platforms that flatten transparency) and, for animated ones, <id>.webp (the looping animation).
import sharp from 'sharp'
import { mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const only = process.argv.slice(2)
const wanted = (id) => !only.length || only.includes(id)
const out = join(here, '../../resources/stickers/mito')
mkdirSync(out, { recursive: true })

const SIZE = 384
const FPS = 25
// Same sticker edge as the Moshi pack (src/shared/stickers.ts OUTLINE, scaled to 384 px): a white outline and a
// faint dark rim just outside it.
const WHITE_R = 12
const RIM_R = 16
const RIM = [20, 20, 50, 0.14]

/** Euclidean distance (in px) from every pixel to the nearest pixel of the shape (alpha ≥ 128). */
function distance(alpha, w, h) {
  const INF = 1e12
  const f = new Float64Array(Math.max(w, h))
  const d = new Float64Array(Math.max(w, h))
  const v = new Int32Array(Math.max(w, h))
  const z = new Float64Array(Math.max(w, h) + 1)
  const grid = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = alpha[i] >= 128 ? 0 : INF
  const pass = (n, get, set) => {
    for (let q = 0; q < n; q++) f[q] = get(q)
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]] }
    for (let q = 0; q < n; q++) set(q, d[q])
  }
  for (let x = 0; x < w; x++) pass(h, (y) => grid[y * w + x], (y, val) => { grid[y * w + x] = val })
  for (let y = 0; y < h; y++) pass(w, (x) => grid[y * w + x], (x, val) => { grid[y * w + x] = val })
  for (let i = 0; i < w * h; i++) grid[i] = Math.sqrt(grid[i])
  return grid
}

/** Puts the sticker edge around a 384 × 384 RGBA image (raw buffer) and returns a new raw buffer. */
function outline(rgba) {
  const n = SIZE * SIZE
  const alpha = new Uint8Array(n)
  for (let i = 0; i < n; i++) alpha[i] = rgba[i * 4 + 3]
  const dist = distance(alpha, SIZE, SIZE)
  const res = Buffer.alloc(n * 4)
  for (let i = 0; i < n; i++) {
    const cover = (r) => Math.min(1, Math.max(0, r + 0.5 - dist[i]))
    // rim, then white over it, then the drawing over both ("over" compositing, straight alpha)
    let r = RIM[0], g = RIM[1], b = RIM[2], a = RIM[3] * cover(RIM_R)
    const wa = cover(WHITE_R)
    ;[r, g, b, a] = over([255, 255, 255, wa], [r, g, b, a])
    const s = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3] / 255]
    ;[r, g, b, a] = over(s, [r, g, b, a])
    res[i * 4] = Math.round(r); res[i * 4 + 1] = Math.round(g); res[i * 4 + 2] = Math.round(b); res[i * 4 + 3] = Math.round(a * 255)
  }
  return res
}
/** One raw RGBA picture over another (lower first). */
function stack(lower, upper) {
  const res = Buffer.alloc(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const [r, g, b, a] = over([upper[i * 4], upper[i * 4 + 1], upper[i * 4 + 2], upper[i * 4 + 3] / 255], [lower[i * 4], lower[i * 4 + 1], lower[i * 4 + 2], lower[i * 4 + 3] / 255])
    res[i * 4] = Math.round(r); res[i * 4 + 1] = Math.round(g); res[i * 4 + 2] = Math.round(b); res[i * 4 + 3] = Math.round(a * 255)
  }
  return res
}
function over([sr, sg, sb, sa], [dr, dg, db, da]) {
  const a = sa + da * (1 - sa)
  if (a <= 0) return [0, 0, 0, 0]
  return [(sr * sa + dr * da * (1 - sa)) / a, (sg * sa + dg * da * (1 - sa)) / a, (sb * sa + db * da * (1 - sa)) / a, a]
}

/** A picture fitted into the sticker square, leaving room for the edge; returns raw RGBA. */
async function fit(input, box) {
  const img = sharp(input).ensureAlpha()
  const trimmed = box === 'trim' ? await img.trim({ threshold: 1 }).toBuffer() : await img.toBuffer()
  const inner = SIZE - 2 * (RIM_R + 4)
  return sharp(trimmed)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: RIM_R + 4, bottom: RIM_R + 4, left: RIM_R + 4, right: RIM_R + 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw().toBuffer()
}

const raw = (buf) => sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 4 } })
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
  await sharp(frames, { join: { animated: true } })
    .webp({ loop: 0, delay: Array(frames.length).fill(Math.round(1000 / FPS)), quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toFile(join(out, `${id}.webp`))
  // The still for the picker, previews and platforms that cannot show the animation: the first frame, which each
  // loop is made to start and end on (the drawing's own pose).
  await writeStill(id, await frame(files[0]))
  console.log('animated', id, frames.length, 'frames')
}
