/**
 * Swipe to reply (motion idea +22). Dragging a bubble to the right moves it on a rubber band; past the threshold the reply
 * icon snaps and letting go replies; the bubble springs back. Everything here is transform (`translate`) and opacity.
 */
import { cssSpring } from './spring'

/** How far the bubble can be pulled at most, and how far it must be pulled to reply (px). */
export const MAX = 96
export const TH = 46
/** Horizontal movement that starts a swipe, and vertical drift that gives it up for scrolling (px). */
export const START_DX = 8
export const CANCEL_DY = 12
/** Reduced motion: no rubber band, a plain drag this far still replies. */
export const PLAIN_REPLY_DX = 40

export type SwipeState = 'pending' | 'swiping' | 'cancelled'

/** The rubber band: the bubble follows the pointer less and less, never past `max`. */
export function rubber(d: number, max = MAX): number {
  if (!(d > 0) || !(max > 0)) return 0
  return max * (1 - Math.exp(-d / max))
}

/**
 * What a pointer movement of (dx, dy) from where it went down means. A drift of more than 12 px up or down before 8 px to the
 * right gives the gesture back to scrolling; going left is not a swipe either. Once decided it stays decided.
 */
export function swipeDecision(dx: number, dy: number, state: SwipeState): SwipeState {
  if (state !== 'pending') return state
  if (dx >= START_DX) return 'swiping'
  if (dx <= -START_DX || Math.abs(dy) > CANCEL_DY) return 'cancelled'
  return 'pending'
}

/** The reply icon's opacity and scale for a bubble pulled `x` px: it grows in over the threshold. */
export function iconLook(x: number): { opacity: number; scale: number } {
  const p = Math.max(0, Math.min(1, x / TH))
  return { opacity: p, scale: 0.4 + 0.6 * p }
}

/**
 * Which pointers swipe: a finger or a pen. A mouse drag on a bubble selects its text, as it always did (a mouse has the reply
 * button in the bar and the R key).
 */
export function swipeAllowed(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen'
}

const reduced = (): boolean => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** What a touch that starts on these keeps (links, buttons, players, text fields). */
const KEEPS_THE_POINTER = 'a, button, audio, input, textarea, select, [contenteditable="true"]'
/** The animations this gesture owns (the bubble also has a scroll-driven edge fade that must not be cancelled). */
const MINE = 'swipe'

export interface SwipeOptions {
  /** The bubble that is dragged. */
  bubble: HTMLElement
  /** What moves with it (the bubble and its reactions). */
  stack: HTMLElement
  /** The row it sits in: gets `swiping` while pulled. */
  row: HTMLElement
  /** The reply icon revealed behind it. */
  icon: HTMLElement
  /** Called when the bubble is let go past the threshold (or R is pressed). */
  reply(): void
}

/** Wires the gesture onto a bubble. Returns what undoes it. */
export function attachSwipe(o: SwipeOptions): () => void {
  const { bubble, stack, row, icon } = o
  let id = -1
  let sx = 0
  let sy = 0
  let state: SwipeState = 'pending'
  let x = 0
  let passed = false
  let quiet = false
  let moved = false

  const tag = (a: Animation): Animation => {
    a.id = MINE
    return a
  }

  const paint = (v: number): void => {
    x = v
    stack.style.translate = v ? `${v}px 0` : ''
    const look = iconLook(v)
    icon.style.opacity = String(look.opacity)
    icon.style.scale = look.scale.toFixed(3)
    if (v >= TH && !passed) {
      passed = true
      if (!quiet) tag(icon.animate({ scale: [1.3, 1] }, { duration: 260, easing: cssSpring('tick') }))
      navigator.vibrate?.(8)
    } else if (v < TH - 6) passed = false
  }

  const reset = (): void => {
    stack.style.translate = ''
    icon.style.opacity = ''
    icon.style.scale = ''
    row.classList.remove('swiping')
  }

  const finish = (cancel: boolean): void => {
    const v = x
    const replies = !cancel && passed
    if (!quiet && v) {
      tag(stack.animate({ translate: [`${v}px 0`, '0 0'] }, { duration: 380, easing: cssSpring('swipe') }))
      tag(icon.animate({ opacity: [Math.min(1, v / TH), 0] }, { duration: 160, easing: 'linear' }))
    }
    reset()
    x = 0
    passed = false
    id = -1
    // (a click that follows the drag is swallowed; one that does not come must not swallow the next tap)
    if (moved) setTimeout(() => (moved = false))
    if (replies) o.reply()
  }

  const down = (e: PointerEvent): void => {
    moved = false
    if (id !== -1 || !swipeAllowed(e.pointerType)) return
    if ((e.target as Element | null)?.closest(KEEPS_THE_POINTER)) return
    id = e.pointerId
    sx = e.clientX
    sy = e.clientY
    state = 'pending'
    quiet = reduced()
    moved = false
    passed = false
    x = 0
    stack.getAnimations().forEach((a) => a.id === MINE && a.cancel())
  }

  const move = (e: PointerEvent): void => {
    if (e.pointerId !== id) return
    const dx = e.clientX - sx
    const dy = e.clientY - sy
    state = swipeDecision(dx, dy, state)
    if (state === 'cancelled') {
      id = -1
      return
    }
    if (state !== 'swiping') return
    if (!moved) {
      moved = true
      try {
        bubble.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer is already gone */
      }
      row.classList.add('swiping')
    }
    e.preventDefault()
    // Reduced motion keeps still: the drag is only measured, to tell a deliberate pull from a click.
    if (!quiet) paint(rubber(Math.max(0, dx)))
    else x = Math.max(0, dx)
  }

  const up = (e: PointerEvent): void => {
    if (e.pointerId !== id) return
    if (state === 'swiping') {
      if (quiet) passed = x > PLAIN_REPLY_DX
      finish(e.type === 'pointercancel')
    } else id = -1
  }

  // The click that ends a drag must not open or select anything.
  const click = (e: MouseEvent): void => {
    if (moved) {
      e.stopPropagation()
      moved = false
    }
  }

  const key = (e: KeyboardEvent): void => {
    if (e.target !== bubble || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault()
      o.reply()
    }
  }

  bubble.addEventListener('pointerdown', down)
  bubble.addEventListener('pointermove', move)
  bubble.addEventListener('pointerup', up)
  bubble.addEventListener('pointercancel', up)
  bubble.addEventListener('click', click, true)
  bubble.addEventListener('keydown', key)
  return () => {
    bubble.removeEventListener('pointerdown', down)
    bubble.removeEventListener('pointermove', move)
    bubble.removeEventListener('pointerup', up)
    bubble.removeEventListener('pointercancel', up)
    bubble.removeEventListener('click', click, true)
    bubble.removeEventListener('keydown', key)
    reset()
  }
}
