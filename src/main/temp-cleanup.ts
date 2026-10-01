import { readdir, rm, stat } from 'fs/promises'
import { join } from 'path'

/**
 * Moshi's scratch files in the system temp folder: GIFs and stickers converted for sending, pasted and opened files,
 * voice recordings. All of them can be made again when needed, and nothing used to remove them, so they piled up.
 */
export const TEMP_FOLDERS = ['unison-gifs', 'unison-sticker-gif', 'moshi-photo-sticker', 'moshi-sticker-paste', 'unison-paste', 'unison-open']
/** Loose files Moshi leaves directly in the temp folder. */
const TEMP_FILES = /^unison-voice-\d+.*\.(webm|ogg|m4a|mp4)$/

/** Delete Moshi's temp files not touched for `maxAgeMs`; returns how many went. Never throws. */
export async function pruneTemp(tempDir: string, maxAgeMs: number, now = Date.now()): Promise<number> {
  let removed = 0
  const old = async (path: string): Promise<boolean> => {
    const info = await stat(path).catch(() => undefined)
    return !!info && info.isFile() && now - info.mtimeMs > maxAgeMs
  }
  for (const folder of TEMP_FOLDERS) {
    const dir = join(tempDir, folder)
    const names = await readdir(dir).catch(() => [] as string[])
    for (const name of names) {
      const path = join(dir, name)
      if (await old(path)) {
        await rm(path, { force: true }).catch(() => undefined)
        removed++
      }
    }
  }
  for (const name of await readdir(tempDir).catch(() => [] as string[])) {
    if (!TEMP_FILES.test(name)) continue
    const path = join(tempDir, name)
    if (await old(path)) {
      await rm(path, { force: true }).catch(() => undefined)
      removed++
    }
  }
  return removed
}
