/**
 * A message you send is drawn at once as a temporary one and replaced by the platform's own a moment later (a new id, so a new
 * bubble). The second one must not play the entry again: it carries on from where the first one was, so the pop is one motion.
 */
interface Drawn {
  key: string
  /** When its entry started. */
  at: number
}

/** The temporary bubbles drawn in the last few seconds, by their id (a repeated mount of the same one changes nothing). */
const drawn = new Map<string, Drawn>()
/** The platform messages already handed one, by their id: asking again (a remount, strict mode) gives the same answer. */
const claimed = new Map<string, { start: number }>()
const KEEP_MS = 10_000

interface Shape {
  id: string
  conversationId: string
  text: string
  attachments: ArrayLike<unknown>
}

const keyOf = (m: Shape): string => `${m.conversationId}|${m.text}|${m.attachments.length}`

/**
 * A temporary bubble has been drawn. Returns how long ago its entry started: 0 the first time, more when it is drawn again
 * (its run was remounted because the run's first message was confirmed), so the new one carries on instead of restarting.
 */
export function noteSent(m: Shape, now: number = Date.now()): number {
  for (const [id, d] of drawn) if (now - d.at > KEEP_MS) drawn.delete(id)
  const known = drawn.get(m.id)
  if (known) return now - known.at
  drawn.set(m.id, { key: keyOf(m), at: now })
  return 0
}

/** The platform's message for one of those: how long ago its temporary one started, or undefined if there was none. */
export function takeSent(m: Shape, now: number = Date.now()): number | undefined {
  for (const [id, c] of claimed) if (now - c.start > KEEP_MS) claimed.delete(id)
  const again = claimed.get(m.id)
  if (again) return now - again.start
  for (const [id, d] of drawn) {
    if (now - d.at > KEEP_MS) drawn.delete(id)
    else if (d.key === keyOf(m)) {
      drawn.delete(id)
      claimed.set(m.id, { start: d.at })
      return now - d.at
    }
  }
  return undefined
}

/** For tests. */
export function resetSent(): void {
  drawn.clear()
  claimed.clear()
}
