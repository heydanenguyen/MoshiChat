import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { SharedZaloMessage } from './adapters/zalo'
import type { ZaloShareStatus } from '@shared/bridge'

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>

/**
 * Zalo messages shared between this user's computers. Zalo keeps one web session per account: while Moshi runs on
 * one computer, the other is signed out, and whatever arrives meanwhile reaches only the first; a fresh sign-in gets
 * no history back. So each computer writes the last weeks of its Zalo messages into the sync folder (next to the
 * settings, see sync.ts), and reads the others' to fill its own gaps.
 *
 * The copies are chat history on a cloud drive, so they are encrypted (AES-256-GCM) with a key made from a
 * passphrase the user types on each computer (scrypt with a salt kept in the folder). The key is stored with the
 * system keychain (safeStorage); the passphrase itself is never stored, and the cloud drive only sees ciphertext.
 */

/** Days of messages each computer shares; long enough for a trip or a weekend off, small enough to rewrite. */
export const SHARE_DAYS = 21
const DIR = 'zalo-share'
const MAGIC = Buffer.from('MZS1')
const CHECK = 'moshi-zalo-share'
/** Rewrite this computer's copy at most this often (only when it has new messages). */
const WRITE_EVERY_MS = 5 * 60_000
const TICK_MS = 2 * 60_000

export interface ShareSource {
  shareOwner: string
  shareVersion: number
  shareSnapshot(days: number): SharedZaloMessage[]
  importShared(entries: SharedZaloMessage[]): number
}


interface ShareFile {
  version: 1
  deviceId: string
  deviceName: string
  owner: string
  writtenAt: number
  messages: SharedZaloMessage[]
}

export function encrypt(key: Buffer, data: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(data), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

export function decrypt(key: Buffer, blob: Buffer): Buffer {
  if (!blob.subarray(0, 4).equals(MAGIC)) throw new Error('not a Moshi share file')
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16))
  decipher.setAuthTag(blob.subarray(16, 32))
  return Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()])
}

export class ZaloShare {
  private key?: Buffer
  private keyFile = join(app.getPath('userData'), 'zalo-share.key')
  private lastWritten = new Map<string, { version: number; at: number }>()
  private seen = new Map<string, number>()
  private received = new Map<string, { device: string; added: number; at: number }>()
  private lastWriteAt?: number
  private error?: string
  private timer?: ReturnType<typeof setInterval>
  private running: Promise<void> = Promise.resolve()

  constructor(
    private folder: () => string | undefined,
    private device: () => { id: string; name: string },
    private sources: () => ShareSource[],
    private log: (...args: unknown[]) => void
  ) {}

