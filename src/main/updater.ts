import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '@shared/types'

/** Where people get a build by hand (also what an unsigned macOS build points to). */
export const RELEASES_URL = 'https://github.com/heydanenguyen/MoshiChat/releases/latest'
const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 4 * 3600_000

/**
 * In-app updates from GitHub Releases (electron-builder's app-update.yml names the repository).
 * Nothing downloads without a click. On macOS an app can only replace itself when it carries a
 * Developer ID signature; an unsigned build still learns about new versions and opens the
 * download page instead.
 */
export class Updater {
  private state: UpdateState = { phase: 'idle' }
  private timer: ReturnType<typeof setInterval> | undefined
  private manual = false
  private latest = ''
  private started = false

  constructor(
    private readonly emit: (state: UpdateState) => void,
    private readonly log: (...args: unknown[]) => void
  ) {}

  async start(): Promise<void> {
    if (!app.isPackaged || this.started) return
    this.started = true
    this.manual = process.platform === 'darwin' && !(await this.signed())
    if (this.manual) this.log('[update] unsigned macOS build: updates are offered as a download, not installed in place')
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = {
      info: (m: unknown) => this.log('[update]', m),
      warn: (m: unknown) => this.log('[update] warn:', m),
      error: (m: unknown) => this.log('[update] error:', m),
      debug: () => undefined
    }
    autoUpdater.on('checking-for-update', () => this.set({ phase: 'checking' }))
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.latest = info.version
      this.set({ phase: 'available', version: info.version, notes: notesOf(info), manual: this.manual, url: RELEASES_URL })
    })
    autoUpdater.on('update-not-available', (info: UpdateInfo) => this.set(this.quiet ? { phase: 'idle' } : { phase: 'none', version: info.version }))
    autoUpdater.on('download-progress', (p: { percent: number }) => this.set({ phase: 'downloading', version: this.latest, percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => this.set({ phase: 'ready', version: info.version }))
    autoUpdater.on('error', (err: Error) => {
      const message = err?.message ?? String(err)
      // A signature problem on macOS means the app cannot replace itself: fall back to the download page.
      if (/code signature|codesign|not signed|signature/i.test(message) && this.latest) {
        this.manual = true
        this.set({ phase: 'available', version: this.latest, manual: true, url: RELEASES_URL })
        return
      }
      // Network problems on a background check stay quiet; the next check will try again.
      if (this.quiet && this.state.phase === 'checking') {
        this.set({ phase: 'idle' })
        return
      }
      this.set({ phase: 'error', message, url: RELEASES_URL, version: this.latest || undefined })
    })
    setTimeout(() => void this.check(true), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(true), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  current(): UpdateState {
    return this.state
  }

  private quiet = true

  /** `quiet`: a background check; only news (a new version) reaches the user. */
  async check(quiet = false): Promise<void> {
    if (!app.isPackaged) {
      if (!quiet) this.set({ phase: 'none', version: app.getVersion() })
      return
    }
    // Do not interrupt a download or a finished one.
    if (this.state.phase === 'downloading' || this.state.phase === 'ready') return
    this.quiet = quiet
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      // The 'error' handler already reported it; nothing more to say here.
      this.log('[update] check failed:', (err as Error).message)
    }
  }

  async download(): Promise<void> {
    if (this.state.phase !== 'available') return
    if (this.manual) {
      await shell.openExternal(RELEASES_URL)
      return
    }
    this.quiet = false
    this.set({ phase: 'downloading', version: this.latest, percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.log('[update] download failed:', (err as Error).message)
    }
  }

  install(): void {
    if (this.state.phase !== 'ready') return
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }

  private set(state: UpdateState): void {
    this.state = state
    this.emit(state)
  }

  /** Whether this macOS bundle carries a real (non ad-hoc) signature, which self-updating needs. */
  private signed(): Promise<boolean> {
    const bundle = app.getAppPath().replace(/\/Contents\/Resources\/app(\.asar)?$/, '')
    if (!bundle.endsWith('.app')) return Promise.resolve(false)
    return new Promise((resolve) => {
      execFile('codesign', ['-dv', bundle], { timeout: 5000 }, (_err, _stdout, stderr) => {
        const info = String(stderr ?? '')
        resolve(/TeamIdentifier=(?!not set)\S+/.test(info) && !/Signature=adhoc/.test(info))
      })
    })
  }
}

function notesOf(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes
  if (typeof notes === 'string') return notes.replace(/<[^>]+>/g, '').trim().slice(0, 2000) || undefined
  if (Array.isArray(notes)) return notes.map((n) => (typeof n === 'string' ? n : (n.note ?? ''))).join('\n').replace(/<[^>]+>/g, '').trim().slice(0, 2000) || undefined
  return undefined
}
