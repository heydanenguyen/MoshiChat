import { app } from 'electron'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ThreadType, type API, type AttachmentSource } from 'zca-js'
import { isStickerId } from '@shared/stickers'
import type { OutgoingAttachment } from '@shared/types'
import { animatedStickerFrames } from '../media/sticker-gif'
import { stickerMotionFrames, stickerStill } from '../media/sticker-webp'

/**
 * Experimental: a Moshi sticker as a Zalo "photo sticker" (the kind made from a picture), so it arrives without the
 * white square. Sent as a GIF, Zalo makes a JPEG thumbnail for it and its apps show that, background and all.
 *
 * Found in Zalo Web (sendPhotoByUrl): a photo sent by URL to /api/{message,group}/photo_url with
 *   properties: { type: 3 }  — MSG_BUBBLE_LAYOUT_TYPE_NO_BORDER, drawn with no bubble and no background
 *   webp: { width, height, url } — the see-through picture the apps draw
 *   ext: { sSrcStr: '@STICKER' } — shown as "[Sticker]" in chat lists
 * plus an ordinary photo (oriUrl / hdUrl / thumbUrl) for anything that cannot draw the WebP. Zalo Web's own photo
 * stickers point `webp` at Tenor, so the apps take a WebP from anywhere, as long as it really is one.
 */

// Zalo shows a photo sticker at 130-190 px; a heavier file is not drawn moving (seen: 0.7-1.1 MB at 240 px, 25 fps).
const SIZE = 200

const dir = async (): Promise<string> => {
  const path = join(app.getPath('temp'), 'moshi-photo-sticker')
  await mkdir(path, { recursive: true })
  return path
}

const FPS = 15
/**
 * Stickers with an animation of their own (Pals, at 60 fps: 96-144 frames, ~0.7 MB as a WebP at 180 px, slow to show
 * on the phone) are redrawn at 40 fps (~450-490 KB, chosen side by side against 15-60 fps). The weight is in the
 * frames, ~11 KB each: a smaller picture saves little, and 10 fps looked choppy.
 */
const OWN_SIZE = 180
const OWN_FPS = 40
/** Bump when the pictures change, so cached ones are redrawn. */
const VERSION = 7
/** Frames a second and WebP quality to try, in order, until a moving sticker is under its byte budget. */
const PACK_TRIES: Array<[number, number]> = [[FPS, 80], [10, 70], [6, 60]]
const OWN_TRIES: Array<[number, number]> = [[OWN_FPS, 65], [20, 60], [12, 50]]

/**
 * Which frames of an animation to keep at about `fps`, and how long each kept one shows. Frames are taken at even
 * moments of the loop (the one on screen at each moment), so any rate works, 40 out of 60 included; each kept frame
 * shows until the next moment, so the loop keeps its length. An animation already at or below `fps` keeps every frame.
 */
export function framesAt(delays: number[], fps: number): { pages: number[]; delays: number[] } {
  const total = delays.reduce((sum, d) => sum + d, 0)
  const count = Math.round((total * fps) / 1000)
  if (!delays.length || count >= delays.length) return { pages: delays.map((_, i) => i), delays: [...delays] }
  const starts = delays.map((_, i) => delays.slice(0, i).reduce((sum, d) => sum + d, 0))
  const moment = (i: number): number => Math.round((i * total) / count)
  const pages = Array.from({ length: count }, (_, i) => {
    let page = 0
    while (page + 1 < delays.length && starts[page + 1] <= moment(i)) page++
    return page
  })
  return { pages, delays: pages.map((_, i) => moment(i + 1) - moment(i)) }
}

export interface StickerFileOptions {
  /** Side of the square the sticker is fitted into; by default Zalo's (200 px for a pack sticker, 180 px for the rest). */
  size?: number
  /** 'contain' pads to exactly size × size (WhatsApp wants 512 × 512); 'inside' only bounds the longest side (Telegram). */
  fit?: 'contain' | 'inside'
  /**
   * A moving WebP heavier than this (WhatsApp refuses animated stickers over ~500 KB) is redrawn at fewer frames a
   * second and lower quality; if even that is too heavy the sticker goes as a still of its first frame.
   */
  maxBytes?: number
}

export interface StickerFiles {
  id: string
  webp: string
  png: string
  width: number
  height: number
  /** A moving sticker that came out as a still (over `maxBytes`). */
  still?: boolean
}

/**
 * The sticker as a see-through WebP that moves the way it does in Moshi (a pack sticker with its motion loop, a
 * sticker with its own animation as that, fewer frames a second), and a PNG of the still sticker, the same size.
 * Drawn from the source at the size asked for, never from a smaller copy.
 */
