import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { gunzipSync, gzipSync } from 'zlib'
import type { Platform, Settings } from '@shared/types'

/**
 * The .unisonbackup file: a small readable header (when it was made, app version, whether it carries
 * sign-ins) followed by the gzipped payload encrypted with AES-256-GCM under a key derived from the
 * user's password (scrypt). Without the password nothing but the header can be read.
 *
 *   "UNISONBK" | format (1 byte) | header length (uint16 BE) | header JSON | salt (16) | iv (12) | tag (16) | ciphertext
 */

export const BACKUP_EXTENSION = 'moshibackup'
/** Backups made while the app was still called Unison open the same way. */
export const LEGACY_BACKUP_EXTENSION = 'unisonbackup'
const MAGIC = Buffer.from('UNISONBK', 'ascii')
const FORMAT = 1
const KDF = { N: 1 << 15, r: 8, p: 1 }

export interface BackupHeader {
  createdAt: number
  appVersion: string
  includesSessions: boolean
  accounts: number
  kdf: { N: number; r: number; p: number }
}

/** Accounts with their secrets in the clear (they are only ever written inside the encrypted payload). */
export interface PortableAccount {
  id: string
  platform: Platform
  displayName: string
  handle?: string
  avatarUrl?: string
  demo?: boolean
  secret?: unknown
}

export interface PortableCookie {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  hostOnly?: boolean
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export interface BackupPayload {
  accounts: PortableAccount[]
  settings: Settings
  /** Files under userData/adapters (caches, WhatsApp keys), path relative to that folder. */
  files: Array<{ path: string; data: string }>
  /** Cookies of the persistent web partitions (Instagram / Facebook web sign-ins). */
  cookies: Record<string, PortableCookie[]>
}

export class BackupPasswordError extends Error {
  constructor() {
    super('BACKUP_PASSWORD')
  }
}

export class BackupFormatError extends Error {
  constructor(detail: string) {
    super(`BACKUP_FORMAT: ${detail}`)
  }
}

function key(password: string, salt: Buffer, kdf: BackupHeader['kdf']): Buffer {
  return scryptSync(password.normalize('NFC'), salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 })
}

export function packBackup(header: Omit<BackupHeader, 'kdf'>, payload: BackupPayload, password: string): Buffer {
  if (password.length < 8) throw new Error('Password too short')
  const fullHeader: BackupHeader = { ...header, kdf: KDF }
  const headerBytes = Buffer.from(JSON.stringify(fullHeader), 'utf8')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(password, salt, KDF), iv)
  cipher.setAAD(headerBytes)
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 })), cipher.final()])
  const len = Buffer.alloc(2)
  len.writeUInt16BE(headerBytes.length)
  return Buffer.concat([MAGIC, Buffer.from([FORMAT]), len, headerBytes, salt, iv, cipher.getAuthTag(), body])
}

function split(buf: Buffer): { header: BackupHeader; headerBytes: Buffer; rest: Buffer } {
  if (buf.length < MAGIC.length + 3 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupFormatError('not a Moshi backup')
  if (buf[MAGIC.length] !== FORMAT) throw new BackupFormatError('made by a newer Moshi')
  const len = buf.readUInt16BE(MAGIC.length + 1)
  const start = MAGIC.length + 3
  const headerBytes = buf.subarray(start, start + len)
  let header: BackupHeader
  try {
    header = JSON.parse(headerBytes.toString('utf8')) as BackupHeader
  } catch {
    throw new BackupFormatError('damaged header')
  }
  return { header, headerBytes, rest: buf.subarray(start + len) }
}

/** The readable part only (no password needed). */
export function readBackupHeader(buf: Buffer): BackupHeader {
  return split(buf).header
}

export function unpackBackup(buf: Buffer, password: string): { header: BackupHeader; payload: BackupPayload } {
  const { header, headerBytes, rest } = split(buf)
  if (rest.length < 44) throw new BackupFormatError('truncated')
  const salt = rest.subarray(0, 16)
  const iv = rest.subarray(16, 28)
  const tag = rest.subarray(28, 44)
  const decipher = createDecipheriv('aes-256-gcm', key(password, salt, header.kdf), iv)
  decipher.setAAD(headerBytes)
  decipher.setAuthTag(tag)
  let plain: Buffer
  try {
    plain = Buffer.concat([decipher.update(rest.subarray(44)), decipher.final()])
  } catch {
    // GCM refuses a wrong key (and any tampering) the same way.
    throw new BackupPasswordError()
  }
  const payload = JSON.parse(gunzipSync(plain).toString('utf8')) as BackupPayload
  if (!Array.isArray(payload.accounts) || !payload.settings) throw new BackupFormatError('missing data')
  return { header, payload }
}

/** Adapter files come from the backup: never let a path climb out of the adapters folder. */
export function safeRelativePath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return undefined
  const parts = normalized.split('/')
  if (parts.some((p) => p === '..' || p === '' || p === '.')) return undefined
  return parts.join('/')
}
