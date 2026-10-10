import type { BrowserWindow, NativeImage, WebContents } from 'electron'
import type { CallSettings, IncomingCall } from '@shared/types'
import { callTexts } from './strings'
import { PLATFORM_HOSTS, onDomain } from './target'
import { watchRing, type RingEvent, type RingWatch } from './ring-detect'
import type { CallHandle } from './types'

export type RingPlatform = 'messenger' | 'instagram'

/** A hidden page that can ring (Instagram's realtime window, a Messenger presence window): what listening to it and answering in it need. */
export interface RingHost {
  /** Names the page (one watch per key). */
  readonly key: string
  readonly platform: RingPlatform
  /** Where the page rests: after a call it goes back here, which also drops whatever call was still on it. */
  readonly homeUrl: string
  /** The account it listens for (known late: an Instagram window starts before its account has settled on an id). */
  accountId(): string | undefined
  /** The page's window (it changes when the page crashes and is rebuilt); the call is answered in it. */
  callWindow(): BrowserWindow | undefined
  /** The page is about to carry a call: it must be heard, see images and not reload under it. */
  beginCall(): void
  /** The call is over: back to a quiet page. */
  endCall(): void
}

/** How long a ring may last without the page saying it ended before it is let go (a page that died mid-ring). */
export const RING_LIMIT_MS = 90_000
/** After the last popup of an answered call closes, how long before the call counts as over. */
const POPUP_GONE_MS = 2500
const CALL_TITLE = 'Moshi · Call'

interface Entry {
  call: IncomingCall
  source: string
  callId: string
}

/**
 * The calls that ring right now, one page at a time: a page shows one dialog, so a new call on it replaces the old one,
 * and the same call told twice (a reload of the script, a repeated line) is one call.
 */
export class IncomingList {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly name: (accountId: string) => string = (accountId) => accountId
  ) {}

  /** `fresh` when this is a call not heard of before (the banner and the notification are due); `replaced` is the call of that page it pushed out. */
  ring(source: string, callId: string, call: Omit<IncomingCall, 'id' | 'at'>): { call: IncomingCall; fresh: boolean; replaced?: IncomingCall } {
    const known = this.entries.get(source)
    if (known?.callId === callId) return { call: known.call, fresh: false }
    const made: IncomingCall = { ...call, id: `${source}#${callId}`, at: this.now() }
    this.entries.set(source, { call: made, source, callId })
    return { call: made, fresh: true, replaced: known?.call }
  }

  /** The page's ring is over. */
  ended(source: string): IncomingCall | undefined {
    const known = this.entries.get(source)
    this.entries.delete(source)
    return known?.call
  }

  byId(id: string): { call: IncomingCall; source: string } | undefined {
    for (const entry of this.entries.values()) if (entry.call.id === id) return { call: entry.call, source: entry.source }
    return undefined
  }

  /** Whether this page has a call ringing. */
  has(source: string): boolean {
    return this.entries.has(source)
  }

  all(): IncomingCall[] {
    return [...this.entries.values()].map((e) => e.call)
  }
}

/** What the controller needs from the call manager (and nothing more, so it can be tested apart). */
export interface IncomingPort {
  add(call: IncomingCall): void
  remove(id: string): void
  /** A call is already in progress. */
  busy(): boolean
  /** Moshi is quitting: windows must be allowed to close. */
  closing(): boolean
  /** The ringing call becomes the call in progress, in this window. */
  adopt(id: string, call: { accountId: string; platform: RingPlatform; kind: 'audio' | 'video'; handle: CallHandle }): void
  trust(contents: WebContents): void
  untrust(contents: WebContents): void
  /** A link an answered call's popup tried to leave for: the system browser takes it. */
  openExternal(url: string): void
  settings(): CallSettings
  language(): 'en' | 'vi'
  icon(): NativeImage | undefined
  log(...args: unknown[]): void
}

interface Answered {
  popups: Map<WebContents, BrowserWindow>
  /** The window's size before it became the call window (it is put back when the call is over). */
  size: [number, number]
  finishing: boolean
  goneTimer?: NodeJS.Timeout
  closedHandlers: Array<() => void>
  settle: () => void
  done: Promise<void>
}

interface Watch {
  host: RingHost
  contents: WebContents
  win: BrowserWindow
  detector: RingWatch
  /** Pages that a call (ringing or answered) lets use the microphone: set while one of them is up. */
  trusted: boolean
  limit?: NodeJS.Timeout
  /** A ring heard before the account of its page was known: told as soon as it is. */
  waiting?: { event: Extract<RingEvent, { kind: 'ring' }>; timer: NodeJS.Timeout }
  answered?: Answered
  cleanup: Array<() => void>
}

/**
 * Hears hidden pages ring, tells the manager, and answers or declines in the page. An answered call is carried on by that
 * very window: shown as a call window (960x640, "Moshi · Call"), and on close hidden again with its page back at rest.
 */
export class IncomingCalls {
  private readonly list: IncomingList
  private readonly watches = new Map<string, Watch>()

  constructor(private readonly port: IncomingPort) {
    this.list = new IncomingList()
  }

