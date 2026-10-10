import type { AccountFeatures, CallSettings, CallState, IncomingCall } from '@shared/types'

/** No call in progress, none ringing. */
export const EMPTY_CALLS: CallState = { incoming: [] }

/** A call rings for at most this long (from when it first rang). */
export const RING_MAX_MS = 30_000

/** The state with this call ringing; a call announced again (same id) replaces its earlier copy. One already answered (the active call) is not listed. */
export function addIncoming(state: CallState, call: IncomingCall): CallState {
  if (state.active?.id === call.id) return state
  const index = state.incoming.findIndex((c) => c.id === call.id)
  const incoming = state.incoming.slice()
  if (index >= 0) incoming[index] = call
  else incoming.push(call)
  return { ...state, incoming }
}

/** The state without this ringing call (the same object when it was not there). */
export function withoutIncoming(state: CallState, id: string): CallState {
  if (!state.incoming.some((c) => c.id === id)) return state
  return { ...state, incoming: state.incoming.filter((c) => c.id !== id) }
}

/** What the main process reports is the whole picture: take it as it is (a missing list counts as empty). */
export function callsOf(state: CallState): CallState {
  return { ...state, incoming: state.incoming ?? [] }
}

/** "02:13", or "1:02:05" past the hour; never negative. */
export function callTimer(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}

/** The account offers this kind of call from the chat header. */
export function canCall(features: Pick<AccountFeatures, 'call'>, kind: 'audio' | 'video'): boolean {
  const call = features.call
  return call === 'both' || call === kind
}

/** Incoming calls ring unless switched off in Settings (on when never set). */
export function ringAllowed(calls: CallSettings | undefined): boolean {
  return calls?.ring !== false
}

/** When the ring must stop (ms since epoch): 30 s after the earliest call that is ringing; undefined when nothing should ring now. */
export function ringDeadline(incoming: readonly IncomingCall[], calls: CallSettings | undefined, now: number): number | undefined {
  if (!incoming.length || !ringAllowed(calls)) return undefined
  const stopAt = Math.min(...incoming.map((c) => c.at)) + RING_MAX_MS
  return stopAt > now ? stopAt : undefined
}
