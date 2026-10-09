import { app, powerMonitor } from 'electron'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BridgeEvent, LockState } from '@shared/types'
import { retryLocked, type Storage } from './storage'

const scrypt = (code: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scryptCallback(code, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))))

/** Wrong codes allowed before waiting starts; then 30 s, doubling, at most 5 minutes. */
const FREE_TRIES = 5
const MAX_WAIT_MS = 5 * 60_000

export const validPasscode = (code: unknown): code is string => typeof code === 'string' && /^\d{4,8}$/.test(code)

/**
 * Locks Moshi behind a passcode. The secret (salt and scrypt hash) lives in its own file next to the settings and
 * never reaches the window, a backup or another computer; settings.appLock only says the lock is on, how long the
 * code is and when to lock by itself. Only this process decides whether Moshi is locked: on launch, by hand, when
 * the screen locks or the computer sleeps, or after the chosen idle time (away from the computer, or Moshi hidden).
 */
export class AppLock {
  private secret: { salt: string; hash: string } | undefined
  /** The lock file exists but could not be read (not just missing): stay locked and take no code rather than open up. */
  private unreadable = false
  private locked = false
  /** Wrong codes and the wait they earned; kept in the lock file so quitting and reopening does not reset them. */
  private failures = 0
  private blockedUntil = 0
  private hiddenSince = 0
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private storage: Storage,
    private emit: (event: BridgeEvent) => void,
    private log: (...args: unknown[]) => void
  ) {}

  private get file(): string {
    return join(app.getPath('userData'), 'lock.json')
  }

  get enabled(): boolean {
    return (!!this.secret || this.unreadable) && !!this.storage.settings.appLock
  }

  isLocked(): boolean {
    return this.enabled && this.locked
  }

  state(): LockState {
    const retryIn = Math.max(0, this.blockedUntil - Date.now())
    return { enabled: this.enabled, locked: this.isLocked(), length: this.storage.settings.appLock?.length, ...(retryIn ? { retryIn } : {}) }
  }

  private changed(): void {
    this.emit({ type: 'lock:state', state: this.state() })
  }

  /** Read the secret; a lock that is on starts locked. A setting without its secret (copied from elsewhere) is dropped. */
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await retryLocked(() => readFile(this.file, 'utf8'))) as { salt?: string; hash?: string; failures?: number; blockedUntil?: number }
      if (raw.salt && raw.hash) this.secret = { salt: raw.salt, hash: raw.hash }
      else this.unreadable = true // a file without a secret in it is damaged, not "no lock"
      this.failures = Math.max(0, Number(raw.failures) || 0)
      this.blockedUntil = Math.max(0, Number(raw.blockedUntil) || 0)
    } catch (err) {
      // Only a missing file means "no lock"; a busy or unreadable one must not drop the lock setting.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.unreadable = true
        this.log('[lock] could not read the lock file', err)
      }
    }
    if (this.storage.settings.appLock && !this.secret && !this.unreadable) await this.storage.setSettings({ appLock: undefined })
    if (!this.storage.settings.appLock && this.secret) await this.clearSecret()
    this.locked = this.enabled
  }

  start(): void {
    powerMonitor.on('lock-screen', () => this.lock())
    powerMonitor.on('suspend', () => this.lock())
    this.timer = setInterval(() => this.checkIdle(), 20_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** The window was hidden or minimised (true), or is back (false): hidden long enough counts as away. */
  windowHidden(hidden: boolean): void {
    this.hiddenSince = hidden ? this.hiddenSince || Date.now() : 0
  }

  private checkIdle(): void {
    const minutes = this.storage.settings.appLock?.autoLock ?? 0
    if (!this.enabled || this.locked || minutes <= 0) return
    const away = powerMonitor.getSystemIdleTime() >= minutes * 60 || (this.hiddenSince > 0 && Date.now() - this.hiddenSince >= minutes * 60_000)
    if (away) this.lock()
  }

  lock(): LockState {
    if (this.enabled && !this.locked) {
      this.locked = true
      this.changed()
      this.log('[lock] locked')
    }
    return this.state()
  }

  private async verify(code: unknown): Promise<boolean> {
    if (!this.secret || !validPasscode(code)) return false
    const key = await scrypt(code, Buffer.from(this.secret.salt, 'hex'))
    const want = Buffer.from(this.secret.hash, 'hex')
    return key.length === want.length && timingSafeEqual(key, want)
  }

  /** Try a code. Wrong ones count; past a few, each try has to wait (the wait is in the answer). */
  async unlock(code: unknown): Promise<LockState & { ok: boolean }> {
    if (Date.now() < this.blockedUntil) return { ...this.state(), ok: false }
    if (await this.verify(code)) {
      const hadFailures = this.failures > 0
      this.failures = 0
      this.blockedUntil = 0
      if (hadFailures) await this.saveFile()
      this.locked = false
      this.changed()
      return { ...this.state(), ok: true }
    }
    this.failures++
    if (this.failures >= FREE_TRIES) this.blockedUntil = Date.now() + Math.min(30_000 * 2 ** (this.failures - FREE_TRIES), MAX_WAIT_MS)
    await this.saveFile()
    this.log(`[lock] wrong code (${this.failures})`)
    return { ...this.state(), ok: false }
  }

  private async saveFile(): Promise<void> {
    if (!this.secret) return
    // tmp + rename: a crash mid-write must not leave a half-written secret (which would read as no lock).
    const tmp = this.file + '.tmp'
    await writeFile(tmp, JSON.stringify({ ...this.secret, failures: this.failures, blockedUntil: this.blockedUntil }), { mode: 0o600 })
    await rename(tmp, this.file)
  }

  private async writeSecret(code: string): Promise<void> {
    const salt = randomBytes(16)
    const hash = await scrypt(code, salt)
    this.secret = { salt: salt.toString('hex'), hash: hash.toString('hex') }
    this.failures = 0
    this.blockedUntil = 0
    await this.saveFile()
  }

  private async clearSecret(): Promise<void> {
    this.secret = undefined
    this.unreadable = false
    this.failures = 0
    this.blockedUntil = 0
    await rm(this.file, { force: true, recursive: true })
  }

  /** Turn the lock on with a new code (only when it is off; changing needs the old code). */
  async enable(code: unknown): Promise<LockState> {
    if (this.enabled) throw new Error('The lock is already on')
    if (!validPasscode(code)) throw new Error('The code must be 4 to 8 digits')
    await this.writeSecret(code)
    const settings = await this.storage.setSettings({ appLock: { length: code.length, autoLock: 5 } })
    this.emit({ type: 'settings:updated', settings })
    this.locked = false
    this.changed()
    return this.state()
  }

  async change(oldCode: unknown, code: unknown): Promise<LockState> {
    if (!(await this.verify(oldCode))) throw new Error('wrong-code')
    if (!validPasscode(code)) throw new Error('The code must be 4 to 8 digits')
    await this.writeSecret(code)
    const settings = await this.storage.setSettings({ appLock: { ...this.storage.settings.appLock!, length: code.length } })
    this.emit({ type: 'settings:updated', settings })
    this.changed()
    return this.state()
  }

  async disable(code: unknown): Promise<LockState> {
    if (!(await this.verify(code))) throw new Error('wrong-code')
    await this.clearSecret()
    const settings = await this.storage.setSettings({ appLock: undefined })
    this.emit({ type: 'settings:updated', settings })
    this.locked = false
    this.changed()
    return this.state()
  }

  async setAutoLock(minutes: number): Promise<void> {
    if (!this.enabled) return
    const settings = await this.storage.setSettings({ appLock: { ...this.storage.settings.appLock!, autoLock: Math.max(0, Math.min(240, Math.round(minutes))) } })
    this.emit({ type: 'settings:updated', settings })
  }

  /**
   * Forgot the code: every account on this computer is signed out (that is what the lock protects) and the lock
   * goes away. Messages stay on the platforms; signing in again brings them back.
   */
  async reset(signOutAll: () => Promise<void>): Promise<LockState> {
    await signOutAll()
    await this.clearSecret()
    const settings = await this.storage.setSettings({ appLock: undefined })
    this.emit({ type: 'settings:updated', settings })
    this.failures = 0
    this.blockedUntil = 0
    this.locked = false
    this.changed()
    this.log('[lock] reset: signed out of every account')
    return this.state()
  }
}
