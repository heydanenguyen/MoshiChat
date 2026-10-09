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
