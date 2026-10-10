import { randomBytes } from 'node:crypto'
import type { WebContents } from 'electron'
import { clickAt, sleep } from './launchers/common'

/**
 * What the page prints (console.log) so the main process can hear it: no preload, no polling; the cheapest line from a sandboxed page.
 * Each watch makes up its own random prefix (`newRingPrefix`), so a page that prints lines of its own cannot pass for the script.
 */
export const RING_PREFIX = '__moshi_ring_'

export const newRingPrefix = (): string => `${RING_PREFIX}${randomBytes(8).toString('hex')}__`

export type RingEvent = { kind: 'ring'; callId: string; peerName: string; video: boolean } | { kind: 'ended' }

const WHO: RegExp[] = [
  /^(.{1,80}?)\s+(?:is\s+)?(?:video\s+|voice\s+|audio\s+)?calling\b/i,
  /^(.{1,80}?)\s+đang\s+gọi/i,
  /(?:incoming\s+(?:video\s+|voice\s+|audio\s+)?call\s+from|cuộc\s+gọi(?:\s+video|\s+thoại)?\s+đến\s+từ)\s+(.{1,80})$/i
]
/** Words of the dialog's own chrome: a text with one of them is not a person's name. */
const CHROME =
  /\b(incoming|calling|ringing|video|voice|audio|call|answer|accept|decline|messenger|instagram|facebook|meta)\b|cuộc gọi|đang gọi|gọi (video|thoại)|trả lời|chấp nhận|từ chối/i

const tidy = (name: string): string => name.replace(/[\s.:!,-]+$/, '').replace(/^[\s.:!,-]+/, '')

/** The caller's name out of the dialog's texts ("Lan is calling you", "Incoming call from Lan", or just the name on its own line). */
export function pickPeerName(texts: readonly string[]): string {
  for (const text of texts) {
    for (const re of WHO) {
      const found = re.exec(text.trim())?.[1]
      if (found && !CHROME.test(tidy(found))) return tidy(found)
    }
  }
  for (const text of texts) {
    const name = tidy(text.trim())
    if (name && name.length <= 80 && !CHROME.test(name) && /[\p{L}\p{N}]/u.test(name)) return name
  }
  return ''
}

/** A video call, going by the dialog's own words (the Answer button saying "with video" does not count: it is not one of the texts). */
export const isVideoRing = (texts: readonly string[]): boolean => texts.some((t) => /video/i.test(t))

/**
 * One event the page printed, as JSON: `{kind:'ring', callId, texts}` (the dialog's loose texts; the name and the kind are
 * worked out here, where they can be tested), or `{kind:'ended'}`. A `peerName`/`video` the page already worked out wins.
 * Anything else (the page can print what it likes) is nothing.
 */
export function parseRingEvent(json: string): RingEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const v = value as { kind?: unknown; callId?: unknown; texts?: unknown; peerName?: unknown; video?: unknown }
  if (v.kind === 'ended') return { kind: 'ended' }
  if (v.kind !== 'ring' || typeof v.callId !== 'string' || !/^[\w-]{1,64}$/.test(v.callId)) return undefined
  const texts = Array.isArray(v.texts) ? v.texts.filter((t): t is string => typeof t === 'string').slice(0, 20).map((t) => t.slice(0, 120)) : []
  const named = typeof v.peerName === 'string' ? tidy(v.peerName.slice(0, 80)) : ''
  return { kind: 'ring', callId: v.callId, peerName: named || pickPeerName(texts), video: typeof v.video === 'boolean' ? v.video : isVideoRing(texts) }
}

/** A console line of the page: an event only when it carries the prefix. */
export function ringEventFromConsole(message: string, prefix: string): RingEvent | undefined {
  return message.startsWith(prefix) ? parseRingEvent(message.slice(prefix.length)) : undefined
}

/**
 * Installed in the page after every load (once: it keeps `window.__moshiRing`). A MutationObserver (settled 400 ms, plus a
 * 3 s safety check) looks for a ringing dialog: a control named Answer/Accept (Trả lời, Chấp nhận) and one named Decline
 * (Từ chối) that share a small container (at most 600 characters, the dialog if there is one) whose text speaks of a call
 * (`call` / `gọi`). That is told once as `ring`; when it has been gone for 600 ms, once as `ended`. The two controls
 * are tagged `data-moshi-ring="answer"|"decline"` for the clicks below.
 */
