import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { release, totalmem, freemem, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Sticker cut-outs with macOS's own subject lifting (Vision, macOS 14+): resources/bin/moshi-cutout, built from
 * scripts/mac-cutout. About 0.3 s and 40 MB a picture, against several seconds and ~6 GB for the BiRefNet model
 * (which stays for Windows, older Macs and "Cut more precisely").
 */

const helper = (): string => (app.isPackaged ? join(process.resourcesPath, 'bin', 'moshi-cutout') : join(app.getAppPath(), 'resources', 'bin', 'moshi-cutout'))

/** macOS 14 (Darwin 23) or newer with the helper in place. */
export function nativeCutoutAvailable(): boolean {
  return process.platform === 'darwin' && Number(release().split('.')[0]) >= 23 && existsSync(helper())
}

/** Why the helper gave up, by its exit code (see main.swift). */
export class NativeCutoutError extends Error {
  constructor(
    readonly code: number | null,
    message: string
  ) {
    super(message)
  }
  /** Vision looked and found nothing to lift: worth saying so rather than running the big model on it. */
  get noSubject(): boolean {
    return this.code === 4
  }
}

/** The picture with everything but its subject made transparent (PNG in, PNG out). */
export async function nativeCutout(png: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'moshi-cutout-'))
  try {
    const input = join(dir, 'in.png')
    const output = join(dir, 'out.png')
    await writeFile(input, png)
    await new Promise<void>((resolve, reject) => {
      execFile(helper(), [input, output], { timeout: 30_000 }, (err, _stdout, stderr) => {
        if (!err) return resolve()
        const code = typeof err.code === 'number' ? err.code : null
        reject(new NativeCutoutError(code, String(stderr).trim() || err.message))
      })
    })
    return await readFile(output)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const GB = 1024 ** 3
/**
 * Whether this computer can run the BiRefNet cut-out (it peaks near 6 GB). Windows reports free memory faithfully;
 * macOS counts its file cache as used, so there only the total is checked.
 */
export function cutoutMemoryOk(): boolean {
  if (totalmem() < 8 * GB) return false
  return process.platform !== 'win32' || freemem() >= 6 * GB
}
