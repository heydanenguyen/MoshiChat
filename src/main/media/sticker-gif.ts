import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdir, stat } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'

/**
 * A Moshi sticker as a small GIF for Zalo. Zalo re-encodes photos as JPEG and shows them as big
 * "HD" cards, so a PNG sticker arrived on a white square at full width; a GIF goes through Zalo's
 * GIF path, keeps its see-through edges (the stickers' white outline hides the 1-bit alpha) and is
 * shown at its own size. Animated custom stickers keep their frames.
 */
export async function stickerAsGif(path: string, size = 180): Promise<string> {
  const info = await stat(path)
  const dir = join(app.getPath('temp'), 'unison-sticker-gif')
  await mkdir(dir, { recursive: true })
  const out = join(dir, `${createHash('sha1').update(`${path}|${info.mtimeMs}|${size}`).digest('hex').slice(0, 20)}.gif`)
  if ((await stat(out).catch(() => undefined))?.size) return out
  await sharp(path, { animated: true })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .gif({ effort: 8, dither: 0 })
    .toFile(out)
  return out
}
