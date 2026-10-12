/**
 * Mascot behaviours of the Pals cast (motion idea 14): eyes that follow the pointer, a hop when a message arrives in the
 * open chat, the idle blink and glance, and falling asleep in the empty state. The pure parts (odds, offsets, timing, which
 * messages count) are unit-tested; the DOM part at the bottom is one pointer listener shared by every mascot on screen.
 * It is on for the Pals look (its cast of pals), and for a Pals logo in any look (see `mascotOn`); everything else keeps the
 * existing blink and glance.
 */

/** No pointer or key for this long and the empty-state pals fall asleep. */
export const sleepAfterMs = 30_000
/** Eyes follow the pointer by at most this many screen px. */
export const LOOK_MAX = 4
/** A pointer farther than this from the eyes looks at its full ±4 px. */
const LOOK_FULL_AT = 140
/** The eyes go back to the middle when the pointer has been still this long. */
export const LOOK_REST_MS = 6000
/** One hop per this long. */
export const HOP_GAP_MS = 1500
export const HOP_MS = 560

/** Is the chosen logo one of the Pals (`pal-<cast id>`)? */
export function isPalLogo(logo: string | undefined): boolean {
  return typeof logo === 'string' && logo.startsWith('pal-')
}

/**
 * Do the mascot behaviours run? In the Pals look (whatever the logo: the cast itself is the mascot) and with a Pals logo in
 * any look. Moshi, Liquid and Mono with the Buddies, or any other classic logo, keep only the existing blink and glance.
 */
export function mascotOn(style: string | undefined, logo: string | undefined): boolean {
  return style === 'pals' || isPalLogo(logo)
}

/** Where the peek is in its life (out: not drawn, in: slid down, leaving: slipping back) and what the ring does to it. */
export type PeekPhase = 'out' | 'in' | 'leaving'

export function peekStep(phase: PeekPhase, ringing: boolean, on: boolean, reducedMotion: boolean): PeekPhase {
  if (ringing && on && !reducedMotion) return 'in'
  return phase === 'in' ? 'leaving' : phase
}

export type IdleAct = 'blink' | 'glance' | 'none'

export interface IdleState {
  sleeping: boolean
  /** The pointer moved lately and the eyes are following it (a glance would fight that). */
  following: boolean
}

/**
 * What the mascot does next and how long to wait after it. The demo's odds: three times in ten it glances aside
 * (unless the eyes are already following the pointer), otherwise it blinks; asleep it does nothing. 2.6-5.6 s apart.
 */
