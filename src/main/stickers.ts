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

/** Every custom sticker with its image inline, newest first. */
export async function listStickers(): Promise<Array<CustomSticker & { url: string }>> {
  const out: Array<CustomSticker & { url: string }> = []
  for (const s of await readIndex()) {
    try {
      out.push({ ...s, url: dataUrl(s.mime, await readFile(join(dir(), s.file))) })
    } catch {
      /* file gone: skip it */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** Ask for an image; says whether it is animated (kept as is) or still (cut out and resized). */
export async function pickStickerSource(window: BrowserWindow | undefined): Promise<{ path: string; animated: boolean; name: string } | null> {
  const result = await dialog.showOpenDialog(window!, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'apng'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const path = result.filePaths[0]
  const meta = await sharp(path, { animated: true }).metadata()
  const animated = (meta.pages ?? 1) > 1
  return { path, animated, name: basename(path, extname(path)) }
}

/**
 * Add a sticker from an image file. Still images are fitted into 512×512 PNG (after the optional cutout);
 * animated ones are copied unchanged so they keep moving.
 */
export async function addSticker(path: string, cutout?: (png: Buffer) => Promise<Buffer>): Promise<CustomSticker & { url: string }> {
  await mkdir(dir(), { recursive: true })
  const id = randomUUID().slice(0, 12)
  const name = basename(path, extname(path)).slice(0, 40)
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
    if (cutout) png = await cutout(png)
    const file = `${id}.png`
    await writeFile(join(dir(), file), png)
    // A copy on white for platforms that flatten transparency, like the built-in pack.
    await writeFile(join(dir(), `${id}-white.png`), await sharp(png).flatten({ background: '#ffffff' }).png().toBuffer())
    sticker = { id, name, file, mime: 'image/png', animated: false, createdAt: Date.now() }
  }
  const list = await readIndex()
  await writeIndex([sticker, ...list])
  return { ...sticker, url: dataUrl(sticker.mime, await readFile(join(dir(), sticker.file))) }
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
  const data = await readFile(path)
  const opaque = join(dir(), `${id}-white.png`)
  const opaqueInfo = sticker.animated ? undefined : await stat(opaque).catch(() => undefined)
  return {
    path,
    name: sticker.file,
    mime: sticker.mime,
    size: data.length,
    sticker: `custom:${id}`,
    preview: dataUrl(sticker.mime, data),
    alternates: opaqueInfo ? [{ path: opaque, mime: 'image/png', size: opaqueInfo.size, role: 'opaque' }] : undefined
  }
}
