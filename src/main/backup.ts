import { app, safeStorage, session } from 'electron'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, relative, sep } from 'path'
import type { Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import {
  BACKUP_EXTENSION,
  packBackup,
  readBackupHeader,
  safeRelativePath,
  unpackBackup,
  type BackupHeader,
  type BackupPayload,
  type PortableCookie
} from './backup-format'
import type { Storage } from './storage'

/** Web sign-ins live in these persistent partitions (login windows and the hidden Instagram client). */
const PARTITIONS = ['login-instagram', 'login-messenger']
/** Keys and sessions; left out of a backup made without sign-ins. */
const SESSION_DIRS = ['whatsapp']
const MAX_FILES_BYTES = 300 * 1024 * 1024

const userData = (): string => app.getPath('userData')
const adaptersDir = (): string => join(userData(), 'adapters')

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else if (e.isFile()) out.push(p)
  }
  return out
}

async function exportCookies(): Promise<Record<string, PortableCookie[]>> {
  const out: Record<string, PortableCookie[]> = {}
  for (const name of PARTITIONS) {
    const cookies = await session.fromPartition(`persist:${name}`).cookies.get({})
    if (!cookies.length) continue
    out[name] = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      hostOnly: c.hostOnly,
      expirationDate: c.expirationDate,
      sameSite: c.sameSite
    }))
  }
  return out
}

async function importCookies(all: Record<string, PortableCookie[]>): Promise<void> {
  for (const [name, cookies] of Object.entries(all)) {
    if (!PARTITIONS.includes(name)) continue
    const jar = session.fromPartition(`persist:${name}`).cookies
    for (const c of cookies) {
      const host = (c.domain ?? '').replace(/^\./, '')
      if (!host) continue
      await jar
        .set({
          url: `${c.secure ? 'https' : 'http'}://${host}${c.path ?? '/'}`,
          name: c.name,
          value: c.value,
          domain: c.hostOnly ? undefined : c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate,
          sameSite: c.sameSite
        })
        .catch(() => undefined)
    }
    await jar.flushStore()
  }
}

export interface BackupResult {
  path: string
  bytes: number
}

export async function createBackup(storage: Storage, path: string, password: string, includeSessions: boolean): Promise<BackupResult> {
  const portable = storage.exportPortable()
  const accounts = includeSessions ? portable.accounts : portable.accounts.map((a) => ({ ...a, secret: undefined }))
  const files: BackupPayload['files'] = []
  let total = 0
  for (const file of await walk(adaptersDir())) {
    const rel = relative(adaptersDir(), file).split(sep).join('/')
    if (!includeSessions && SESSION_DIRS.includes(rel.split('/')[0])) continue
    const data = await readFile(file)
    total += data.length
    if (total > MAX_FILES_BYTES) break
    files.push({ path: rel, data: data.toString('base64') })
  }
  const payload: BackupPayload = { accounts, settings: portable.settings, files, cookies: includeSessions ? await exportCookies() : {} }
  const buf = packBackup(
    { createdAt: Date.now(), appVersion: app.getVersion(), includesSessions: includeSessions, accounts: accounts.filter((a) => !a.demo).length },
    payload,
    password
  )
  const target = path.toLowerCase().endsWith(`.${BACKUP_EXTENSION}`) ? path : `${path}.${BACKUP_EXTENSION}`
  await writeFile(target, buf)
  return { path: target, bytes: buf.length }
}

export async function inspectBackup(path: string): Promise<BackupHeader & { path: string; bytes: number }> {
  const buf = await readFile(path)
  return { ...readBackupHeader(buf), path, bytes: buf.length }
}

/**
 * Replace this device's Moshi data with the backup. The current data is moved to
 * userData/before-restore-<time> first, so nothing is lost if the backup was the wrong one.
 * `beforeApply` runs once the backup is known to be good (stop the adapters there); relaunch after.
 */
export async function restoreBackup(storage: Storage, path: string, password: string, beforeApply: () => Promise<void>): Promise<{ safetyCopy: string }> {
  // Decrypting first: a wrong password or a damaged file changes nothing.
  const { payload } = unpackBackup(await readFile(path), password)
  await beforeApply()

  const safetyCopy = join(userData(), `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(safetyCopy, { recursive: true })
  await cp(join(userData(), 'unison.json'), join(safetyCopy, 'unison.json')).catch(() => undefined)
  if (await stat(adaptersDir()).catch(() => undefined)) await rename(adaptersDir(), join(safetyCopy, 'adapters'))

  for (const file of payload.files) {
    const rel = safeRelativePath(file.path)
    if (!rel) continue
    const target = join(adaptersDir(), ...rel.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, Buffer.from(file.data, 'base64'))
  }
  // Current web sign-ins go into the safety copy too (encrypted for this device).
  const current = await exportCookies()
  if (Object.keys(current).length && safeStorage.isEncryptionAvailable()) {
    await writeFile(join(safetyCopy, 'cookies.enc'), safeStorage.encryptString(JSON.stringify(current)))
  }
  if (Object.keys(payload.cookies ?? {}).length) {
    // Old sign-ins in these partitions would mix with the restored ones.
    for (const name of PARTITIONS)
      await session
        .fromPartition(`persist:${name}`)
        .clearStorageData({ storages: ['cookies'] })
        .catch(() => undefined)
    await importCookies(payload.cookies)
  }
  await storage.importPortable({ accounts: payload.accounts, settings: { ...DEFAULT_SETTINGS, ...payload.settings } as Settings })
  return { safetyCopy }
}

/** Safety copies older than a month are removed quietly at startup. */
export async function pruneSafetyCopies(): Promise<void> {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000
  for (const name of await readdir(userData()).catch(() => [] as string[])) {
    if (!name.startsWith('before-restore-')) continue
    const info = await stat(join(userData(), name)).catch(() => undefined)
    if (info && info.mtimeMs < cutoff) await rm(join(userData(), name), { recursive: true, force: true }).catch(() => undefined)
  }
}
