export interface RowPos {
  id: string
  /** Top of the row inside the list. */
  y: number
  size: number
}

export interface RowMove {
  id: string
  from: number
  to: number
}

/**
 * Did the rows that are in both lists change places relative to each other? (A chat that a new message brought to the
 * top, as opposed to the whole list shifting because a row was added or a height was measured.)
 */
export function reordered(prevIds: readonly string[], nextIds: readonly string[]): boolean {
  const next = new Set(nextIds)
  const prev = new Set(prevIds)
  const a = prevIds.filter((id) => next.has(id))
  const b = nextIds.filter((id) => prev.has(id))
  return a.some((id, i) => id !== b[i])
}

/**
 * The rows to slide (FLIP: first, last, invert, play): those on screen both before and after that moved by more than
 * `minDelta` px. Rows that jump in from far away or out of view are not animated, they would only streak across.
 */
export function flipMoves(prev: ReadonlyMap<string, number>, next: readonly RowPos[], viewport: { top: number; bottom: number }, minDelta = 2): RowMove[] {
  const moves: RowMove[] = []
  const shown = (y: number, size: number): boolean => y + size > viewport.top && y < viewport.bottom
  for (const row of next) {
    const from = prev.get(row.id)
    if (from === undefined || Math.abs(from - row.y) < minDelta) continue
    if (shown(from, row.size) && shown(row.y, row.size)) moves.push({ id: row.id, from, to: row.y })
  }
  return moves
}

/** Rise to top (motion idea 11): the timings, in one place. */
export const LIFT_MS = 160
export const RISE_MS = 560
export const PART_MS = 420
export const PART_STEP_MS = 25
export const PART_CAP = 6
/** The spring may carry the rising row this far past the top (px) whatever the distance. */
export const RISE_OVERSHOOT_PX = 20

export interface Rise {
  id: string
  /** How many places it moved up (negative: down). */
  distance: number
  /** Only the one chat that jumped up by more than a place is lifted. */
  lift: boolean
  /** The chat that rose, the rows it passes (they part), or an ordinary reorder (plain FLIP). */
  role: 'mover' | 'part' | 'plain'
  /** For a row that parts: how many places it is from where the mover started (1..6), which sets its delay. */
  steps: number
}

/**
 * What kind of move each row makes. When exactly one chat rose by more than one place (a message brought it up, or it was
 * pinned) it is the mover, lifted and sprung, and the rows between its old place and the top part for it, later the further
 * they are from where it started. Anything else (one place up, several risers, a shuffle) is an ordinary slide.
 */
export function riseOf(moves: readonly RowMove[], rowSize: number): Rise[] {
  const size = rowSize > 0 ? rowSize : 68
  const places = (m: RowMove): number => Math.round((m.from - m.to) / size)
  const risers = moves.filter((m) => places(m) >= 2)
  const mover = risers.length === 1 ? risers[0] : undefined
  return moves.map((m) => {
    const distance = places(m)
    if (mover && m.id === mover.id) return { id: m.id, distance, lift: true, role: 'mover', steps: 0 }
    if (mover && distance < 0 && m.from >= mover.to - 1 && m.from < mover.from - 1) {
      return { id: m.id, distance, lift: false, role: 'part', steps: Math.max(1, Math.min(PART_CAP, Math.round((mover.from - m.from) / size))) }
    }
    return { id: m.id, distance, lift: false, role: 'plain', steps: 0 }
  })
}

/** The fraction of the travel the rise spring overshoots: 10 % (scaled by the style's bounce), but never past 20 px. */
export function riseOvershoot(distancePx: number, bounce: number, base = 0.1): number {
  const d = Math.abs(distancePx)
  if (d === 0 || bounce <= 0) return 0
  return Math.min(base * bounce, RISE_OVERSHOOT_PX / d)
}

/**
 * Start delays (ms) for a rise. A fresh one waits for the lift (160 ms) and the parting rows 25 ms more per place; one that
 * continues a rise already under way (another message arrived mid-flight) has been lifted and moving, so nothing waits.
 * `dot` is when the unread dot pops: after the travel, counted from this start.
 */
export function riseDelays(continuation: boolean, steps: number): { mover: number; part: number; dot: number } {
  if (continuation) return { mover: 0, part: 0, dot: RISE_MS }
  return { mover: LIFT_MS, part: LIFT_MS + Math.max(0, Math.min(PART_CAP, steps)) * PART_STEP_MS, dot: LIFT_MS + RISE_MS }
}