export function nextIdleAct(rng: () => number, state: IdleState): { act: IdleAct; afterMs: number } {
  const roll = rng()
  const afterMs = 2600 + rng() * 3000
  if (state.sleeping) return { act: 'none', afterMs }
  if (roll < 0.3) return { act: state.following ? 'none' : 'glance', afterMs }
  return { act: 'blink', afterMs }
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where the pupils sit for a pointer at (x, y): toward it, at most `max` px, easing in over the first 140 px so a pointer
 * right on top of the eyes does not make them jump. Screen px; the caller converts to the drawing's units.
 */
export function pupilOffset(pointer: { x: number; y: number }, eyeRect: Rect, max = LOOK_MAX): { x: number; y: number } {
  const cx = eyeRect.left + eyeRect.width / 2
  const cy = eyeRect.top + eyeRect.height / 2
  const dx = pointer.x - cx
  const dy = pointer.y - cy
  const d = Math.hypot(dx, dy)
  if (d < 0.5) return { x: 0, y: 0 }
  const k = Math.min(1, d / LOOK_FULL_AT)
  return { x: (dx / d) * max * k, y: (dy / d) * max * k }
}

/** Has it been quiet long enough to sleep? */
export function isSleepy(lastActivity: number, now: number, after = sleepAfterMs): boolean {
  return now - lastActivity >= after
}

/** May a hop play now? (one per 1.5 s) */
export function hopAllowed(now: number, previous: number): boolean {
  return now - previous >= HOP_GAP_MS
}

export interface MessageLike {
  id: string
  isOutgoing: boolean
  sentAt: number
  /** A notice (a call ended, someone joined): not a message that arrives. */
  system?: unknown
}

/**
 * Does an incoming message sit after `lastId` in the thread? Our own sends do not count, nor do old ones (a chat that
 * was just opened, or history loading in), nor notices (system rows), nor a thread we have no earlier mark for (the first look
 * at it: `undefined`). `null` = the thread was loaded and empty, so the first message into it counts.
 */
export function incomingSince(lastId: string | null | undefined, messages: readonly MessageLike[], now: number, freshMs = 3000): boolean {
  if (lastId === undefined) return false
  const at = lastId === null ? -1 : messages.findIndex((m) => m.id === lastId)
  if (at < 0 && lastId !== null) return false
  for (let i = at + 1; i < messages.length; i++) {
    const m = messages[i]
    if (!m.isOutgoing && !m.system && now - m.sentAt < freshMs) return true
  }
  return false
}

/** The hop (the demo's keyframes): up 14 px stretched, down squashed, rest. */
export function hopKeyframes(): Keyframe[] {
  return [
    { translate: '0 0', scale: '1 1', easing: 'cubic-bezier(.2,.7,.3,1)' },
    { translate: '0 -14px', scale: '.95 1.07', offset: 0.38, easing: 'cubic-bezier(.6,0,.9,.5)' },
    { translate: '0 0', scale: '1.08 .92', offset: 0.72, easing: 'ease-out' },
    { translate: '0 0', scale: '1 1' }
  ]
}

/** The peek's wobble: two swings of ±7° after the slide in. */
export const PEEK_WOBBLE = [0, -7, 7, -7, 0].map((deg) => ({ rotate: `${deg}deg` }))
export const PEEK_RETREAT_MS = 260

const reduced = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------------------------------------------------------------- hop (an event the sidebar logo listens to)

const hopListeners = new Set<() => void>()
let lastHop = -Infinity

/** Something arrived in the open chat: the mascots on screen hop (at most once per 1.5 s, never under reduced motion). */
export function hopMascot(now = performance.now()): boolean {
  if (reduced() || !hopAllowed(now, lastHop)) return false
  lastHop = now
  hopListeners.forEach((fn) => fn())
  return true
}

export function onMascotHop(fn: () => void): () => void {
  hopListeners.add(fn)
  return () => void hopListeners.delete(fn)
}

/** For tests. */
export function resetMascot(): void {
  lastHop = -Infinity
  hopListeners.clear()
}

// ---------------------------------------------------------------- eyes following the pointer

interface Watch {
  root: Element
  selector: string
  visible: boolean
}

const watches = new Set<Watch>()
const current = new WeakMap<Element, { x: number; y: number }>()
let pointer: { x: number; y: number } | undefined
let movedAt = 0
let frame = 0
let rest = 0
let io: IntersectionObserver | undefined

/** Has the pointer moved lately (so the eyes follow it)? */
export function isFollowing(now = performance.now()): boolean {
  return !!pointer && now - movedAt < LOOK_REST_MS
}

function setLook(el: Element, px: { x: number; y: number }, unit: number): void {
  current.set(el, px)
  const style = (el as SVGElement).style
  style.setProperty('--look-x', `${(px.x * unit).toFixed(2)}px`)
  style.setProperty('--look-y', `${(px.y * unit).toFixed(2)}px`)
}

/** Screen px -> units of the group's parent (the face is scaled inside the drawing). */
function unitOf(el: Element): number {
  const m = (el.parentNode as SVGGraphicsElement | null)?.getScreenCTM?.()
  const scale = m ? Math.hypot(m.a, m.b) : 1
  return scale > 0 ? 1 / scale : 1
}

function apply(): void {
  frame = 0
  if (!pointer) return
  // Read every rect first, then write: a write between two reads would force a style recalculation per eye.
  const moves: Array<{ el: Element; px: { x: number; y: number }; unit: number }> = []
  for (const w of watches) {
    if (!w.visible) continue
    // ±4 px, but a small mark (the 30 px sidebar logo) would pop its eyes out of its face: 7 % of its width at most.
    const max = Math.min(LOOK_MAX, Math.max(1, w.root.getBoundingClientRect().width * 0.07))
    w.root.querySelectorAll(w.selector).forEach((el) => {
      const was = current.get(el) ?? { x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      // The rect includes the offset it already has: take that out, or the eyes would chase themselves.
      moves.push({ el, px: pupilOffset(pointer!, { left: r.left - was.x, top: r.top - was.y, width: r.width, height: r.height }, max), unit: unitOf(el) })
    })
  }
  for (const m of moves) setLook(m.el, m.px, m.unit)
}

/** Eyes back to the middle (the pointer left, went still, or the mascot fell asleep). */
export function centerEyes(): void {
  pointer = undefined
  for (const w of watches) w.root.querySelectorAll(w.selector).forEach((el) => setLook(el, { x: 0, y: 0 }, 1))
}

function onMove(e: PointerEvent): void {
  if (document.hidden || reduced()) return
  pointer = { x: e.clientX, y: e.clientY }
  movedAt = performance.now()
  if (!frame) frame = requestAnimationFrame(apply)
  clearTimeout(rest)
  rest = window.setTimeout(centerEyes, LOOK_REST_MS)
}

function listen(on: boolean): void {
  if (on) {
    document.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', centerEyes)
  } else {
    document.removeEventListener('pointermove', onMove)
    document.documentElement.removeEventListener('pointerleave', centerEyes)
    cancelAnimationFrame(frame)
    clearTimeout(rest)
    frame = 0
  }
}

/**
 * Make the eyes inside `root` (elements matching `selector`) follow the pointer while `root` is on screen and the window is
 * not hidden. One pointermove listener serves every watcher, throttled to a frame. Returns the way to stop.
 */
export function watchEyes(root: Element, selector: string): () => void {
  if (reduced()) return () => undefined
  const watch: Watch = { root, selector, visible: true }
  if (!watches.size) listen(true)
  watches.add(watch)
  if (typeof IntersectionObserver !== 'undefined') {
    io ??= new IntersectionObserver((entries) => {
      for (const entry of entries) for (const w of watches) if (w.root === entry.target) w.visible = entry.isIntersecting
    })
    io.observe(root)
  }
  return () => {
    watches.delete(watch)
    io?.unobserve(root)
    root.querySelectorAll(selector).forEach((el) => setLook(el, { x: 0, y: 0 }, 1))
    if (!watches.size) listen(false)
  }
}

/** A short look aside (a glance) of `px` screen px; the eyes come back by themselves unless the pointer has taken over. */
export function glanceEyes(root: Element, selector: string, px: number, ms = 900): void {
  root.querySelectorAll(selector).forEach((el) => {
    setLook(el, { x: px, y: 0 }, unitOf(el))
    setTimeout(() => {
      if (!isFollowing() && el.isConnected) setLook(el, { x: 0, y: 0 }, 1)
    }, ms)
  })
}
