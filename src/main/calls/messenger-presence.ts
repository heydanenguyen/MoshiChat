import { BrowserWindow } from 'electron'
import type { Account, BridgeEvent, CallSettings } from '@shared/types'
import { blockHeavyResources, unblockHeavyResources } from '../instagram-realtime'
import { browserUserAgent } from '../user-agent'
import type { RingHost } from './incoming'
import { callPlatformOf } from './target'

const HOME = 'https://www.facebook.com/messages/'
const RELOAD_EVERY = 6 * 3600_000
const RESTART_AFTER = 5000

/** Whether a personal Messenger account should have its listening window right now: the setting is on and the account is connected. */
export function shouldRunPresence(settings: { calls?: Partial<CallSettings> }, account: Pick<Account, 'id' | 'platform' | 'demo' | 'status'>): boolean {
  return callPlatformOf(account) === 'messenger' && settings.calls?.incomingMessenger !== false && account.status === 'connected'
}

/**
 * What to do about an account's window. Starting wants a connected account; once it runs, a reconnect in between (status
 * flips to connecting) keeps it, so a flapping connection does not rebuild a Facebook page each time. It goes when the
 * setting is off, the account must sign in again, or the account is gone.
 */
export function presenceAction(settings: { calls?: Partial<CallSettings> }, account: Account | undefined, running: boolean): 'start' | 'stop' | 'keep' {
  if (!running) return account && shouldRunPresence(settings, account) ? 'start' : 'keep'
  if (!account || callPlatformOf(account) !== 'messenger' || settings.calls?.incomingMessenger === false) return 'stop'
  return account.status === 'needs_auth' || account.status === 'disconnected' ? 'stop' : 'keep'
}

/** What the presence windows need from the app. */
export interface PresenceDeps {
  accounts(): Account[]
  settings(): { calls?: Partial<CallSettings> }
  partition(accountId: string): string
  watch(host: RingHost): void
  forget(host: RingHost): void
  log(...args: unknown[]): void
}

/**
 * A hidden facebook.com/messages page in the account's own session, kept open so a call to that account rings in Moshi.
 * Images, fonts and media are refused and the sound is muted (it only has to be there); an answered call lifts both. The
 * page is reloaded every six hours (not under a call) and rebuilt five seconds after it crashes or is closed.
 */
class PresenceWindow implements RingHost {
  readonly platform = 'messenger' as const
  readonly homeUrl = HOME
  readonly key: string
  private window?: BrowserWindow
  private reloadTimer?: NodeJS.Timeout
  private restartTimer?: NodeJS.Timeout
  private stopped = true
  private inCall = false

  constructor(
    private readonly id: string,
    private readonly deps: PresenceDeps
  ) {
    this.key = `messenger-presence:${id}`
  }

  accountId(): string {
    return this.id
  }

  callWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined
  }

  beginCall(): void {
    this.inCall = true
    const contents = this.callWindow()?.webContents
    if (!contents) return
    contents.setAudioMuted(false)
    unblockHeavyResources(contents)
  }

  endCall(): void {
    this.inCall = false
    const contents = this.callWindow()?.webContents
    if (!contents) return
    contents.setAudioMuted(true)
    blockHeavyResources(contents)
  }

  get running(): boolean {
    return !this.stopped
  }

  start(): void {
    this.stopped = false
    clearTimeout(this.restartTimer)
    if (this.callWindow()) return
    const win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 760,
      webPreferences: {
        partition: this.deps.partition(this.id),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // A hidden page whose timers are slowed would miss the dialog, and Facebook would drop the ring.
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    this.window = win
    // The session's too, as the sign-in window sets it: the popup Facebook runs an answered call in is a new page that only the session's user agent reaches.
    win.webContents.session.setUserAgent(browserUserAgent())
    win.webContents.setUserAgent(browserUserAgent())
    // Moshi rings in its own window; Facebook's own ring stays silent until a call is answered.
    win.webContents.setAudioMuted(true)
    blockHeavyResources(win.webContents)
    win.webContents.on('render-process-gone', (_e, details) => {
      this.deps.log('[call] messenger presence page gone:', this.id, details.reason)
      this.rebuild()
    })
    win.on('closed', () => {
      this.window = undefined
      this.schedule()
    })
    this.deps.watch(this)
    void win.loadURL(HOME).catch(() => undefined)
    clearInterval(this.reloadTimer)
    this.reloadTimer = setInterval(() => {
      const current = this.callWindow()
      if (current && !this.inCall) current.webContents.reload()
    }, RELOAD_EVERY)
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.restartTimer)
    clearInterval(this.reloadTimer)
    this.reloadTimer = undefined
    this.deps.forget(this)
    this.callWindow()?.destroy()
    this.window = undefined
  }

  private rebuild(): void {
    if (this.stopped) return
    this.deps.forget(this)
    this.callWindow()?.destroy()
    this.window = undefined
    this.schedule()
  }

  private schedule(): void {
    if (this.stopped) return
    clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => this.start(), RESTART_AFTER)
  }
}

/** One listening window per personal Messenger account that has the setting on; the main process tells it what changed. */
export class MessengerPresence {
  private readonly windows = new Map<string, PresenceWindow>()

  constructor(private readonly deps: PresenceDeps) {}

  /** Looks at every account (start-up, the setting changed). */
  sync(): void {
    const accounts = this.deps.accounts()
    for (const account of accounts) this.decide(account.id, account)
    for (const id of [...this.windows.keys()]) if (!accounts.some((a) => a.id === id)) this.decide(id, undefined)
  }

  /** An account was added, changed or removed. */
  onEvent(event: BridgeEvent): void {
    if (event.type === 'account:updated') this.decide(event.account.id, event.account)
    else if (event.type === 'account:removed') this.decide(event.accountId, undefined)
  }

  /** An account is about to be removed (before its session is wiped): its window goes first. */
  stopAccount(accountId: string): void {
    this.decide(accountId, undefined)
  }

  stopAll(): void {
    for (const window of this.windows.values()) window.stop()
    this.windows.clear()
  }

  private decide(id: string, account: Account | undefined): void {
    const running = this.windows.get(id)
    const action = presenceAction(this.deps.settings(), account, !!running?.running)
    if (action === 'start') {
      const window = running ?? new PresenceWindow(id, this.deps)
      this.windows.set(id, window)
      window.start()
      this.deps.log('[call] messenger presence on:', id)
    } else if (action === 'stop' && running) {
      running.stop()
      this.windows.delete(id)
      this.deps.log('[call] messenger presence off:', id)
    }
  }
}
