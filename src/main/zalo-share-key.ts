import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/** The key of Zalo message sharing (zalo-share.ts keeps it, wrapped by the system keychain); undefined when sharing is off here. */
export async function readShareKey(): Promise<Buffer | undefined> {
  const file = join(app.getPath('userData'), 'zalo-share.key')
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined
    // Kept in memory while the key file is as it was (sharing turned on, off or with another passphrase rewrites it).
    const stat = await fs.stat(file)
    if (cached && cached.file === file && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.key
    const key = Buffer.from(safeStorage.decryptString(await fs.readFile(file)), 'base64')
    cached = { file, mtimeMs: stat.mtimeMs, size: stat.size, key }
    return key
  } catch {
    cached = undefined
    return undefined
  }
}

let cached: { file: string; mtimeMs: number; size: number; key: Buffer } | undefined
