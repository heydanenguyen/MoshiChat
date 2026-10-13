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