export async function photoStickerFiles(a: Pick<OutgoingAttachment, 'sticker' | 'path' | 'alternates'>, options: StickerFileOptions = {}): Promise<StickerFiles> {
  const moving = a.alternates?.find((alt) => alt.role === 'animated')?.path
  const pack = !!a.sticker && isStickerId(a.sticker)
  const size = options.size ?? (pack ? SIZE : OWN_SIZE)
  const shape = options.fit ?? 'contain'
  const info = await stat(moving ?? a.path)
  // Zalo (no options) keeps its old key, so its cached pictures stay valid.
  const extra = options.size || options.fit || options.maxBytes ? `|${shape}|${options.maxBytes ?? ''}` : ''
  const key = createHash('sha1').update(`${a.sticker}|${moving ?? a.path}|${info.mtimeMs}|${size}|${VERSION}${extra}`).digest('hex').slice(0, 20)
  const base = join(await dir(), key)
  const webp = `${base}.webp`
  const png = `${base}.png`
  const still = `${base}-still.webp`
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
  const fit = (input: ReturnType<typeof sharp>): ReturnType<typeof sharp> => input.resize(size, size, { fit: shape, background: transparent })
  const made = async (path: string): Promise<boolean> => !!(await stat(path).catch(() => undefined))?.size
  const fits = (data: Buffer): boolean => !options.maxBytes || data.length <= options.maxBytes
  // Over budget last time: the still is what goes (and no moving WebP was kept).
  let asStill = !!options.maxBytes && !(await made(webp)) && (await made(still))
  if (!asStill && !(await made(webp))) {
    let data: Buffer | undefined
    const drawn = new Map<number, Promise<Buffer>>()
    if (pack && a.sticker && isStickerId(a.sticker)) {
      for (const [fps, quality] of options.maxBytes ? PACK_TRIES : PACK_TRIES.slice(0, 1)) {
        // Zalo's size keeps the filtered frames (its pictures stay as they were); a bigger one is drawn without the slow filter.
        const frames = await (options.size ? stickerMotionFrames : animatedStickerFrames)(a.sticker, size, fps)
        data = await sharp(frames, { join: { animated: true } })
          .webp({ quality, alphaQuality: 90, effort: 6, loop: 0, delay: Array(frames.length).fill(Math.round(1000 / fps)) })
          .toBuffer()
        if (fits(data)) break
      }
    } else {
      const source = moving ?? a.path
      const { pages = 1, delay = [] } = await sharp(source, { animated: true }).metadata()
      if (pages > 1 && delay.length === pages) {
        for (const [fps, quality] of options.maxBytes ? OWN_TRIES : OWN_TRIES.slice(0, 1)) {
          const kept = framesAt(delay, fps)
          // A retry at fewer frames a second reuses the frames already drawn.
          const frames = await Promise.all(kept.pages.map((page) => drawn.get(page) ?? drawn.set(page, fit(sharp(source, { page })).png().toBuffer()).get(page)!))
          data =await sharp(frames, { join: { animated: true } }).webp({ quality, alphaQuality: 80, effort: 6, loop: 0, delay: kept.delays }).toBuffer()
          if (fits(data)) break
        }
      } else {
        data = await fit(sharp(source)).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toBuffer()
      }
    }
    if (data && fits(data)) await writeFile(webp, data)
    else asStill = true
  }
  if (!(await made(png))) {
    // A pack sticker bigger than Zalo's is drawn from its vector, not stretched from the 384 px picture.
    const drawn = options.size && a.sticker && isStickerId(a.sticker) ? await stickerStill(a.sticker, size) : undefined
    await fit(sharp(drawn ?? a.path)).png().toFile(png)
  }
  if (asStill) await stillWebp(png, still)
  const { width = size, height = size } = shape === 'contain' ? { width: size, height: size } : await sharp(png).metadata()
  return { id: key, webp: asStill ? still : webp, png, width, height, ...(asStill ? { still: true } : {}) }
}

/** A still, see-through WebP of a sticker's PNG (Telegram shows no moving WebP; WhatsApp's fallback when too heavy). */
export async function stillWebp(png: string, out = png.replace(/\.png$/, '-still.webp')): Promise<string> {
  if (!(await stat(out).catch(() => undefined))?.size) await sharp(png).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(out)
  return out
}

export interface PhotoStickerImage {
  normalUrl: string
  hdUrl: string
  thumbUrl: string
}

export interface PhotoStickerRequest {
  threadId: string
  group: boolean
  /** The see-through PNG, in the photo fields the apps draw. */
  image: PhotoStickerImage
  webpUrl: string
  /** Zalo Web always sends one with a photo sticker (its catalogue id); ours is the picture's own hash. */
  contentId: string
  width: number
  height: number
}

