import type { CallKind } from './target'

/** A control on the page that might start a call, as the collect script saw it. */
export interface ButtonCandidate {
  id: number
  label: string
}

// Words that name a control which is not "start a call": hanging up, answering, the call log.
const NOT_START = /\b(end|hang\s*up|leave|decline|answer|accept|join|history|missed|log|settings)\b|_(end|reject|accept|history)|kết thúc|từ chối|trả lời|tham gia|lịch sử|nhỡ|cài đặt/i
const IS_CALL = /call|gọi/i
const IS_VIDEO = /video/i
const IS_AUDIO = /voice|audio|phone|thoại|điện/i

/**
 * The control to press for `kind`, by its label: an explicit "video" one for video; an explicit voice/audio one for audio,
 * else the only call button that is not the video one (Instagram labels it just "Call" in some locales).
 */
export function pickCallButton(candidates: readonly ButtonCandidate[], kind: CallKind): number | undefined {
  const starts = candidates.filter((c) => IS_CALL.test(c.label) && !NOT_START.test(c.label))
  if (kind === 'video') return starts.find((c) => IS_VIDEO.test(c.label))?.id
  const audio = starts.find((c) => IS_AUDIO.test(c.label) && !IS_VIDEO.test(c.label))
  if (audio) return audio.id
  const plain = starts.filter((c) => !IS_VIDEO.test(c.label))
  return plain.length === 1 ? plain[0]!.id : undefined
}

// Page scripts. They only look and tag; the choice is made above, in the main process, where it can be tested.

/** Tags every visible control whose label mentions calling with data-moshi-call="<n>" and lists them. */
export const COLLECT_SCRIPT = `(() => {
  for (const old of document.querySelectorAll('[data-moshi-call]')) old.removeAttribute('data-moshi-call')
  const found = []
  const seen = new Set()
  const labelOf = (el) => {
    const own = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-translate-title') || ''
    if (own) return own
    const svgTitle = el.querySelector && el.querySelector('svg > title')
    return svgTitle ? svgTitle.textContent || '' : ''
  }
  for (const el of document.querySelectorAll('[aria-label],[title],[data-translate-title],svg')) {
    // Zalo's own buttons carry translation keys (STR_CALL_VOICE) instead of text.
    const label = labelOf(el).trim()
    if (!label || !/call|gọi/i.test(label)) continue
    const target = el.closest('[role="button"],button,a,[tabindex]') || el
    if (seen.has(target)) continue
    const box = target.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    seen.add(target)
    target.setAttribute('data-moshi-call', String(found.length))
    found.push({ id: found.length, label })
  }
  return found
})()`

/** The middle of a tagged control (scrolled into view), for a real mouse click; null when it is gone. */
export const pointScript = (id: number): string => `(() => {
  const el = document.querySelector('[data-moshi-call="${Math.trunc(id)}"]')
  if (!el) return null
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const box = el.getBoundingClientRect()
  return box.width < 1 || box.height < 1 ? null : { x: box.left + box.width / 2, y: box.top + box.height / 2 }
})()`

/** The chat list's search box on Zalo's web app: focused, and its middle returned. */
export const ZALO_SEARCH_SCRIPT = `(() => {
  const input = [...document.querySelectorAll('input')].find((i) => {
    const box = i.getBoundingClientRect()
    const hint = [i.placeholder, i.id, i.getAttribute('data-translate-placeholder'), i.getAttribute('aria-label')].join(' ')
    return box.width > 20 && box.height > 8 && /tìm|search/i.test(hint)
  })
  if (!input) return null
  input.focus()
  const box = input.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
})()`

/** How a name is compared: accents composed, case and runs of spaces ignored. */
export const normalizeName = (name: string): string => name.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

/** A chat in Zalo's list or search results whose own text is the name: where to click, and the `id` / `data-id` of it and its ancestors. */
export interface ChatHit {
  x: number
  y: number
  ids: string[]
}

/** Every visible leaf element in the left half whose own text is exactly `name`. */
export const zaloHitsScript = (name: string): string => `(() => {
  const want = ${JSON.stringify(normalizeName(name))}
  const norm = (t) => t.normalize('NFC').toLowerCase().replace(/\\s+/g, ' ').trim()
  const hits = []
  for (const el of document.querySelectorAll('span,div,p')) {
    if (el.children.length || norm(el.textContent || '') !== want) continue
    const box = el.getBoundingClientRect()
    if (box.width < 1 || box.height < 1 || box.left > window.innerWidth / 2) continue
    const ids = []
    for (let up = el, depth = 0; up && depth < 7; up = up.parentElement, depth++) {
      for (const attr of ['id', 'data-id']) {
        const value = up.getAttribute && up.getAttribute(attr)
        if (value) ids.push(value)
      }
    }
    hits.push({ x: box.left + box.width / 2, y: box.top + box.height / 2, ids })
  }
  return hits
})()`

/** The texts at the top of the open chat (right of the list), nearest the top-left first: the chat's name is among them. */
export const ZALO_HEADER_SCRIPT = `(() => {
  const texts = []
  for (const el of document.querySelectorAll('span,div,p,h1,h2,h3')) {
    if (el.children.length) continue
    const text = (el.textContent || '').trim()
    const box = el.getBoundingClientRect()
    if (!text || box.width < 1 || box.height < 1 || box.top > 90 || box.left < window.innerWidth * 0.3) continue
    texts.push({ text, top: box.top, left: box.left })
  }
  texts.sort((a, b) => a.top - b.top || a.left - b.left)
  return texts.slice(0, 6).map((t) => t.text)
})()`

const carriesId = (ids: readonly string[], threadId: string): boolean => !!threadId && ids.some((id) => id.split(/[^A-Za-z0-9]+/).includes(threadId))

/**
 * The one chat to open from the hits for its name: the one whose element (or an ancestor) carries the thread id; else
 * the only hit. Several hits that cannot be told apart (two people with the same name) give nothing, so nobody is dialled by guess.
 */
export function pickChatHit(hits: readonly ChatHit[], threadId: string): ChatHit | undefined {
  const byId = hits.filter((h) => carriesId(h.ids, threadId))
  if (byId.length) return byId[0]
  return hits.length === 1 ? hits[0] : undefined
}

/** Whether the open chat's header names the chat that was meant, exactly. */
export function headerMatches(texts: readonly string[], name: string): boolean {
  const want = normalizeName(name)
  return !!want && texts.slice(0, 4).some((t) => normalizeName(t) === want)
}

/** What the page shows of a thread's own controls. */
export interface ThreadUi {
  composer: boolean
}

export const THREAD_UI_SCRIPT = `(() => {
  const seen = (el) => { const box = el.getBoundingClientRect(); return box.width > 20 && box.height > 8 }
  return { composer: [...document.querySelectorAll('[role="textbox"],[contenteditable="true"],textarea')].some(seen) }
})()`

/**
 * Whether the page is clearly a thread (its address, and its message composer on screen). Only then does a missing
 * call button count as "this account has no calls"; a slow render, an interstitial or a login page does not.
 */
export function threadUiPresent(url: string, ui: ThreadUi | undefined, pathPrefix: string): boolean {
  try {
    if (!new URL(url).pathname.startsWith(pathPrefix)) return false
  } catch {
    return false
  }
  return !!ui && ui.composer
}