  async start(): Promise<void> {
    try {
      const stored = await fs.readFile(this.keyFile)
      if (safeStorage.isEncryptionAvailable()) this.key = Buffer.from(safeStorage.decryptString(stored), 'base64')
    } catch {
      /* not turned on here */
    }
    this.timer = setInterval(() => void this.runNow(), TICK_MS)
    this.timer.unref?.()
    setTimeout(() => void this.runNow(), 30_000).unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private dir(): string | undefined {
    const folder = this.folder()
    return folder ? join(folder, DIR) : undefined
  }

  async status(): Promise<ZaloShareStatus> {
    const dir = this.dir()
    const passphraseSet = !!dir && !!(await fs.stat(join(dir, 'share.json')).catch(() => undefined))
    return { folderReady: !!dir, enabled: !!dir && !!this.key, passphraseSet, lastWriteAt: this.lastWriteAt, received: [...this.received.values()], error: this.error }
  }

  /** Turn sharing on with the passphrase: the first computer sets it, the others must match it. */
  async enable(passphrase: string): Promise<ZaloShareStatus> {
    const dir = this.dir()
    if (!dir) throw new Error('Set up sync first: sharing uses the same folder')
    if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no keychain to keep the key safely')
    await fs.mkdir(dir, { recursive: true })
    const metaFile = join(dir, 'share.json')
    let meta: { version: 1; salt: string; check: string } | undefined
    try {
      meta = JSON.parse(await fs.readFile(metaFile, 'utf8'))
    } catch {
      /* first computer */
    }
    let key: Buffer
    if (meta) {
      key = await scrypt(passphrase, Buffer.from(meta.salt, 'base64'), 32)
      const check = Buffer.from(meta.check, 'base64')
      const matches = ((): boolean => {
        try {
          return decrypt(key, check).toString() === CHECK
        } catch {
          return false
        }
      })()
      if (!matches) throw new Error('This passphrase does not match the one set on your other computer')
    } else {
      const salt = randomBytes(16)
      key = await scrypt(passphrase, salt, 32)
      meta = { version: 1, salt: salt.toString('base64'), check: encrypt(key, Buffer.from(CHECK)).toString('base64') }
      await fs.writeFile(metaFile + '.tmp', JSON.stringify(meta))
      await fs.rename(metaFile + '.tmp', metaFile)
    }
    this.key = key
    await fs.writeFile(this.keyFile, safeStorage.encryptString(key.toString('base64')))
    this.lastWritten.clear()
    this.seen.clear()
    await this.runNow()
    return this.status()
  }

  /** Stop sharing here: this computer's copies leave the folder; the others keep theirs. */
  async disable(): Promise<ZaloShareStatus> {
    this.key = undefined
    await fs.rm(this.keyFile, { force: true })
    const dir = this.dir()
    if (dir) {
      const mine = `${this.device().id}.zmsg`
      for (const owner of await fs.readdir(dir).catch(() => [] as string[])) await fs.rm(join(dir, owner, mine), { force: true }).catch(() => undefined)
    }
    this.received.clear()
    return this.status()
  }

  /** Write this computer's copies (when they changed) and read the others'. One run at a time. */
  runNow(): Promise<void> {
    this.running = this.running.then(() => this.run()).catch((err: Error) => {
      this.error = err.message
      this.log('zalo share failed:', err.message)
    })
    return this.running
  }

  private async run(): Promise<void> {
    const dir = this.dir()
    const key = this.key
    if (!dir || !key) return
    const me = this.device()
    for (const source of this.sources()) {
      const owner = source.shareOwner
      if (!owner) continue
      const ownerDir = join(dir, owner)
      await fs.mkdir(ownerDir, { recursive: true })
      // Others first: what they bring is then part of this computer's own copy too.
      for (const name of await fs.readdir(ownerDir)) {
        if (!name.endsWith('.zmsg') || name === `${me.id}.zmsg`) continue
        const path = join(ownerDir, name)
        const stat = await fs.stat(path).catch(() => undefined)
        if (!stat || this.seen.get(path) === stat.mtimeMs) continue
        try {
          const file = JSON.parse(gunzipSync(decrypt(key, await fs.readFile(path))).toString('utf8')) as ShareFile
          if (file.version !== 1 || file.owner !== owner) continue
          const added = source.importShared(file.messages)
          this.received.set(path, { device: file.deviceName || 'Moshi', added, at: Date.now() })
          if (added) this.log(`zalo share: ${added} messages from ${file.deviceName}`)
          this.seen.set(path, stat.mtimeMs)
        } catch (err) {
          // Half-synced by the cloud client, or written with another passphrase: tried again next round.
          this.log('zalo share: could not read', name, (err as Error).message)
        }
      }
      const last = this.lastWritten.get(owner)
      if (last && (last.version === source.shareVersion || Date.now() - last.at < WRITE_EVERY_MS)) continue
      const file: ShareFile = { version: 1, deviceId: me.id, deviceName: me.name, owner, writtenAt: Date.now(), messages: source.shareSnapshot(SHARE_DAYS) }
      const target = join(ownerDir, `${me.id}.zmsg`)
      await fs.writeFile(target + '.tmp', encrypt(key, gzipSync(JSON.stringify(file))))
      await fs.rename(target + '.tmp', target)
      this.lastWritten.set(owner, { version: source.shareVersion, at: file.writtenAt })
      this.lastWriteAt = file.writtenAt
    }
    this.error = undefined
  }
}
