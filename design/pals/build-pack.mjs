// Builds the Pals sticker pack: twelve animated stickers drawn from the Pals characters (src/shared/pals-art.ts) and
// moved by design/pals/motion.mjs. Every frame is drawn straight from SVG (no browser), so the loops are exact.
//
//   node design/pals/build-pack.mjs [ids…]   (all stickers when none are named)
//
// Output, in resources/stickers/pals/: <id>.png (384 px, transparent, the Moshi sticker edge), <id>-white.png (the same
// on white, for platforms that flatten transparency) and <id>.webp (the loop at 60 fps: on a 60 Hz screen every
// refresh shows a new frame, so nothing judders). The first frame is the rest pose, which is also the still.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SIZE, outline, fit, raw } from '../lib/sticker-edge.mjs'
import { PALS_STICKERS, frameSvg } from './motion.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const only = process.argv.slice(2)
const out = join(here, '../../resources/stickers/pals')
mkdirSync(out, { recursive: true })

const FPS = 60
// Drawn at twice the size it ends up at, then scaled down: smooth edges on every frame, no shimmer between them.
const DRAW = 768

const render = (sticker, p) =>
  sharp(Buffer.from(frameSvg(sticker, p, DRAW)))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

for (const sticker of PALS_STICKERS.filter((s) => !only.length || only.includes(s.id))) {
  const count = Math.round(sticker.loop * FPS)
  const phases = Array.from({ length: count }, (_, i) => i / count)
  // Every frame gets the same framing, so nothing jumps: the box around everything that shows in any frame.
  let box = null
  for (const p of phases) {
    const { data, info } = await render(sticker, p)
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3] < 8) continue
        if (!box) box = { x0: x, y0: y, x1: x, y1: y }
        else {
          if (x < box.x0) box.x0 = x
          if (x > box.x1) box.x1 = x
          if (y < box.y0) box.y0 = y
          if (y > box.y1) box.y1 = y
        }
      }
  }
  // square it up around its centre, so the pal is centred in the sticker whatever shape its loop covers
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0) + 1
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const left = Math.round(cx - side / 2)
  const top = Math.round(cy - side / 2)
  const pad = { top: Math.max(0, -top), left: Math.max(0, -left), bottom: Math.max(0, top + side - DRAW), right: Math.max(0, left + side - DRAW) }

  const frame = async (p) => {
    const { data, info } = await render(sticker, p)
    const square = await sharp(data, { raw: info })
      .extend({ ...pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extract({ left: left + pad.left, top: top + pad.top, width: side, height: side })
      .png()
      .toBuffer()
    return outline(await fit(square, 'keep'))
  }

  const frames = []
  let still = null
  for (const p of phases) {
    const rgba = await frame(p)
    if (!still) still = rgba
    frames.push(await raw(rgba).png().toBuffer())
  }
  // Whole-millisecond delays that add up to the exact loop (17, 17, 16 ms…), so the loop length in
  // src/shared/pals-stickers.ts stays true and hover play stops on a loop boundary.
  const total = Math.round(sticker.loop * 1000)
  const delay = frames.map((_, i) => Math.round((total * (i + 1)) / frames.length) - Math.round((total * i) / frames.length))
  // Quality 80 with alpha at 90 keeps 60 fps near the size of a 25 fps Mito sticker (about 1.4 MB): the sticker edge
  // makes the outline opaque white, so the alpha needs little detail; alpha 100 tripled the size and took minutes.
  await sharp(frames, { join: { animated: true } })
    .webp({ loop: 0, delay, quality: 80, alphaQuality: 90, effort: 6, smartSubsample: true })
    .toFile(join(out, `${sticker.id}.webp`))
  await raw(still).png({ compressionLevel: 9, palette: false }).toFile(join(out, `${sticker.id}.png`))
  await raw(still).flatten({ background: '#ffffff' }).png({ compressionLevel: 9 }).toFile(join(out, `${sticker.id}-white.png`))
  console.log('animated', sticker.id, frames.length, 'frames')
}

// A page to watch them all (open it in a browser; not used by the app).
writeFileSync(
  join(here, 'preview.html'),
  `<!doctype html><meta charset="utf-8"><title>Pals stickers</title>
<style>body{margin:0;padding:24px;background:#ebe7f4;font:600 13px system-ui;display:grid;grid-template-columns:repeat(4,200px);gap:16px}
figure{margin:0;background:#fff;border-radius:24px;padding:12px;text-align:center}img{width:176px;height:176px}</style>
${PALS_STICKERS.map((s) => `<figure><img src="../../resources/stickers/pals/${s.id}.webp" alt=""><figcaption>${s.name.vi} · ${s.id}</figcaption></figure>`).join('\n')}
`
)
