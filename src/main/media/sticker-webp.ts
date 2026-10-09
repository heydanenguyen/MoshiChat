import sharp from 'sharp'
import { stickerInner, stickerMarkup, STICKER_VIEWBOX, type StickerId } from '@shared/stickers'
import { motionOf, stickerFrameAttrs } from '@shared/sticker-motion'

/**
 * Pack stickers for WhatsApp and Telegram at 512 px. The sticker's outline is an SVG filter (two feMorphology dilations),
 * which costs ~2.4 s a frame at 512 px however many threads there are (27 frames: 14 s). Here the picture is drawn
 * without the filter and the outline is made from its alpha with box blurs, the same square dilation, in ~50 ms.
 */

/** The viewBox of a moving sticker (sticker-gif.ts MOTION_VIEWBOX): room above and to the right for a jump, hat and hearts. */
const MOTION_VIEWBOX = '-16 -30 100 100'
/**
 * The white ring is 2.6 sticker units wide (shared/stickers.ts OUTLINE); resvg draws it ~1 px narrower than that, since its
 * edge is anti-aliased, and its faint rim hardly shows beyond it (~1 px: measured on the filtered frames).
 */
const RING = 2.6
const RING_TRIM = 1
const RIM_BEYOND = 1
const RIM_OPACITY = 0.14
/** How many frames are drawn at once; more than this only queues behind libuv's four threads. */
const AT_ONCE = 6

/** The sticker without its outline filter, as an SVG at `size` px square. */
const plain = (inner: string, viewBox: string, size: number): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">${inner.replace(' filter="url(#unison-sticker-outline)"', '')}</svg>`)

/** The set pixels of `solid` grown by `radius` px in every direction (a square window, as feMorphology dilate), edges softened. */
async function grown(solid: Buffer, size: number, radius: number): Promise<Buffer> {
  const span = 2 * Math.round(radius) + 1
  // sharp wants a kernel at least 3 wide and tall: the line of ones sits in the middle of two empty rows (or columns).
  const row = [...Array<number>(span).fill(0), ...Array<number>(span).fill(1), ...Array<number>(span).fill(0)]
  const column = Array.from({ length: span * 3 }, (_, i) => (i % 3 === 1 ? 1 : 0))
  // A sum clipped at 255 is a maximum of a 0/255 picture; one pass along each axis is the whole square. (sharp keeps only
  // one convolution a pipeline, so the second pass starts from the first's pixels.)
  const raw = { raw: { width: size, height: size, channels: 3 as const } }
  const across = await sharp(solid, { raw: { width: size, height: size, channels: 1 } }).convolve({ width: span, height: 3, kernel: row, scale: 1 }).raw().toBuffer()
  return sharp(across, raw)
    .convolve({ width: 3, height: span, kernel: column, scale: 1 })
    .blur(0.6)
    .extractChannel(0)
    .raw()
    .toBuffer()
}

/** Flat colour as an RGBA picture whose alpha is `mask` (times `opacity`). */
const colour = (mask: Buffer, size: number, rgb: [number, number, number], opacity: number): Promise<Buffer> =>
  sharp({ create: { width: size, height: size, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .joinChannel(opacity === 1 ? mask : Buffer.from(mask.map((v) => Math.round(v * opacity))), { raw: { width: size, height: size, channels: 1 } })
    .png()
    .toBuffer()

/** One drawn sticker: the picture with its white ring and faint rim under it, see-through around. */
async function outlined(inner: string, viewBox: string, size: number): Promise<Buffer> {
  const radius = (RING * size) / Number(viewBox.split(' ')[2]) - RING_TRIM
  const sprite = await sharp(plain(inner, viewBox, size)).png().toBuffer()
  const solid = await sharp(sprite).ensureAlpha().extractChannel(3).threshold(1).raw().toBuffer()
  const [ring, rim] = await Promise.all([grown(solid, size, radius), grown(solid, size, radius + RIM_BEYOND)])
  const [white, edge] = await Promise.all([colour(ring, size, [255, 255, 255], 1), colour(rim, size, [0x14, 0x14, 0x32], RIM_OPACITY)])
  return sharp(edge)
    .composite([{ input: white }, { input: sprite }])
    .png()
    .toBuffer()
}

/** The still sticker (its pose with no motion) at `size` px square, with its outline. */
export const stickerStill = (id: StickerId, size: number): Promise<Buffer> => outlined(stickerInner(id), STICKER_VIEWBOX, size)

/** The frames of a pack sticker's motion loop at `size` px square, with outlines, a few at a time. */
export async function stickerMotionFrames(id: StickerId, size: number, fps: number): Promise<Buffer[]> {
  const count = Math.max(2, Math.round(motionOf(id).duration * fps))
  const frames: Buffer[] = []
  for (let from = 0; from < count; from += AT_ONCE) {
    const batch = Array.from({ length: Math.min(AT_ONCE, count - from) }, (_, i) => outlined(stickerMarkup(id, stickerFrameAttrs(id, (from + i) / count)), MOTION_VIEWBOX, size))
    frames.push(...(await Promise.all(batch)))
  }
  return frames
}
