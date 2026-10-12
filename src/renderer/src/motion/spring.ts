import type { StyleId } from '@shared/types'

/**
 * A real damped spring, sampled into a CSS `linear()` easing (the maths of design/proposals/2026-10-13-motion-ideas.html).
 * `settleMs` is when the curve is within 0.5% of its target, `overshoot` the fraction of the travel it goes past the target
 * (already scaled by the style's bounce). 0 gives a critically damped curve that never overshoots.
 */
const cache = new Map<string, string>()

/** For tests: how many curves are cached. */
export const springCacheSize = (): number => cache.size

export function springEasing(settleMs: number, overshoot: number): string {
  const os = Math.min(0.5, Math.max(0, Number.isFinite(overshoot) ? overshoot : 0))
  const dur = Math.max(1, settleMs)
  const key = `${dur}|${os.toFixed(3)}`
  const hit = cache.get(key)
  if (hit) return hit
  // Damping ratio from the overshoot (a damping ratio of 1 and above has none).
  let z = 1
  if (os >= 0.002) {
    const l = Math.log(os)
    z = -l / Math.sqrt(Math.PI * Math.PI + l * l)
  }
  const seconds = dur / 1000
  const w0 = (z >= 1 ? 7.4 : 5.3) / (Math.min(z, 1) * seconds)
  const at = (t: number): number => {
    if (z >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
    const wd = w0 * Math.sqrt(1 - z * z)
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
  }
  const n = Math.max(24, Math.ceil(dur / 12))
  const points: number[] = []
  for (let i = 0; i <= n; i++) points.push(+at((i / n) * seconds).toFixed(4))
  points[0] = 0
  points[n] = 1
  const css = `linear(${points.join(', ')})`
  cache.set(key, css)
  return css
}

/** Each spring the renderer uses: its name, how long it takes to settle and how far it overshoots at bounce 1. */
const SPRINGS: Array<{ name: string; ms: number; overshoot: number }> = [
  { name: 'pop', ms: 320, overshoot: 0.25 }, // a sent message pops (idea 1)
  { name: 'settle', ms: 360, overshoot: 0.06 }, // rows making room, FLIP
  { name: 'arrive', ms: 300, overshoot: 0.2 }, // a message arriving (idea 2)
  { name: 'soft', ms: 280, overshoot: 0.12 }, // general
  { name: 'exhale', ms: 360, overshoot: 0.2 }, // the composer breathing out after a send
  { name: 'sticker', ms: 440, overshoot: 0.3 }, // a sticker's twist as it lands
  { name: 'pane', ms: 280, overshoot: 0.12 }, // the Details pane sliding in (idea 8)
  { name: 'paneout', ms: 280, overshoot: 0.08 }, // ... and out
  // pack 2 A
  { name: 'pill', ms: 380, overshoot: 0.3 }, // a reaction pill scaling in from the tap (idea 3)
  { name: 'rise', ms: 560, overshoot: 0.1 }, // a chat rising to the top of the list (idea 11)
  { name: 'part', ms: 420, overshoot: 0.06 }, // the rows it passes parting
  { name: 'dot', ms: 450, overshoot: 0.25 }, // the unread dot popping once the row has settled
  // pack 2 C (island)
  { name: 'isl-grow', ms: 380, overshoot: 0.16 }, // the call pill growing: width
  { name: 'isl-grow-h', ms: 380, overshoot: 0.22 }, // ... height
  { name: 'isl-shrink', ms: 380, overshoot: 0.08 }, // shrinking: width
  { name: 'isl-shrink-h', ms: 380, overshoot: 0.1 }, // ... height
  { name: 'isl-radius', ms: 380, overshoot: 0.12 }, // corner radius
]

/** The CSS custom properties for the root: `--spring-<name>` (a linear() easing) and `--spring-<name>-ms` (its duration). */
export function springVars(bounce: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of SPRINGS) {
    out[`--spring-${s.name}`] = springEasing(s.ms, s.overshoot * bounce)
    out[`--spring-${s.name}-ms`] = `${s.ms}ms`
  }
  return out
}

/** How much each style bounces (1 = the demo's default): one place to change it. */
export function bounceOf(style: StyleId | undefined): number {
  switch (style) {
    case 'mono':
      return 0
    case 'liquid':
    case 'pals':
    case 'moshi':
    default:
      return 1
  }
}
