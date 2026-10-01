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

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoreShape>
      this.data = {
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
    } catch {
      this.data = structuredClone(EMPTY)
      this.data.settings.language = systemLanguage()
    }
  }

  private persist(): Promise<void> {
    // Compact: written whole on every change (settings, accounts), so no indentation to write and parse.
    const snapshot = JSON.stringify(this.data)
    this.writing = this.writing.then(async () => {
      const tmp = this.file + '.tmp'
      await fs.writeFile(tmp, snapshot, 'utf8')
      await fs.rename(tmp, this.file)
    })
    return this.writing
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
