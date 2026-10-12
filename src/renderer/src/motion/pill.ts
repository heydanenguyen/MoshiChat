import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * The narrow tab bar's pill (idea 10): one layer behind the tabs, cut with `clip-path: inset(0 var(--r) 0 var(--l) round 24px)`.
 * `--l` and `--r` are registered lengths (app.css), so each edge can move on its own spring: the leading edge on a stiff one,
 * the trailing edge on a soft one with a short delay, and the pill stretches, then snaps. Nothing but a clip-path changes, so
 * there is no layout.
 */
export interface Box {
  left: number
  right: number
}

/** How far the pill's left and right edges are cut in so that it covers tab `index`; all boxes in the same coordinates. */
export function pillEdges(tabs: readonly Box[], index: number, pill: Box): { l: number; r: number } {
  const tab = tabs[Math.min(tabs.length - 1, Math.max(0, index))]
  if (!tab) return { l: 0, r: 0 }
  return { l: tab.left - pill.left, r: pill.right - tab.right }
}

/** Which edge leads when moving from tab `from` to tab `to`: the right edge going right, the left going left. */
export function leadingEdge(from: number, to: number): 'l' | 'r' {
  return to > from ? 'r' : 'l'
}

export const TRAIL_DELAY_MS = 40

/**
 * Layout boxes (offsetLeft / offsetWidth, relative to the bar), not painted ones: a tab that is being pressed is drawn at 96% (and
 * tilted), which would leave the pill narrower than the tab for good.
 */
function boxOf(el: HTMLElement): Box {
  return { left: el.offsetLeft, right: el.offsetLeft + el.offsetWidth }
}

const px = (n: number): string => `${Math.round(n * 100) / 100}px`

/** A named spring from the root's custom properties (motion/spring.ts), or an ease when it is not there. */
function spring(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--spring-${name}`).trim() || 'cubic-bezier(0.16, 1, 0.3, 1)'
}

function msOf(name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--spring-${name}-ms`))
  return Number.isFinite(v) ? v : fallback
}

/**
 * Keeps `pill` over the tab at `index` inside `bar` (the buttons are the bar's children that are not the pill). The first
 * placement and a resize jump; a change of `index` stretches (reduced motion: jumps). `keys` re-places it when the set of tabs changes.
 */
export function usePill(bar: RefObject<HTMLElement | null>, pill: RefObject<HTMLElement | null>, index: number, keys: string): void {
  const last = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const b = bar.current
    const p = pill.current
    if (!b || !p) return
    const tabs = [...b.querySelectorAll<HTMLElement>('.narrow-tab')]
    const geom = (i: number): { l: number; r: number } =>
      pillEdges(tabs.map(boxOf), i, boxOf(p))
    const to = geom(index)
    const from = last.current
    last.current = index
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (from === undefined || from === index || reduced) {
      p.getAnimations().forEach((a) => a.cancel())
      p.style.setProperty('--l', px(to.l))
      p.style.setProperty('--r', px(to.r))
      return
    }
    // Start from where the edges are right now (a second tap mid-flight must not jump), then let each go its own way.
    const cs = getComputedStyle(p)
    const now = { l: cs.getPropertyValue('--l').trim() || px(0), r: cs.getPropertyValue('--r').trim() || px(0) }
    p.getAnimations().forEach((a) => a.cancel())
    p.style.setProperty('--l', px(to.l))
    p.style.setProperty('--r', px(to.r))
    // The final values are already on the element, so nothing fills forwards (a finished animation is gone, and a resize can re-place the pill);
    // the trailing edge holds its old place through its delay.
    const lead = { duration: msOf('lead', 280), easing: spring('lead') }
    const trail = { duration: msOf('trail', 460), easing: spring('trail'), delay: TRAIL_DELAY_MS, fill: 'backwards' as const }
    const front = leadingEdge(from, index)
    try {
      p.animate({ ['--l']: [now.l, px(to.l)] } as unknown as Keyframe[], front === 'l' ? lead : trail)
      p.animate({ ['--r']: [now.r, px(to.r)] } as unknown as Keyframe[], front === 'r' ? lead : trail)
    } catch {
      // custom properties cannot be animated here: the pill is already where it should be
    }
  }, [bar, pill, index, keys])
  // The bar changes size with the window: put the pill back over its tab (unless it is on its way there).
  useEffect(() => {
    const b = bar.current
    const p = pill.current
    if (!b || !p || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (p.getAnimations().length) return
      const tabs = [...b.querySelectorAll<HTMLElement>('.narrow-tab')]
      const at = last.current ?? 0
      const e = pillEdges(tabs.map(boxOf), at, boxOf(p))
      p.style.setProperty('--l', px(e.l))
      p.style.setProperty('--r', px(e.r))
    })
    observer.observe(b)
    return () => observer.disconnect()
  }, [bar, pill])
}
