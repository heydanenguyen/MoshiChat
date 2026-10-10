import type { WebContents } from 'electron'
import { COLLECT_SCRIPT, THREAD_UI_SCRIPT, pickCallButton, pointScript, threadUiPresent, type ButtonCandidate, type ThreadUi } from '../buttons'
import type { CallWindow } from '../call-window'
import type { CallKind } from '../target'
import type { CallSession, LaunchOutcome } from '../types'

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs `script` in the page until it answers with something (not null/false/empty), for at most `timeoutMs`. */
export async function waitForResult<T>(contents: WebContents, script: string, timeoutMs: number, stepMs = 500): Promise<T | undefined> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (contents.isDestroyed()) return undefined
    try {
      const result = (await contents.executeJavaScript(script, true)) as T | null | false | undefined
      if (result && (!Array.isArray(result) || result.length)) return result
    } catch {
      // the page is between documents: try again
    }
    await sleep(stepMs)
  }
  return undefined
}

/** A real mouse click at a point of the page: the sites ignore (or refuse to open a call popup for) a scripted one. */
export function clickAt(contents: WebContents, point: { x: number; y: number }): void {
  const x = Math.round(point.x)
  const y = Math.round(point.y)
  contents.sendInputEvent({ type: 'mouseMove', x, y })
  contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
}

/** Looks for the call button for `kind` until the timeout and presses it. */
export async function pressCallButton(contents: WebContents, kind: CallKind, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until && !contents.isDestroyed()) {
    const found = await waitForResult<ButtonCandidate[]>(contents, COLLECT_SCRIPT, 1000)
    const id = found ? pickCallButton(found, kind) : undefined
    if (id !== undefined) {
      const point = await waitForResult<{ x: number; y: number }>(contents, pointScript(id), 1000, 100)
      if (point) {
        clickAt(contents, point)
        return true
      }
    }
    await sleep(500)
  }
  return false
}

export interface PageLaunch {
  url: string
  kind: CallKind
  /** How long to look for the button once the page has loaded. */
  lookMs: number
  /** Where a thread's page lives on the site; only there does a missing button count as the site not offering calls. */
  threadPath: string
  /** Said when the thread's page is up but has no call button. */
  missing: string
  /** Said when there is none but the page may just not be ready (slow, an interstitial). */
  unsure: string
  signIn: string
  loadFailed: string
  /** The page the site shows to someone who is not signed in. */
  isLoginPage(url: string): boolean
}

/** Messenger and Instagram: open the chat's page, press the call button, tell the bar how it went. */
export function launchPage(win: CallWindow, launch: PageLaunch, log: (...args: unknown[]) => void): CallSession {
  const settled = (async (): Promise<LaunchOutcome> => {
    await win.load(launch.url)
    if (win.isClosed) return 'skipped'
    if (launch.isLoginPage(win.url)) {
      win.setHint(launch.signIn)
      return 'skipped'
    }
    const pressed = await pressCallButton(win.contents, launch.kind, launch.lookMs)
    if (win.isClosed) return 'skipped'
    if (pressed) {
      win.setHint(undefined)
      return 'clicked'
    }
    // A miss counts only when the thread's own composer is on screen: a slow page or an interstitial proves nothing.
    const ui = await waitForResult<ThreadUi>(win.contents, THREAD_UI_SCRIPT, 1500)
    const sure = !win.isClosed && threadUiPresent(win.url, ui, launch.threadPath)
    if (!win.isClosed) win.setHint(sure ? launch.missing : launch.unsure)
    return sure ? 'not-found' : 'skipped'
  })().catch((err: Error) => {
    log('[call] launch failed:', err.message)
    if (!win.isClosed) win.setHint(launch.loadFailed)
    return 'skipped' as const
  })
  return { end: () => win.close(), onEnded: (handler) => win.onClosed(handler), settled }
}