/** Adds api.moshiSendPhotoSticker (zca-js custom API: same session, same encryption as everything else). */
export function addPhotoStickerApi(api: API): void {
  if ((api as unknown as Record<string, unknown>).moshiSendPhotoSticker) return
  api.custom<unknown, PhotoStickerRequest>('moshiSendPhotoSticker', async ({ ctx, utils, props }) => {
    const p = props
    const params: Record<string, unknown> = {
      clientId: Date.now().toString(),
      title: '',
      oriUrl: p.image.normalUrl,
      thumbUrl: p.image.thumbUrl,
      hdUrl: p.image.hdUrl,
      width: p.width,
      height: p.height,
      properties: JSON.stringify({ color: -1, size: -1, type: 3, subType: 0, ext: JSON.stringify({ sSrcStr: '@STICKER', sSrcType: 0 }) }),
      thumb_width: p.width,
      thumb_height: p.height,
      webp: JSON.stringify({ width: p.width, height: p.height, url: p.webpUrl }),
      contentId: p.contentId,
      imei: ctx.imei,
      ...(p.group ? { grid: p.threadId, visibility: 0 } : { toId: p.threadId })
    }
    const encrypted = utils.encodeAES(JSON.stringify(params))
    if (!encrypted) throw new Error('could not encrypt the photo sticker request')
    const base = `${api.zpwServiceMap.file[0]}/api/${p.group ? 'group' : 'message'}/photo_url`
    const res = await utils.request(utils.makeURL(base, { nretry: 0 }), { method: 'POST', body: new URLSearchParams({ params: encrypted }) })
    return utils.resolve(res)
  })
}

type Log = (...args: unknown[]) => void

/**
 * Sends the sticker at `path` as a photo sticker and returns the message id. Throws when Zalo will not take it, so
 * the caller can send the GIF instead. Logs every step: this is an experiment and the log is how we learn.
 */
export async function sendPhotoSticker(api: API, sticker: Pick<OutgoingAttachment, 'sticker' | 'path' | 'alternates'>, threadId: string, group: boolean, log: Log): Promise<string> {
  addPhotoStickerApi(api)
  const files = await photoStickerFiles(sticker)
  const type = group ? ThreadType.Group : ThreadType.User
  // As a photo Zalo turns any picture into a JPEG on white (seen: PNG and WebP alike), and the apps draw the photo
  // fields (Zalo Web's own photo stickers carry a see-through PNG there). As a file Zalo keeps the bytes, so both
  // pictures go up under a name Zalo does not treat as a picture.
  const asFile = async (file: string, kind: string): Promise<AttachmentSource> => {
    const data = await readFile(file)
    return { data, filename: `${basename(file).split('.')[0]}-${kind}.sticker`, metadata: { totalSize: data.length } }
  }
  const [png, webp] = await api.uploadAttachment([await asFile(files.png, 'png'), await asFile(files.webp, 'webp')], threadId, type)
  if (png?.fileType !== 'others' || webp?.fileType !== 'others') throw new Error(`upload gave ${png?.fileType}/${webp?.fileType}, not files`)
  log('zalo photo sticker uploaded', { png: png.fileUrl, webp: webp.fileUrl, pngBytes: png.totalSize, webpBytes: webp.totalSize })
  const [pngKind, webpKind] = await Promise.all([describeUrl(png.fileUrl, false), describeUrl(webp.fileUrl, false)])
  log('zalo photo sticker served as', { png: pngKind, webp: webpKind })
  if (!pngKind.endsWith('png') || !webpKind.endsWith('webp')) throw new Error('the uploaded pictures do not come back as they went up')
  const image = { normalUrl: png.fileUrl, hdUrl: png.fileUrl, thumbUrl: png.fileUrl }
  const send = (api as unknown as { moshiSendPhotoSticker: (p: PhotoStickerRequest) => Promise<unknown> }).moshiSendPhotoSticker
  const result = await send({ threadId, group, image, webpUrl: webp.fileUrl, contentId: files.id, width: files.width, height: files.height })
  log('zalo photo sticker sent', result)
  const msgId = (result as { msgId?: string | number } | undefined)?.msgId
  if (msgId === undefined) throw new Error('Zalo answered without a message id')
  return String(msgId)
}

/** What a sent picture's URL serves, for the log: whether Zalo kept the WebP or turned it into something else. */
export async function describeUrl(url: string, referer = true): Promise<string> {
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-15', ...(referer ? { Referer: 'https://chat.zalo.me/' } : {}) } })
    const head = new Uint8Array(await res.arrayBuffer()).slice(0, 12)
    const magic = String.fromCharCode(...head.slice(8, 12))
    return `${res.status} ${res.headers.get('content-type') ?? '?'} ${magic === 'WEBP' ? 'webp' : head[0] === 0xff ? 'jpeg' : head[0] === 0x89 ? 'png' : 'other'}`
  } catch (err) {
    return `unreachable (${(err as Error).message})`
  }
}
