/**
 * The user's own stickers: photos with the background cut out on this computer, or animated GIF/WebP/APNG
 * kept as they are. Files live in <userData>/stickers with an index.json; the renderer gets data URLs.
 */
import { app, dialog, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import sharp from 'sharp'
import type { OutgoingAttachment } from '@shared/types'

export interface CustomSticker {
  id: string
  name: string
  /** File name inside the stickers folder. */
  file: string
  mime: string
  animated: boolean
  createdAt: number
  /** Its background was cut out (so "cut it out" is not offered again). */
  cut?: boolean
}

/** A picture about to become a sticker: from the file dialog, a drop, a paste, or an existing sticker. */
export interface StickerSource {
  path: string
  animated: boolean
  name: string
  /** Small preview for the sticker maker (still pictures only). */
  preview?: string
}

const MAX_SIDE = 512
const MAX_ANIMATED_BYTES = 6 * 1024 * 1024
const MIME: Record<string, string> = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.apng': 'image/apng', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }

const dir = (): string => join(app.getPath('userData'), 'stickers')
const indexFile = (): string => join(dir(), 'index.json')

async function readIndex(): Promise<CustomSticker[]> {
  try {
    const list = JSON.parse(await readFile(indexFile(), 'utf8')) as CustomSticker[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function writeIndex(list: CustomSticker[]): Promise<void> {
  await mkdir(dir(), { recursive: true })
  await writeFile(indexFile(), JSON.stringify(list))
}

const dataUrl = (mime: string, bytes: Buffer): string => `data:${mime};base64,${bytes.toString('base64')}`

/**
 * Where the renderer loads a custom sticker from: served from the stickers folder by the image protocol (index.ts).
 * They used to travel inline as base64 data URLs, kept in the renderer for the whole session (an animated one up to
 * about 8 MB of text each).
 */
const urlOf = (s: CustomSticker): string => `unison-img://custom-sticker/${encodeURIComponent(s.file)}?v=${s.createdAt}`

/** A custom sticker's file inside the stickers folder, for the image protocol; undefined for anything else. */
export function customStickerPath(file: string): string | undefined {
  return /^[a-z0-9-]{6,40}\.(png|gif|webp|apng|jpe?g)$/i.test(file) ? join(dir(), file) : undefined
}

/** Every custom sticker with where to load its picture, newest first. */
export async function listStickers(): Promise<Array<CustomSticker & { url: string }>> {
  const out: Array<CustomSticker & { url: string }> = []
  for (const s of await readIndex()) {
    // File gone: skip it.
    if (await stat(join(dir(), s.file)).catch(() => undefined)) out.push({ ...s, url: urlOf(s) })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Ask for an image; says whether it is animated (kept as is) or still (cut out and resized). Still ones come with a
 * small preview, so the sticker maker can show the photo while the background is being cut out.
 */
export async function pickStickerSource(window: BrowserWindow | undefined): Promise<StickerSource | null> {
  const result = await dialog.showOpenDialog(window!, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'apng'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  return describeSource(result.filePaths[0])
}

/** A picture file (dropped on the sticker panel, or picked) as a sticker source; rejects anything that is not one. */
export async function describeSource(path: string): Promise<StickerSource> {
  if (!/\.(png|jpe?g|webp|gif|apng|bmp|avif|heic|tiff?)$/i.test(path)) throw new Error('Only pictures can become stickers')
  const meta = await sharp(path, { animated: true }).metadata()
  const animated = (meta.pages ?? 1) > 1
  const preview = animated ? undefined : dataUrl('image/jpeg', await sharp(path).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer())
  return { path, animated, name: basename(path, extname(path)), preview }
}

/**
 * A cut-out made into a sticker: trimmed to the subject and given a white die-cut edge, like the built-in pack.
 * The edge is the subject's own shape, grown by blurring its outline and cutting the blur off softly.
 */
export async function stickerEdge(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  let [x0, y0, x1, y1] = [w, h, -1, -1]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] <= 24) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  // Nothing was found (or the whole picture is the subject): keep it as it is.
  if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) return png
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const edge = Math.max(5, Math.round(Math.max(cw, ch) * 0.022))
  const pad = edge * 2
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
  const subject = await sharp(png).extract({ left: x0, top: y0, width: cw, height: ch }).extend({ top: pad, bottom: pad, left: pad, right: pad, background: transparent }).png().toBuffer()
  const W = cw + 2 * pad
  const H = ch + 2 * pad
  // Alpha grown by `edge` px, round like the shape itself: the outline made solid, blurred, and cut at the faint
  // level the blur reaches `edge` px out (about 5% for this blur), with a one-pixel soft rim.
  // (One step per pass, kept one band: sharp runs a pipeline's operations in its own order and turns a one-band
  // picture into three when it blurs it.)
  const raw = { raw: { width: W, height: H, channels: 1 as const } }
  const solid = await sharp(subject).extractChannel(3).threshold(24).raw().toBuffer()
  const blurred = await sharp(solid, raw).blur(edge * 0.6).toColourspace('b-w').raw().toBuffer()
  const grown = await sharp(blurred, raw).linear(24, -24 * 6).toColourspace('b-w').raw().toBuffer()
  const white = Buffer.alloc(W * H * 4, 255)
  for (let i = 0; i < W * H; i++) white[i * 4 + 3] = grown[i]
  const sticker = await sharp(white, { raw: { width: W, height: H, channels: 4 } })
    .composite([{ input: subject }])
    .png()
    .toBuffer()
  // A separate pass: in one pipeline sharp would shrink the white edge first and then fail to fit the subject on it.
  return sharp(sticker).resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
}

/**
 * Add a sticker from an image file. Still images are fitted into 512×512 PNG (after the optional cutout);
 * animated ones are copied unchanged so they keep moving.
 */
export async function addSticker(path: string, cutout?: (png: Buffer) => Promise<Buffer>, named?: string): Promise<CustomSticker & { url: string }> {
  await mkdir(dir(), { recursive: true })
  const id = randomUUID().slice(0, 12)
  const name = (named || basename(path, extname(path))).slice(0, 40)
  const meta = await sharp(path, { animated: true }).metadata()
  const animated = (meta.pages ?? 1) > 1
  let sticker: CustomSticker
  if (animated) {
    const info = await stat(path)
    if (info.size > MAX_ANIMATED_BYTES) throw new Error('This animation is too large for a sticker (6 MB max)')
    const ext = extname(path).toLowerCase()
    const mime = MIME[ext] ?? 'image/gif'
    const file = `${id}${ext}`
    await copyFile(path, join(dir(), file))
    sticker = { id, name, file, mime, animated: true, createdAt: Date.now() }
  } else {
    let png: Buffer = await sharp(path).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    if (cutout) png = await stickerEdge(await cutout(png))
    const file = `${id}.png`
    await writeFile(join(dir(), file), png)
    // A copy on white for platforms that flatten transparency, like the built-in pack.
    await writeFile(join(dir(), `${id}-white.png`), await sharp(png).flatten({ background: '#ffffff' }).png().toBuffer())
    sticker = { id, name, file, mime: 'image/png', animated: false, createdAt: Date.now(), cut: !!cutout || undefined }
  }
  const list = await readIndex()
  await writeIndex([sticker, ...list])
  return { ...sticker, url: urlOf(sticker) }
}

/** A pasted picture (a screenshot, an image copied from a page) saved where a dropped file would be, as a source. */
export async function sourceFromBytes(bytes: Uint8Array, mime: string): Promise<StickerSource> {
  if (bytes.length > 40 * 1024 * 1024) throw new Error('This picture is too large')
  const ext = mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'png'
  const folder = join(app.getPath('temp'), 'moshi-sticker-paste')
  await mkdir(folder, { recursive: true })
  const path = join(folder, `pasted-${Date.now()}.${ext}`)
  await writeFile(path, bytes)
  // Named for what it is, not after the temporary file.
  return { ...(await describeSource(path)), name: 'Sticker' }
}

/** One of your stickers as a source, to make it again with the background cut out. */
export async function stickerSource(id: string): Promise<StickerSource> {
  const sticker = (await readIndex()).find((s) => s.id === id)
  if (!sticker) throw new Error('Unknown sticker')
  return { ...(await describeSource(join(dir(), sticker.file))), name: sticker.name }
}

export async function renameSticker(id: string, name: string): Promise<void> {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40)
  if (!clean) return
  await writeIndex((await readIndex()).map((s) => (s.id === id ? { ...s, name: clean } : s)))
}

export async function removeSticker(id: string): Promise<void> {
  const list = await readIndex()
  const sticker = list.find((s) => s.id === id)
  await writeIndex(list.filter((s) => s.id !== id))
  if (sticker) {
    await rm(join(dir(), sticker.file), { force: true })
    await rm(join(dir(), `${id}-white.png`), { force: true })
  }
}

/** A custom sticker as an outgoing file, same shape as the built-in pack's. */
export async function customStickerFile(id: string): Promise<OutgoingAttachment> {
  const sticker = (await readIndex()).find((s) => s.id === id)
  if (!sticker) throw new Error('Unknown sticker')
  const path = join(dir(), sticker.file)
  const size = (await stat(path)).size
  const opaque = join(dir(), `${id}-white.png`)
  // An animated one is kept as it is (addSticker): its still on white is its first frame, made when first sent.
  if (sticker.animated && !(await stat(opaque).catch(() => undefined))?.size) {
    await sharp(path)
      .flatten({ background: '#ffffff' })
      .png()
      .toFile(opaque)
      .catch((err: Error) => console.warn('[stickers] no still on white for', id, err.message))
  }
  const opaqueInfo = await stat(opaque).catch(() => undefined)
  return {
    path,
    name: sticker.file,
    mime: sticker.mime,
    size,
    sticker: `custom:${id}`,
    preview: urlOf(sticker),
    alternates: opaqueInfo?.size ? [{ path: opaque, mime: 'image/png', size: opaqueInfo.size, role: 'opaque' }] : undefined
  }
}
