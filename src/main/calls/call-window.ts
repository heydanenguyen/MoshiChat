import { join } from 'path'
import { BaseWindow, WebContentsView, session, shell, type NativeImage, type Session, type WebContents } from 'electron'
import { externalUrl } from '../safety'
import { FRAME_IPC, type FrameInfo } from './ipc'
import { onDomain } from './target'
import type { CallHandle } from './types'

/** Height of Moshi's bar (name, clock, minimize, end) over the platform's call page. */
export const FRAME_HEIGHT = 44
/** After the last popup (where Facebook runs a call) closes, how long before the window follows it: the call is over. */
const POPUP_GONE_MS = 2500

export interface CallWindowOptions {
  /** The browser session of the account the call is made with. */
  partition: string
  userAgent: string
  /** The sites the call page may stay on; everything else opens in the system browser. */
  hosts: readonly string[]
  info: FrameInfo
  icon?: NativeImage
  /** The window's own colour until the pages paint. */
  background: string
  log(...args: unknown[]): void
}

/**
 * The call window: Moshi's own bar on top of a view that holds the platform's web page. Facebook runs a call in a popup
 * (/groupcall/ or messenger.com/call): it is adopted as one more view over the page, so the call stays inside this window.
 */
export class CallWindow implements CallHandle {
  private readonly win: BaseWindow
  private readonly frame: WebContentsView
  private readonly page: WebContentsView
  private readonly popups: WebContentsView[] = []
  private readonly ses: Session
  private readonly closedHandlers: Array<() => void> = []
  private info: FrameInfo
  private gone = false
  private popupGoneTimer?: NodeJS.Timeout
  private readonly done: Promise<void>
  private resolveDone: () => void = () => undefined

