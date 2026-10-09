/**
 * Zalo Web has no per-chat history for 1:1 chats: older messages come from one
 * account-wide feed over the socket, a page at a time, newest first. Each start
 * walks it from the newest page down to what is already on disk, then jumps to
 * the oldest point reached before and keeps going, so every start digs a little
 * deeper until Zalo has nothing older to give. A walk cut short while still
 * above that point (a long absence) leaves a gap, so the next one carries on
 * from there instead of fetching the same newest pages again.
 */

/** How far down the feed Moshi has walked, per kind of chat (direct or group). Saved with the message cache. */
export interface SyncCursor {
  /** Oldest message reached so far; the next walk continues from here. */
  oldestId?: string
  oldestTs?: number
  /** Zalo answered with an empty page below the oldest point: nothing older exists. */
  done?: boolean
  /**
   * Stretches not fetched yet above the oldest point, newest first: a walk cut short (page limit, quit, a dropped
   * socket) while still above it got down to `below` (sent at `ts`); what lies under it was never fetched. Several,
   * because the app can be closed again before a gap is filled, which opens a newer one above it.
   */
  gaps?: SyncGap[]
}

export interface SyncGap {
  below: string
  ts: number
}

export interface SyncWalk {
  /** Pages received during this walk. */
  rounds: number
  /** The walk already skipped from known messages down to the saved cursor. */
  jumped: boolean
  /** The message id the last page was requested below (undefined = the newest page). */
  askedBelow?: string
}

export interface SyncPage {
  size: number
  /** Messages in the page Moshi did not have yet. */
  fresh: number
  oldestId?: string
  oldestTs?: number
}

export type SyncStep = { kind: 'request'; below: string } | { kind: 'stop'; reason: 'end' | 'caught-up' | 'limit' | 'stuck' }

/** Pages per kind of chat in one walk; the rest waits for the next start (Zalo does not like floods). */
export const SYNC_PAGE_LIMIT = 60
/** While pages above the oldest point are still mostly new (a long absence), a walk goes on up to this many. */
export const SYNC_PAGE_MAX = 300
/** Open gaps kept per kind of chat; past this the oldest is given up (the newest messages matter most). */
export const SYNC_MAX_GAPS = 5

/** Decide what to ask for after a page arrives, and move the saved cursor. */
export function nextSyncStep(walk: SyncWalk, page: SyncPage, cursor: SyncCursor, limit = SYNC_PAGE_LIMIT): { step: SyncStep; cursor: SyncCursor } {
  const gaps = cursor.gaps ?? []
  if (!page.size || !page.oldestId || page.oldestTs === undefined) {
    // An empty page under the deepest point means the feed is exhausted; an empty newest page just means no messages.
    const reachedBottom = walk.askedBelow !== undefined && (!cursor.oldestId || walk.askedBelow === cursor.oldestId)
    // Nothing below a gap's edge either: Zalo has nothing to fill it with.
    const rest = withGaps(cursor, gaps.filter((gap) => gap.below !== walk.askedBelow))
    return { step: { kind: 'stop', reason: 'end' }, cursor: reachedBottom ? { ...rest, done: true } : rest }
  }
  const oldestTs = page.oldestTs
  const deeper = cursor.oldestTs === undefined || oldestTs < cursor.oldestTs
  // New messages above the oldest point: this page is the lowest point reached in its gap (a new one above all the
  // others, or one being filled, which then also swallows any gap it ran into).
  const next: SyncCursor = deeper
    ? { oldestId: page.oldestId, oldestTs, done: false }
    : page.fresh
      ? withGaps(cursor, [{ below: page.oldestId, ts: oldestTs }, ...gaps.filter((gap) => gap.ts < oldestTs)].slice(0, SYNC_MAX_GAPS))
      : cursor
  if (walk.askedBelow === page.oldestId) {
    // Zalo cannot go below this message: a gap stuck here would be asked for again at every start.
    return { step: { kind: 'stop', reason: 'stuck' }, cursor: withGaps(next, (next.gaps ?? []).filter((gap) => gap.below !== walk.askedBelow)) }
  }
  const mostlyNew = !deeper && page.fresh * 2 >= page.size && walk.rounds < SYNC_PAGE_MAX
  if (walk.rounds >= limit && !mostlyNew) return { step: { kind: 'stop', reason: 'limit' }, cursor: next }
  if (!page.fresh && !deeper) {
    // Known messages: gaps above this page are filled (the walk came out of them into known ones), and so is one it
    // was asked right below. Pages above the newest gap left were fetched before: skip down to it.
    const open = gaps.filter((gap) => gap.ts <= oldestTs && gap.below !== walk.askedBelow)
    const settled = withGaps(cursor, open)
    if (open.length) return { step: { kind: 'request', below: open[0].below }, cursor: settled }
    // Everything here was known: skip what earlier walks already fetched.
    if (settled.done) return { step: { kind: 'stop', reason: 'caught-up' }, cursor: settled }
    if (!walk.jumped && settled.oldestId && settled.oldestId !== page.oldestId) return { step: { kind: 'request', below: settled.oldestId }, cursor: settled }
    return { step: { kind: 'request', below: page.oldestId }, cursor: settled }
  }
  return { step: { kind: 'request', below: page.oldestId }, cursor: next }
}

function withGaps(cursor: SyncCursor, gaps: SyncGap[]): SyncCursor {
  if (gaps.length) return { ...cursor, gaps }
  if (!cursor.gaps) return cursor
  const { gaps: _gaps, ...rest } = cursor
  return rest
}

/** A cursor as saved, including the single resume point of builds before gaps were kept. */
export function savedCursor(saved?: SyncCursor & { resumeBelow?: string; resumeTs?: number }): SyncCursor {
  if (!saved) return {}
  const { resumeBelow, resumeTs, ...cursor } = saved
  if (resumeBelow === undefined || resumeTs === undefined || cursor.gaps?.length) return cursor
  return { ...cursor, gaps: [{ below: resumeBelow, ts: resumeTs }] }
}

/**
 * Whether signing in with the saved cookie failed because Zalo no longer accepts it (a new QR is needed). zca-js 2.2
 * (dist/zalo.js loginCookie) throws these when the login info comes back empty or without a session key, or when the
 * saved credentials are incomplete; HTTP failures, network errors and anything else are worth retrying as they are.
 */
export function isSessionRejected(err: unknown): boolean {
  const message = err instanceof Error ? err.message : ''
  return /^(Đăng nhập thất bại|Khởi tạo ngữ cảnh thất bại|Missing required params)/.test(message)
}

/**
 * Whether a failed account-info call on a running session means Zalo no longer accepts it. zca-js 2.2 (dist/utils.js
 * handleZaloResponse) reports an HTTP failure as "Request failed with status code N" and an answer with an error as
 * a ZcaApiError carrying Zalo's own code; a refused session shows up as one of those, a dropped network does not
 * (a TypeError or ECONNRESET without a code). Which code Zalo uses is not known: the caller logs it and asks twice.
 */
export function isProbeRejected(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (/^Request failed with status code (401|403)$/.test(err.message)) return true
  const code = (err as { code?: unknown }).code
  return err.name === 'ZcaApiError' && typeof code === 'number'
}
