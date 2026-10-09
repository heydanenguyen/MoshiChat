import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { framesAt } from '../adapters/zalo-photo-sticker'

/**
 * The moving pack stickers as the chat shows them. A chat draws a sticker at 120 px; the Pals pictures are 384 px at
 * 60 fps (96-144 frames, ~1-1.5 MB), and every one on screen was decoded and repainted at that size and pace while
 * scrolling, which stuttered. Shown from a copy at 240 px (sharp on Retina) and at most 30 fps, made once and kept.
 */
const SIZE = 240
const FPS = 30
/** Bump when the copies change, so old ones are made again. */
const VERSION = 1

const dir = (): string => join(app.getPath('userData'), 'sticker-light')
const making = new Map<string, Promise<Buffer>>()

export function lightSticker(source: string, key: string): Promise<Buffer> {
  const out = join(dir(), `${key}-v${VERSION}.webp`)
  const running = making.get(out)
  if (running) return running
  const job = (async (): Promise<Buffer> => {
    const kept = await readFile(out).catch(() => undefined)
    if (kept) return kept
    const { width = 0, pages = 1, delay = [] } = await sharp(source, { animated: true }).metadata()
    const total = delay.reduce((sum, d) => sum + d, 0)
    // Already light (small and slow): the picture as it is.
    if (pages < 2 || delay.length !== pages || (width <= SIZE && (pages * 1000) / Math.max(1, total) <= FPS + 1)) return readFile(source)
    const picked = framesAt(delay, FPS)
    const fit = { fit: 'contain' as const, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    const frames = await Promise.all(picked.pages.map((page) => sharp(source, { page }).resize(SIZE, SIZE, fit).png().toBuffer()))
    const body = await sharp(frames, { join: { animated: true } }).webp({ quality: 80, alphaQuality: 90, effort: 4, loop: 0, delay: picked.delays }).toBuffer()
    await mkdir(dir(), { recursive: true })
    await writeFile(out, body).catch(() => undefined)
    return body
  })().finally(() => making.delete(out))
  making.set(out, job)
  return job
}
