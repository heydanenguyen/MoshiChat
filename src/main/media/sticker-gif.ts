import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdir, stat } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'
import { isStickerId, stickerMarkup, type StickerId } from '@shared/stickers'
import type { OutgoingAttachment } from '@shared/types'
import { motionOf, stickerFrameAttrs } from '@shared/sticker-motion'

const dir = async (): Promise<string> => {
  const path = join(app.getPath('temp'), 'unison-sticker-gif')
  await mkdir(path, { recursive: true })
  return path
}

/**
 * A Moshi sticker as a small GIF for Zalo. Zalo re-encodes photos as JPEG and shows them as big
 * "HD" cards, so a PNG sticker arrived on a white square at full width; a GIF goes through Zalo's
 * GIF path, keeps its see-through edges (the stickers' white outline hides the 1-bit alpha) and is
 * shown at its own size. Animated custom stickers keep their frames.
 */
export async function stickerAsGif(path: string, size = 180): Promise<string> {
  const info = await stat(path)
  const out = join(await dir(), `${createHash('sha1').update(`${path}|${info.mtimeMs}|${size}`).digest('hex').slice(0, 20)}.gif`)
  if ((await stat(out).catch(() => undefined))?.size) return out
  await sharp(path, { animated: true })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .gif({ effort: 8, dither: 0 })
    .toFile(out)
  return out
}

/** Bump when the motion changes, so cached GIFs are redrawn. */
const MOTION_VERSION = 1
/**
 * The still sticker's box (STICKER_VIEWBOX, -9 -12 82 82) with room above and to the right for a
 * jump, a party hat and floating hearts; same bottom edge, about the same scale at 216 px as the still at 180.
 */
const MOTION_VIEWBOX = '-16 -30 100 100'

/**
 * A pack sticker with its motion (sticker-motion.ts) as an animated GIF: the same loop the app plays,
 * rendered frame by frame at 25 fps. Cached per sticker.
 */
export async function animatedStickerGif(id: StickerId, size = 216, fps = 25): Promise<string> {
  const out = join(await dir(), `anim-${id}-${size}-v${MOTION_VERSION}.gif`)
  if ((await stat(out).catch(() => undefined))?.size) return out
  const count = Math.max(2, Math.round(motionOf(id).duration * fps))
  const frames = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MOTION_VIEWBOX}">${stickerMarkup(id, stickerFrameAttrs(id, i / count))}</svg>`))
        .png()
        .toBuffer()
    )
  )
  await sharp(frames, { join: { animated: true } })
    .gif({ delay: Array(count).fill(Math.round(1000 / fps)), loop: 0, effort: 8, dither: 0 })
    .toFile(out)
  return out
}

/**
 * The GIF a sticker goes out as on platforms that show a GIF at its own size, moving and see-through (Zalo, Messenger):
 * a logo-pack sticker with its motion, a sticker that has its own animation (Mito) as that animation, anything else
 * (the user's own stickers) as it is.
 */
export async function outgoingStickerGif(a: Pick<OutgoingAttachment, 'sticker' | 'path' | 'alternates'>): Promise<string> {
  if (a.sticker && isStickerId(a.sticker)) return animatedStickerGif(a.sticker)
  return stickerAsGif(a.alternates?.find((alt) => alt.role === 'animated')?.path ?? a.path)
}
