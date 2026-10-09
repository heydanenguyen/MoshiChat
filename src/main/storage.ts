import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Account, Platform, Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

export interface StoredAccount {
  id: string
  platform: Platform
  displayName: string
  handle?: string
  avatarUrl?: string
  demo?: boolean
  /** Encrypted, base64 encoded JSON blob (tokens, sessions). */
  secret?: string
}

/** Who changed the settings: the user (default), sync bringing in another computer's changes, or tidying away chats of removed accounts. */
export type SettingsOrigin = 'user' | 'sync' | 'tidy'
type SettingsListener = (before: Settings, after: Settings, origin: SettingsOrigin) => void

interface StoreShape {
  version: 1
  accounts: StoredAccount[]
  settings: Settings
}

/** Windows file-lock errors worth a short retry. */
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES'])

const errorCode = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | undefined)?.code

/** Windows: antivirus or the indexer may hold the file for a moment, so a locked-file error gets a few tries, 100 ms apart. */
export async function retryLocked<T>(op: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await op()
    } catch (err) {
      if (attempt >= 3 || !LOCKED.has(errorCode(err) ?? '')) throw err
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

const EMPTY: StoreShape = { version: 1, accounts: [], settings: DEFAULT_SETTINGS }

/**
 * First run: English, unless the system's display language is Vietnamese. (Not the first of the user's
 * preferred languages: Windows can list Vietnamese first while showing everything in English. The
 * setup window follows the same display language.)
 */
function systemLanguage(): Settings['language'] {
  return (app.getLocale() || '').toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

/**
 * Tiny JSON store. Secrets are encrypted with the OS keychain (DPAPI on Windows,
 * Keychain on macOS) through Electron's safeStorage before touching disk.
 */
export class Storage {
  private data: StoreShape = structuredClone(EMPTY)
  private file = join(app.getPath('userData'), 'unison.json')
  private writing: Promise<void> = Promise.resolve()
  private listeners: SettingsListener[] = []

  /** How the last load() went: untouched, rebuilt from the backup, or (the file was unusable) started empty. */
  recovered: 'none' | 'backup' | 'empty' = 'none'
  /** unison.json is still on disk but could not be trusted (set-aside failed): the next save must not copy it over the good .bak. */
  private fileUntrusted = false

  async load(): Promise<void> {
    this.recovered = 'none'
    let raw: string
    try {
      raw = await retryLocked(() => fs.readFile(this.file, 'utf8'))
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return this.startEmpty()
      return this.recover(err)
    }
    try {
      this.data = this.parse(raw)
    } catch (err) {
      await this.recover(err)
    }
  }

  private startEmpty(): void {
    this.data = structuredClone(EMPTY)
    this.data.settings.language = systemLanguage()
  }

  private parse(raw: string): StoreShape {
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return {
      version: 1,
      accounts: parsed.accounts ?? [],
      settings: {
        ...DEFAULT_SETTINGS,
        language: systemLanguage(),
        ...(parsed.settings ?? {}),
        // Weather became opt-in: installs from before the switch keep it while their greetings are on.
        weather: parsed.settings?.weather ?? parsed.settings?.greetings !== false,
        muted: { ...DEFAULT_SETTINGS.muted, ...(parsed.settings?.muted ?? {}) }
      }
    }
  }

  /** The store could not be read: keep the broken file for inspection (the next save must not overwrite it), then fall back to the backup. */
  private async recover(err: unknown): Promise<void> {
    console.error('[storage] unison.json is unreadable, setting it aside', err)
    const aside = `${this.file}.corrupt-${new Date().toISOString().replace(/:/g, '-')}`
    await fs.rename(this.file, aside).catch((e) => {
      this.fileUntrusted = true
      console.error('[storage] could not set the broken file aside', e)
    })
    try {
      this.data = this.parse(await fs.readFile(this.file + '.bak', 'utf8'))
      this.recovered = 'backup'
    } catch {
      this.startEmpty()
      this.recovered = 'empty'
    }
  }

  private persist(): Promise<void> {
    // Compact: written whole on every change (settings, accounts), so no indentation to write and parse.
    const snapshot = JSON.stringify(this.data)
    // A failed write rejects only its own caller; later writes carry the whole current data, so they still run.
    const run = this.writing.catch(() => undefined).then(() => this.write(snapshot))
    this.writing = run
    return run
  }

  private async write(snapshot: string): Promise<void> {
    const tmp = this.file + '.tmp'
    try {
      await fs.writeFile(tmp, snapshot, 'utf8')
      // Best effort: the previous good store stays as .bak for load() to fall back on.
      if (!this.fileUntrusted) await fs.copyFile(this.file, this.file + '.bak').catch(() => undefined)
      await retryLocked(() => fs.rename(tmp, this.file))
      this.fileUntrusted = false
    } catch (err) {
      console.error('[storage] could not save unison.json', err)
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      throw err
    }
  }

  /** Resolves when every queued write has settled (failed ones included); for before-quit. */
  async flush(): Promise<void> {
    let last: Promise<void>
    do {
      last = this.writing
      await last.catch(() => undefined)
    } while (last !== this.writing)
  }

  get settings(): Settings {
    return this.data.settings
  }

  onSettingsChanged(listener: SettingsListener): void {
    this.listeners.push(listener)
  }

  async setSettings(patch: Partial<Settings>, origin: SettingsOrigin = 'user'): Promise<Settings> {
    const before = this.data.settings
    this.data.settings = { ...this.data.settings, ...patch }
    for (const listener of this.listeners) {
      try {
        listener(before, this.data.settings, origin)
      } catch {
        /* a listener's trouble never stops the save */
      }
    }
    await this.persist()
    return this.data.settings
  }

  get accounts(): StoredAccount[] {
    return this.data.accounts
  }

  async upsertAccount(account: Account, secret?: unknown): Promise<void> {
    const existing = this.data.accounts.find((a) => a.id === account.id)
    const stored: StoredAccount = {
      id: account.id,
      platform: account.platform,
      displayName: account.displayName,
      handle: account.handle,
      avatarUrl: account.avatarUrl,
      demo: account.demo,
      secret: secret === undefined ? existing?.secret : encrypt(secret)
    }
    if (existing) Object.assign(existing, stored)
    else this.data.accounts.push(stored)
    await this.persist()
  }

  async removeAccount(accountId: string): Promise<void> {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== accountId)
    await this.persist()
  }

/** Accounts with secrets decrypted (for an encrypted backup) plus settings. */
  exportPortable(): { accounts: Array<Omit<StoredAccount, 'secret'> & { secret?: unknown }>; settings: Settings } {
    return {
      accounts: this.data.accounts.map((a) => ({ ...a, secret: a.secret ? decrypt<unknown>(a.secret) : undefined })),
      settings: structuredClone(this.data.settings)
    }
  }

  /** Replace everything with restored data; secrets are encrypted again for this device. */
  async importPortable(data: { accounts: Array<Omit<StoredAccount, 'secret'> & { secret?: unknown }>; settings: Settings }): Promise<void> {
    this.data = {
      version: 1,
      accounts: data.accounts.map((a) => ({ ...a, secret: a.secret === undefined || a.secret === null ? undefined : encrypt(a.secret) })),
      settings: data.settings
    }
    await this.persist()
  }

  readSecret<T>(accountId: string): T | undefined {
    const stored = this.data.accounts.find((a) => a.id === accountId)
    if (!stored?.secret) return undefined
    return decrypt<T>(stored.secret)
  }
}

/**
 * Whether sign-in sessions are really protected on disk: the OS keychain (macOS), DPAPI (Windows) or a desktop keyring
 * (Linux). Linux without a keyring falls back to a fixed key ('basic_text'), or to none at all, which is only encoding.
 */
export function secretsProtected(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform !== 'linux') return true
  try {
    return safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

function encrypt(value: unknown): string {
  const json = JSON.stringify(value)
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(json).toString('base64')
  }
  return 'plain:' + Buffer.from(json, 'utf8').toString('base64')
}

function decrypt<T>(blob: string): T | undefined {
  try {
    if (blob.startsWith('enc:')) {
      const buf = Buffer.from(blob.slice(4), 'base64')
      return JSON.parse(safeStorage.decryptString(buf)) as T
    }
    if (blob.startsWith('plain:')) {
      return JSON.parse(Buffer.from(blob.slice(6), 'base64').toString('utf8')) as T
    }
  } catch {
    /* corrupted or keychain changed – caller will re-auth */
  }
  return undefined
}
