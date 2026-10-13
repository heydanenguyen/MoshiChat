/**
 * Delete dissolve, then collapse (motion idea +24). A taken-back bubble dissolves first; when it becomes the faint "unsent" line the
 * thread closes the gap: the rows that moved (the ones below it, or the ones above when the thread is pinned to its end) slide from
 * where they were to where they are on the settle spring instead of jumping (FLIP, driven by the virtualiser's own re-layout).
 */
import { cssSpring } from './spring'

/** The dissolve, ms (the CSS `bubble-dissolve` keyframes). */
export const DISSOLVE_MS = 220
/** How long after the change the rows are watched: the virtualiser measures the new height a frame or two later. */
export const WATCH_MS = 700

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const watching = new WeakMap<Element, { t0: number }>()

/** The vertical part of a computed `translate` ("none", "0px 12px", "5px"). */
export function translateY(value: string): number {
  const parts = value.trim().split(/\s+/)
  return parts.length > 1 ? parseFloat(parts[1]) || 0 : 0
}

interface Look {
  /** Where it sits without a slide of its own (viewport y; for a bubble inside a run: below the top of that run). */
  rest: number
  /** Where it is drawn. */
  shown: number
}

/**
 * Where a row is. A run (`.chat-row`) is measured in the viewport; a bubble inside it (`.bubble-row`) below the top of its run, so
 * what the run does is not counted twice (the run slides on its own).
 */
function look(el: HTMLElement): Look {
  const own = translateY(getComputedStyle(el).translate)
  const run = el.classList.contains('chat-row') ? undefined : el.closest<HTMLElement>('.chat-row')
  const top = el.getBoundingClientRect().top - (run ? run.getBoundingClientRect().top : 0)
  return { rest: top - own, shown: top }
}

/**
 * Call BEFORE the change reaches the DOM (before the store flips, or while React is still rendering it): it notes where the rows are,
 * then watches them for ~700 ms and slides every one that moves (the virtualiser re-lays out a frame or two after the commit). Reduced
 * motion does nothing (the rows jump). Called again while watching it only extends the watch.
 */
export function armCollapse(scroller: Element | null): void {
  if (!scroller || reduced()) return
  const running = watching.get(scroller)
  if (running) {
    running.t0 = performance.now()
    return
  }
  const state = { t0: performance.now() }
  watching.set(scroller, state)
  const area = scroller.getBoundingClientRect()
  // The runs of messages in view and the bubbles in them (not the ones kept above and below as overscan): when a bubble shrinks,
  // those below it in the same run move too.
  const rows = (): HTMLElement[] =>
    [...scroller.querySelectorAll<HTMLElement>('.chat-row, .chat-row .bubble-row')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.bottom > area.top - 80 && r.top < area.bottom + 80
    })
  // Each one's resting place and where it was drawn (a slide may have been under way) when last looked at.
  const known = new Map<HTMLElement, Look>()
  for (const el of rows()) known.set(el, look(el))
  const spring = cssSpring('settle')
  // Somebody scrolling moves every row for their own reasons: stop watching.
  let touched = false
  const touch = (): void => {
    touched = true
  }
  const inputs = ['wheel', 'pointerdown', 'keydown'] as const
  for (const type of inputs) scroller.addEventListener(type, touch, { passive: true })
  const step = (): void => {
    for (const el of rows()) {
      const now = look(el)
      const was = known.get(el)
      known.set(el, now)
      if (was === undefined || Math.abs(was.rest - now.rest) < 1) continue
      // It moved: it starts the slide from where it was drawn a moment ago and goes to where it is.
      const slide = el.animate({ translate: [`0 ${was.shown - now.rest}px`, '0 0'] }, { duration: 360, easing: spring })
      el.getAnimations().forEach((x) => x !== slide && x.id === 'collapse' && x.cancel())
      slide.id = 'collapse'
    }
  }
  // A change to the thread's markup (React's commit, the virtualiser placing a row) is answered at once, as a microtask, so no
  // frame is painted with the rows already in their new places; the frame loop catches what moves without a markup change (a scroll).
  const mo = new MutationObserver(() => {
    if (!touched) step()
  })
  mo.observe(scroller, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] })
  const frame = (): void => {
    if (touched || !scroller.isConnected || performance.now() - state.t0 > WATCH_MS) {
      for (const type of inputs) scroller.removeEventListener(type, touch)
      mo.disconnect()
      watching.delete(scroller)
      return
    }
    step()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
