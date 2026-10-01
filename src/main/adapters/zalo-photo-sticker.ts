import { app } from 'electron'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ThreadType, type API, type AttachmentSource } from 'zca-js'
import { isStickerId } from '@shared/stickers'
import type { OutgoingAttachment } from '@shared/types'
import { animatedStickerFrames } from '../media/sticker-gif'

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
/** Bump when the pictures change, so cached ones are redrawn. */
const VERSION = 3

/**
 * The sticker as a see-through WebP that moves the way it does in Moshi (a pack sticker with its motion loop, a
 * sticker with its own animation as that), and a PNG of the still sticker; both SIZE px square.
 */
export async function photoStickerFiles(a: Pick<OutgoingAttachment, 'sticker' | 'path' | 'alternates'>): Promise<{ id: string; webp: string; png: string; width: number; height: number }> {
  const moving = a.alternates?.find((alt) => alt.role === 'animated')?.path
  const info = await stat(moving ?? a.path)
  const key = createHash('sha1').update(`${a.sticker}|${moving ?? a.path}|${info.mtimeMs}|${SIZE}|${VERSION}`).digest('hex').slice(0, 20)
  const base = join(await dir(), key)
  const webp = `${base}.webp`
  const png = `${base}.png`
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
  const options = { quality: 80, alphaQuality: 90, effort: 6 }
  if (!(await stat(webp).catch(() => undefined))?.size) {
    if (a.sticker && isStickerId(a.sticker)) {
      const frames = await animatedStickerFrames(a.sticker, SIZE, FPS)
      await sharp(frames, { join: { animated: true } }).webp({ ...options, loop: 0, delay: Array(frames.length).fill(Math.round(1000 / FPS)) }).toFile(webp)
    } else {
      await sharp(moving ?? a.path, { animated: true }).resize(SIZE, SIZE, { fit: 'contain', background: transparent }).webp(options).toFile(webp)
    }
  }
  if (!(await stat(png).catch(() => undefined))?.size) {
    await sharp(a.path).resize(SIZE, SIZE, { fit: 'contain', background: transparent }).png().toFile(png)
  }
  return { id: key, webp, png, width: SIZE, height: SIZE }
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