export const ringScript = (prefix: string): string => String.raw`(() => {
  if (window.__moshiRing) return
  const PREFIX = ${JSON.stringify(prefix)}
  const log = console.log.bind(console)
  const say = (o) => { try { log(PREFIX + JSON.stringify(o)) } catch (e) {} }
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
  const ANSWER = ['answer', 'accept', 'trả lời', 'chấp nhận']
  const DECLINE = ['decline', 'từ chối']
  const named = (label, words) => words.some((w) => label === w || label.startsWith(w + ' '))
  const labelOf = (el) => norm(el.getAttribute('aria-label') || el.textContent)
  const shown = (el) => { const b = el.getBoundingClientRect(); return b.width > 1 && b.height > 1 }
  const press = (el) => el.closest('[role="button"],button,[tabindex]') || el
  const find = () => {
    const answers = []
    const declines = []
    for (const el of document.querySelectorAll('[aria-label],button,[role="button"]')) {
      if (el.children.length > 8) continue
      const label = labelOf(el)
      if (!label || label.length > 40) continue
      if (named(label, ANSWER)) answers.push(el)
      else if (named(label, DECLINE)) declines.push(el)
    }
    if (!answers.length || !declines.length) return null
    for (const a of answers) {
      for (let up = a.parentElement, depth = 0; up && depth < 8; up = up.parentElement, depth++) {
        const d = declines.find((x) => up.contains(x))
        if (!d) continue
        const box = up.closest('[role="dialog"],[role="alertdialog"]') || up
        const text = norm(box.textContent) + ' ' + norm(box.getAttribute('aria-label'))
        if (text.length > 600 || !/call|gọi/.test(text) || !shown(a) || !shown(d)) break
        for (const old of document.querySelectorAll('[data-moshi-ring]')) old.removeAttribute('data-moshi-ring')
        const answer = press(a)
        const decline = press(d)
        answer.setAttribute('data-moshi-ring', 'answer')
        decline.setAttribute('data-moshi-ring', 'decline')
        return { box, answer, decline }
      }
    }
    return null
  }
  const textsOf = (f) => {
    const out = []
    const own = f.box.getAttribute('aria-label')
    if (own) out.push(own)
    for (const el of f.box.querySelectorAll('*')) {
      if (el.children.length || f.answer.contains(el) || f.decline.contains(el)) continue
      const t = (el.textContent || '').trim()
      if (t && t.length <= 120 && !out.includes(t)) out.push(t)
      if (out.length >= 20) break
    }
    return out
  }
  let current = null
  let goneSince = 0
  let timer = 0
  const check = () => {
    const f = find()
    if (f) {
      goneSince = 0
      if (!current) {
        current = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
        say({ kind: 'ring', callId: current, texts: textsOf(f) })
      }
      return
    }
    if (!current) return
    const now = Date.now()
    if (!goneSince) goneSince = now
    if (now - goneSince < 600) { setTimeout(check, 650); return }
    current = null
    goneSince = 0
    say({ kind: 'ended' })
  }
  const poke = () => {
    if (timer) return
    timer = setTimeout(() => { timer = 0; check() }, 400)
  }
  new MutationObserver(poke).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'hidden'] })
  setInterval(check, 3000)
  window.__moshiRing = { find, check }
  check()
})()`

export type RingButton = 'answer' | 'decline'

const buttonOf = (which: RingButton, body: string): string => `(() => {
  const f = window.__moshiRing && window.__moshiRing.find()
  if (!f) return null
  const el = f[${JSON.stringify(which)}]
  ${body}
})()`

/** The middle of the dialog's Answer / Decline control, for a real mouse click; null when there is no ringing dialog. */
export const ringPointScript = (which: RingButton): string =>
  buttonOf(which, `el.scrollIntoView({ block: 'center', inline: 'center' })
  const b = el.getBoundingClientRect()
  return b.width < 1 || b.height < 1 ? null : { x: b.left + b.width / 2, y: b.top + b.height / 2 }`)

/** A scripted click on it (what Decline uses: the hidden window has nothing to point at). */
export const ringClickScript = (which: RingButton): string => buttonOf(which, 'el.click()\n  return true')

/** Whether a ringing dialog is up right now. */
export const RING_ACTIVE_SCRIPT = '!!(window.__moshiRing && window.__moshiRing.find())'

export interface RingWatch {
  /** Presses Answer (a real click, for a window that is on screen) or Decline (a scripted one); false when there is no dialog to press. */
  press(which: RingButton): Promise<boolean>
  dispose(): void
}

/**
 * Listens to a page for ringing calls: the script goes in after every load, the page's console lines come back as events.
 * A page that leaves for another address is not ringing any more (`ended`).
 */
export function watchRing(contents: WebContents, onEvent: (event: RingEvent) => void, log: (...args: unknown[]) => void): RingWatch {
  const prefix = newRingPrefix()
  const script = ringScript(prefix)
  const inject = (): void => {
    if (!contents.isDestroyed()) void contents.executeJavaScript(script).catch((err: Error) => log('[call] ring script failed:', err.message))
  }
  const onMessage = (details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>): void => {
    // Only the page itself (a message that does not say where it came from is refused too): a frame inside it could print the same line.
    if (!details.frame || details.frame.parent) return
    const event = ringEventFromConsole(details.message, prefix)
    if (event) onEvent(event)
  }
  const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    if (details.isMainFrame && !details.isSameDocument) onEvent({ kind: 'ended' })
  }
  contents.on('console-message', onMessage)
  contents.on('did-start-navigation', onNavigate)
  contents.on('dom-ready', inject)
  if (!contents.isLoading() && contents.getURL()) inject()

  const run = <T>(script: string): Promise<T | null> => contents.executeJavaScript(script, true).then((r: T | null | undefined) => r ?? null, () => null)
  return {
    async press(which) {
      if (contents.isDestroyed()) return false
      if (which === 'answer') {
        const point = await run<{ x: number; y: number }>(ringPointScript(which))
        if (point) {
          clickAt(contents, point)
          // A click that was not heard (window not focused yet): the dialog is still up a moment later, so click it with a script too.
          await sleep(1500)
          if (contents.isDestroyed() || !(await run<boolean>(RING_ACTIVE_SCRIPT))) return true
        }
      }
      return (await run<boolean>(ringClickScript(which))) === true
    },
    dispose() {
      if (contents.isDestroyed()) return
      contents.off('console-message', onMessage)
      contents.off('did-start-navigation', onNavigate)
      contents.off('dom-ready', inject)
    }
  }
}
