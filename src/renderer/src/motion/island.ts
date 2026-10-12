import type { CallState, IncomingCall } from '@shared/types'

/**
 * The call "island": one pill under the title bar that morphs between these states (design/proposals/2026-10-13-motion-ideas.html, card 16).
 * idle: nothing; ring: someone is calling; live: a call in progress; open: live, expanded by hover or focus; end: "Ended · 02:14" for a moment.
 */
export type IslandState = 'idle' | 'ring' | 'live' | 'open' | 'end'

export interface IslandSize {
  w: number
  h: number
  r: number
}

// The ring is 264 wide, not the demo's 232: the demo has one answer button, the pill has two (answer and decline) and the label must fit.
const SIZES: Record<IslandState, IslandSize> = {
  idle: { w: 14, h: 14, r: 7 },
  ring: { w: 264, h: 48, r: 24 },
  live: { w: 172, h: 40, r: 20 },
  open: { w: 340, h: 92, r: 30 },
  end: { w: 156, h: 40, r: 20 }
}

/** Mono is flat: the same corner radius in every state. */
export const FLAT_RADIUS = 8

/** How long a morph takes (the springs settle in this time) and how long "Ended" stays before the pill goes. */
export const ISLAND_MS = 380
export const END_HOLD_MS = 2000

/** The pill's width, height and corner radius (px) in a state; `flat` (Mono) keeps one small radius throughout. */
export function islandSize(state: IslandState, flat = false): IslandSize {
  const size = SIZES[state]
  return flat ? { ...size, r: FLAT_RADIUS } : { ...size }
}

/** What the call state says, ignoring hover: someone rings (even during a call), a call is going, or nothing. */
export type CallPhase = 'none' | 'ring' | 'live'

export function callPhase(calls: Pick<CallState, 'active' | 'incoming'>): CallPhase {
  if (calls.incoming.length > 0) return 'ring'
  return calls.active ? 'live' : 'none'
}

/** The call that rings in the pill: the newest (the others wait below it as cards). */
export function newestIncoming(incoming: readonly IncomingCall[]): IncomingCall | undefined {
  let best: IncomingCall | undefined
  for (const call of incoming) if (!best || call.at >= best.at) best = call
  return best
}

export type IslandEvent =
  | 'ring' // a call starts ringing
  | 'connect' // a call is in progress and nothing rings (answered, or one we started, or a second ring ended)
  | 'dismiss' // the ring stopped with no call (declined, missed, or answered elsewhere)
  | 'hangup' // the call in progress ended
  | 'expand' // hover or focus
  | 'collapse' // leave, blur or Escape
  | 'settle' // "Ended" has been shown long enough

/** The event for a change of phase (null when the phase did not change). */
export function phaseEvent(from: CallPhase, to: CallPhase): IslandEvent | null {
  if (from === to) return null
  if (to === 'ring') return 'ring'
  if (to === 'live') return 'connect'
  return from === 'ring' ? 'dismiss' : 'hangup'
}

/** The pill's next state. Pure, so the whole life of a call is testable without a DOM. */
export function nextIslandState(current: IslandState, event: IslandEvent): IslandState {
  switch (event) {
    case 'ring':
      return 'ring'
    case 'connect':
      return current === 'open' ? 'open' : 'live'
    case 'dismiss':
      return current === 'ring' ? 'idle' : current
    case 'hangup':
      return current === 'idle' || current === 'ring' ? 'idle' : 'end'
    case 'expand':
      return current === 'live' ? 'open' : current
    case 'collapse':
      return current === 'open' ? 'live' : current
    case 'settle':
      return current === 'end' ? 'idle' : current
  }
}

/** The CSS variable names of the springs (set on the root by App from `springVars`). */
export type IslandSpringVar = '--spring-isl-grow' | '--spring-isl-grow-h' | '--spring-isl-shrink' | '--spring-isl-shrink-h' | '--spring-isl-radius'

export interface IslandSprings {
  grow: boolean
  width: IslandSpringVar
  height: IslandSpringVar
  radius: IslandSpringVar
  /** The height starts a hair after the width when growing, so the pill widens first (the demo's 24 ms). */
  heightDelay: number
}

/** Which curves a morph uses: growing overshoots more (width .16, height .22), shrinking settles tighter (.08, .10). */
/** `from` may be the size the pill really has right now (measured, when a morph was cut short) instead of the last state's. */
export function islandSprings(from: IslandState | IslandSize, to: IslandState): IslandSprings {
  const a = typeof from === 'string' ? SIZES[from] : from
  const b = SIZES[to]
  const grow = b.w !== a.w ? b.w > a.w : b.h > a.h
  return {
    grow,
    width: grow ? '--spring-isl-grow' : '--spring-isl-shrink',
    height: grow ? '--spring-isl-grow-h' : '--spring-isl-shrink-h',
    radius: '--spring-isl-radius',
    heightDelay: grow ? 24 : 0
  }
}

/** The call the pill showed or shows: the newest of every call still listed (ringing or just gone). Its card must not appear below the pill. */
export function pillCallId(listed: readonly IncomingCall[]): string | undefined {
  return newestIncoming(listed)?.id
}
