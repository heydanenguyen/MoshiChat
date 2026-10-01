import { app } from 'electron'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Light copies of remote pictures for showing in the chat. Zalo hands out phone photos at full size (one was
 * 4910 × 7365, 35 MB) with every link, the "thumbnail" included, pointing at that same file; decoding it inside a
 * bubble failed and left a grey "Photo" box. So pictures are fetched once here, scaled to the size they are shown
 * at and kept on disk; Download still saves the original from the platform.
 */

/** Sizes a preview is made at: the next one up from what was asked, so a few files serve every layout. */
const WIDTHS = [480, 960, 1440, 2560]
const KEEP_DAYS = 30
const MAX_BYTES = 400 * 1024 * 1024

const dir = (): string => join(app.getPath('userData'), 'media-previews')
const inflight = new Map<string, Promise<Preview | undefined>>()

export interface Preview {
  type: string
  body: Buffer
}

export const snapWidth = (width: number): number => WIDTHS.find((w) => w >= width) ?? WIDTHS[WIDTHS.length - 1]

/**
 * The preview of `url` at about `width` pixels wide. `fetchOriginal` gets the picture from the platform (through the
 * right session) when there is no copy yet. Animated GIFs and SVGs come back as they are; so does a picture that is
 * already small.
 */
export function previewOf(url: string, width: number, fetchOriginal: () => Promise<Preview | undefined>): Promise<Preview | undefined> {
  const w = snapWidth(width)
  const key = `${createHash('sha1').update(url).digest('hex').slice(0, 24)}-${w}`
  const running = inflight.get(key)
  if (running) return running
  const job = (async (): Promise<Preview | undefined> => {
    const file = join(dir(), `${key}.webp`)
    const cached = await readFile(file).catch(() => undefined)
    if (cached) return { type: 'image/webp', body: cached }
    const original = await fetchOriginal()
    if (!original) return undefined
    if (/gif|svg/.test(original.type)) return original
    const image = sharp(original.body, { failOn: 'none' })
    const meta = await image.metadata()
    // Small enough already (a sticker, a screenshot thumbnail): no point making a copy.
    if ((meta.width ?? 0) <= w && original.body.length < 400 * 1024) return original
    const body = await image
      .rotate()
      .resize({ width: w, height: w * 2, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
    await mkdir(dir(), { recursive: true })
    await writeFile(file, body).catch(() => undefined)
    return { type: 'image/webp', body }
  })().finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

/** Previews older than a month go, then the oldest until the folder is under its size cap. */
export async function prunePreviews(): Promise<void> {
  const names = await readdir(dir()).catch(() => [] as string[])
  const files = (await Promise.all(names.map(async (name) => ({ path: join(dir(), name), info: await stat(join(dir(), name)).catch(() => undefined) })))).filter(
    (f): f is { path: string; info: NonNullable<typeof f.info> } => !!f.info
  )
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600_000
  let total = 0
  for (const f of files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)) {
    total += f.info.size
    if (f.info.mtimeMs < cutoff || total > MAX_BYTES) await rm(f.path, { force: true })
  }
}
