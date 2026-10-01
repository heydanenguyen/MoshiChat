// Mito stickers as transparent animated GIFs for uploading to GIPHY (GIPHY takes GIF, not WebP).
// Reads the pack's WebPs (resources/stickers/mito) and writes design/mito/giphy/<nn>-<id>.gif.
// Run from the repository root: node design/mito/export-giphy.mjs
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const SRC = 'resources/stickers/mito'
const OUT = 'design/mito/giphy'
// Same order as src/shared/mito.ts, so the files list like the picker.
const ORDER = ['chao', 'tim', 'coc', 'quay', 'gian', 'ngu', 'toasang', 'tuchoi', 'dienthoai', 'khohieu', 'nghilai', 'nhayday']

await mkdir(OUT, { recursive: true })
const have = new Set((await readdir(SRC)).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)))
for (const [i, id] of ORDER.entries()) {
  if (!have.has(id)) continue
  const out = join(OUT, `${String(i + 1).padStart(2, '0')}-${id}.gif`)
  const meta = await sharp(join(SRC, `${id}.webp`), { animated: true }).metadata()
  await sharp(join(SRC, `${id}.webp`), { animated: true })
    .gif({ delay: meta.delay, loop: 0, effort: 10, dither: 0, interFrameMaxError: 0 })
    .toFile(out)
  const loop = (meta.delay ?? []).reduce((a, b) => a + b, 0)
  console.log(out, `${meta.width}px`, `${meta.pages} frames`, `${loop} ms`, `${Math.round((await stat(out)).size / 1024)} KB`)
}