  /** Starts listening to the host's page (again, after the page was rebuilt). */
  watch(host: RingHost): void {
    this.forget(host)
    const win = host.callWindow()
    if (!win || win.isDestroyed()) return
    const contents = win.webContents
    const w: Watch = { host, contents, win, trusted: false, cleanup: [], detector: undefined as unknown as RingWatch }
    // A hidden page opens nothing, except the popup Facebook runs an answered call in.
    contents.setWindowOpenHandler(({ url }) =>
      w.answered && onDomain(url, PLATFORM_HOSTS[host.platform])
        ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, title: CALL_TITLE, icon: this.port.icon() } }
        : { action: 'deny' }
    )
    const onPopup = (child: BrowserWindow): void => this.popup(w, child)
    const onTitle = (event: Electron.Event): void => {
      if (w.answered) event.preventDefault()
    }
    const onClose = (event: Electron.Event): void => {
      // The close button of an answered call ends the call; the window itself is only hidden (it is the page's home).
      if (!w.answered || w.answered.finishing || this.port.closing()) return
      event.preventDefault()
      this.finish(w)
    }
    contents.on('did-create-window', onPopup)
    win.on('page-title-updated', onTitle)
    win.on('close', onClose)
    const onClosed = (): void => this.forget(host)
    win.once('closed', onClosed)
    w.cleanup.push(() => {
      contents.off('did-create-window', onPopup)
      if (!win.isDestroyed()) {
        win.off('page-title-updated', onTitle)
        win.off('close', onClose)
        win.off('closed', onClosed)
      }
    })
    w.detector = watchRing(contents, (event) => this.onEvent(w, event), this.port.log)
    this.watches.set(host.key, w)
  }

  /** The host's page is gone (or being rebuilt): what rang or ran on it is over. */
  forget(host: RingHost): void {
    const w = this.watches.get(host.key)
    if (!w) return
    this.watches.delete(host.key)
    w.detector.dispose()
    for (const undo of w.cleanup.splice(0)) undo()
    this.finish(w)
    this.rangOut(w)
  }

  /** Quitting: answered calls end (their windows must not hold the quit up), and nothing rings on. */
  shutdown(): void {
    for (const w of [...this.watches.values()]) {
      this.finish(w)
      this.rangOut(w)
    }
  }

  async answer(id: string): Promise<boolean> {
    const found = this.list.byId(id)
    const w = found && this.watches.get(found.source)
    const win = w?.host.callWindow()
    if (!found || !w || !win || win.isDestroyed()) return false
    if (this.port.busy()) {
      this.port.log('[call] answer refused: a call is already in progress')
      return false
    }
    this.list.ended(found.source)
    this.clearLimit(w)
    const { call } = found
    const answered = makeAnswered(win.getSize() as [number, number])
    w.answered = answered
    this.clearWaiting(w)
    w.host.beginCall()
    this.trust(w)
    win.setTitle(CALL_TITLE)
    win.setSize(960, 640)
    win.center()
    const icon = this.port.icon()
    if (icon) win.setIcon(icon)
    this.port.adopt(call.id, { accountId: call.accountId, platform: w.host.platform, kind: call.kind, handle: this.handle(w, answered) })
    win.show()
    win.focus()
    // The window needs a moment to be on screen before a real click lands.
    await new Promise((resolve) => setTimeout(resolve, 400))
    const pressed = await w.detector.press('answer')
    if (!pressed) {
      this.port.log('[call] answer: no Answer button on the page any more')
      this.finish(w)
    }
    return pressed
  }

  async decline(id: string): Promise<boolean> {
    const found = this.list.byId(id)
    const w = found && this.watches.get(found.source)
    if (!found || !w) return false
    const pressed = await w.detector.press('decline')
    // The banner goes either way: the person has answered it (a dialog that is already gone needs no button).
    if (this.list.byId(id)) this.rangOut(w)
    if (!pressed) this.port.log('[call] decline: no Decline button on the page')
    return pressed
  }

  private onEvent(w: Watch, event: RingEvent): void {
    // The page of an answered call goes on showing dialogs of its own (the call's), and is never ringing again meanwhile.
    if (w.answered) return
    if (event.kind === 'ended') return this.rangOut(w)
    this.tell(w, event)
  }

  /** Puts a ring on the banner; if the page's account is not known yet (an Instagram window starts before its account has an id), waits for it. */
  private tell(w: Watch, event: Extract<RingEvent, { kind: 'ring' }>, since = Date.now()): void {
    const { host } = w
    const settings = this.port.settings()
    if (host.platform === 'messenger' ? settings.incomingMessenger === false : settings.incomingInstagram === false) return
    const accountId = host.accountId()
    if (!accountId) {
      if (w.waiting?.event.callId === event.callId) return
      this.clearWaiting(w)
      const timer = setTimeout(() => {
        w.waiting = undefined
        if (Date.now() - since < RING_LIMIT_MS && !w.answered && this.watches.get(host.key) === w) this.tell(w, event, since)
      }, 1000)
      timer.unref?.()
      w.waiting = { event, timer }
      return
    }
    this.clearWaiting(w)
    const result = this.list.ring(host.key, event.callId, {
      accountId,
      platform: host.platform,
      peerName: event.peerName || callTexts(this.port.language()).someone,
      kind: event.video ? 'video' : 'audio'
    })
    if (!result.fresh) return
    if (result.replaced) this.port.remove(result.replaced.id)
    this.clearLimit(w)
    this.trust(w)
    w.limit = setTimeout(() => this.rangOut(w), RING_LIMIT_MS)
    w.limit.unref?.()
    this.port.add(result.call)
  }

  /** The ring of this page is over (answered elsewhere, declined, caller hung up, page left): the banner goes. */
  private rangOut(w: Watch): void {
    this.clearLimit(w)
    this.clearWaiting(w)
    const gone = this.list.ended(w.host.key)
    if (gone) this.port.remove(gone.id)
    this.drop(w)
  }

  private clearWaiting(w: Watch): void {
    if (w.waiting) clearTimeout(w.waiting.timer)
    w.waiting = undefined
  }

  private clearLimit(w: Watch): void {
    clearTimeout(w.limit)
    w.limit = undefined
  }

  private trust(w: Watch): void {
    if (w.trusted) return
    w.trusted = true
    this.port.trust(w.contents)
  }

  /** Nothing rings or runs on the page: it loses the microphone it was lent. */
  private drop(w: Watch): void {
    if (!w.trusted || w.answered || this.list.has(w.host.key)) return
    w.trusted = false
    if (!w.contents.isDestroyed()) this.port.untrust(w.contents)
  }

  /** The call window as the manager sees it. */
  private handle(w: Watch, answered: Answered): CallHandle {
    const target = (): BrowserWindow | undefined => [...answered.popups.values()].find((p) => !p.isDestroyed()) ?? (w.win.isDestroyed() ? undefined : w.win)
    return {
      close: () => this.finish(w),
      show: () => {
        const win = target()
        if (!win) return
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      },
      minimize: () => target()?.minimize(),
      owns: (contents) => !!contents && !answered.finishing && (contents === w.contents || answered.popups.has(contents)),
      isFrame: () => false,
      onClosed: (handler) => (answered.finishing ? handler() : answered.closedHandlers.push(handler)),
      closed: () => answered.done
    }
  }

  /** Facebook runs an answered call in a popup: it is the call window from now on, and the page's own window steps aside. */
  private popup(w: Watch, child: BrowserWindow): void {
    const answered = w.answered
    if (!answered || answered.finishing) {
      child.destroy()
      return
    }
    const contents = child.webContents
    answered.popups.set(contents, child)
    this.port.trust(contents)
    this.guard(w, contents)
    clearTimeout(answered.goneTimer)
    if (!w.win.isDestroyed()) w.win.hide()
    child.once('closed', () => {
      answered.popups.delete(contents)
      this.port.untrust(contents)
      if (answered.popups.size || answered.finishing) return
      // The call lived in the popup: when it is gone the call is over, unless another popup replaces it right away.
      answered.goneTimer = setTimeout(() => !answered.popups.size && this.finish(w), POPUP_GONE_MS)
    })
  }

  /** What the popup of an answered call may do: look like the page that opened it, stay on the platform's sites, open nothing of its own. */
  private guard(w: Watch, contents: WebContents): void {
    const hosts = PLATFORM_HOSTS[w.host.platform]
    const stay = (url: string): boolean => url === 'about:blank' || url === '' || onDomain(url, hosts)
    // The session's user agent covers the popup's first request; this covers what the page itself asks.
    contents.setUserAgent(w.contents.getUserAgent())
    contents.setWindowOpenHandler(({ url }) => {
      if (!stay(url)) this.port.openExternal(url)
      return { action: 'deny' }
    })
    const block = (event: { preventDefault(): void }, url: string): void => {
      if (stay(url)) return
      event.preventDefault()
      this.port.openExternal(url)
    }
    contents.on('will-navigate', (event, url) => block(event, url))
    contents.on('will-redirect', (event, url) => block(event, url))
  }

  /** The answered call is over (window closed, End pressed, popup gone, page lost): hide the window, put the page back at rest. */
  private finish(w: Watch): void {
    const answered = w.answered
    if (!answered || answered.finishing) return
    answered.finishing = true
    clearTimeout(answered.goneTimer)
    for (const [contents, popup] of answered.popups) {
      this.port.untrust(contents)
      if (!popup.isDestroyed()) popup.destroy()
    }
    answered.popups.clear()
    if (!w.win.isDestroyed()) {
      w.win.hide()
      w.win.setSize(...answered.size)
    }
    w.answered = undefined
    w.host.endCall()
    this.drop(w)
    // Loading its home page drops whatever call was still on the page.
    if (!w.contents.isDestroyed()) void w.contents.loadURL(w.host.homeUrl).catch(() => undefined)
    for (const handler of answered.closedHandlers.splice(0)) handler()
    answered.settle()
  }
}

function makeAnswered(size: [number, number]): Answered {
  let settle: () => void = () => undefined
  const done = new Promise<void>((resolve) => (settle = resolve))
  return { popups: new Map(), size, finishing: false, closedHandlers: [], settle, done }
}