  constructor(private readonly options: CallWindowOptions) {
    this.info = options.info
    this.done = new Promise((resolve) => (this.resolveDone = resolve))
    this.ses = session.fromPartition(options.partition)
    this.win = new BaseWindow({
      width: 960,
      height: 640,
      minWidth: 480,
      minHeight: 360,
      frame: false,
      resizable: true,
      show: false,
      title: `${options.info.name} - Moshi`,
      icon: options.icon,
      backgroundColor: options.background
    })
    this.page = new WebContentsView({
      webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' }
    })
    this.frame = new WebContentsView({
      webPreferences: { preload: join(__dirname, '../preload/call-frame.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.frame.setBackgroundColor(options.background)
    this.page.setBackgroundColor('#ffffff')
    this.win.contentView.addChildView(this.page)
    this.win.contentView.addChildView(this.frame)
    this.guard(this.page.webContents)
    this.page.webContents.setUserAgent(options.userAgent)
    this.page.webContents.on('render-process-gone', (_e, details) => options.log('[call] page process gone:', details.reason))
    this.frame.webContents.on('did-finish-load', () => this.pushInfo())
    // Moshi's own bar shows nothing but itself: no popups, no navigating away.
    this.frame.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.frame.webContents.on('will-navigate', (event) => event.preventDefault())
    const relayout = (): void => this.layout()
    this.win.on('resize', relayout)
    this.win.on('maximize', relayout)
    this.win.on('unmaximize', relayout)
    this.win.on('enter-full-screen', relayout)
    this.win.on('leave-full-screen', relayout)
    this.win.on('closed', () => this.dispose())
    this.layout()
    if (process.env.ELECTRON_RENDERER_URL) void this.frame.webContents.loadURL(new URL('call.html', process.env.ELECTRON_RENDERER_URL).href)
    else void this.frame.webContents.loadFile(join(__dirname, '../renderer/call.html'))
    this.win.show()
  }

  /** The platform's page (the call buttons are on this one). */
  get contents(): WebContents {
    return this.page.webContents
  }

  get url(): string {
    return this.contents.getURL()
  }

  get isClosed(): boolean {
    return this.gone
  }

  /** Whether a page is the platform's page of this window or a popup of it (what a call's camera and microphone are for). */
  owns(contents: WebContents | null): boolean {
    return !!contents && !this.gone && (contents === this.page.webContents || this.popups.some((popup) => popup.webContents === contents))
  }

  /** Whether `sender` is this window's bar (IPC from it may end the call). */
  isFrame(sender: WebContents): boolean {
    return !this.gone && sender === this.frame.webContents
  }

  /** Loads a page and waits for it. A navigation the site itself redirected away from is not a failure. */
  async load(url: string): Promise<void> {
    try {
      await this.contents.loadURL(url)
    } catch (err) {
      if (this.gone || this.contents.isDestroyed()) return
      if (!/ERR_ABORTED/.test((err as Error).message)) throw err
    }
  }

  /** Changes the line the bar shows in place of the platform's name; undefined puts the name back. */
  setHint(hint?: string): void {
    this.info = { ...this.info, hint }
    this.pushInfo()
  }

  show(): void {
    if (this.gone) return
    if (this.win.isMinimized()) this.win.restore()
    this.win.show()
    this.win.focus()
  }

  minimize(): void {
    if (!this.gone) this.win.minimize()
  }

  onClosed(handler: () => void): void {
    if (this.gone) handler()
    else this.closedHandlers.push(handler)
  }

  closed(): Promise<void> {
    return this.done
  }

  close(): void {
    if (!this.gone && !this.win.isDestroyed()) this.win.close()
  }

  private pushInfo(): void {
    const { webContents } = this.frame
    if (this.gone || webContents.isDestroyed() || webContents.isLoading()) return
    webContents.send(FRAME_IPC.state, this.info)
  }

  private layout(): void {
    if (this.gone || this.win.isDestroyed()) return
    const { width, height } = this.win.getContentBounds()
    this.frame.setBounds({ x: 0, y: 0, width, height: Math.min(FRAME_HEIGHT, height) })
    const body = { x: 0, y: FRAME_HEIGHT, width, height: Math.max(0, height - FRAME_HEIGHT) }
    this.page.setBounds(body)
    for (const popup of this.popups) popup.setBounds(body)
  }

  /** What a page of this window may do: stay on the platform's sites, take its call popup in, send the rest to the browser. */
  private guard(contents: WebContents): void {
    const stay = (url: string): boolean => url === 'about:blank' || url === '' || onDomain(url, this.options.hosts)
    const leave = (url: string): void => {
      const safe = externalUrl(url)
      if (safe) void shell.openExternal(safe)
    }
    contents.setWindowOpenHandler(({ url }) => {
      if (!stay(url)) {
        leave(url)
        return { action: 'deny' }
      }
      // Electron hands over the popup's own, not yet shown, page here (its typings do not list it).
      return { action: 'allow', createWindow: (opened) => this.adopt((opened as { webContents?: WebContents }).webContents) }
    })
    const block = (event: { preventDefault(): void }, url: string): void => {
      if (stay(url)) return
      event.preventDefault()
      leave(url)
    }
    contents.on('will-navigate', (event, url) => block(event, url))
    contents.on('will-redirect', (event, url) => block(event, url))
  }

  /** The popup becomes a view over the page. It keeps its link to the opener (the call page talks to it). */
  private adopt(opened: WebContents | undefined): WebContents {
    const view = new WebContentsView({ webContents: opened })
    this.popups.push(view)
    clearTimeout(this.popupGoneTimer)
    this.win.contentView.addChildView(view)
    this.guard(view.webContents)
    view.webContents.setUserAgent(this.options.userAgent)
    this.page.setVisible(false)
    this.layout()
    view.webContents.once('destroyed', () => {
      this.popups.splice(this.popups.indexOf(view), 1)
      if (this.gone || this.win.isDestroyed()) return
      this.win.contentView.removeChildView(view)
      if (this.popups.length) return
      this.page.setVisible(true)
      // The call lived in the popup: when it is gone the call is over, unless another one replaces it right away.
      this.popupGoneTimer = setTimeout(() => !this.popups.length && this.close(), POPUP_GONE_MS)
    })
    return view.webContents
  }

  private dispose(): void {
    this.gone = true
    clearTimeout(this.popupGoneTimer)
    // A closed window does not close its views' pages: left alone they would go on running (and keep the camera open).
    for (const view of [...this.popups, this.page, this.frame]) {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    for (const handler of this.closedHandlers.splice(0)) handler()
    this.resolveDone()
  }
}
