/**
 * Zalo Web has no per-chat history for 1:1 chats: older messages come from one
 * account-wide feed over the socket, a page at a time, newest first. Each start
 * walks it from the newest page down to what is already on disk, then jumps to
 * the oldest point reached before and keeps going, so every start digs a little
 * deeper until Zalo has nothing older to give.
 */

/** How far down the feed Moshi has walked, per kind of chat (direct or group). Saved with the message cache. */
export interface SyncCursor {
  /** Oldest message reached so far; the next walk continues from here. */
  oldestId?: string
  oldestTs?: number
  /** Zalo answered with an empty page below the oldest point: nothing older exists. */
  done?: boolean
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

/** Decide what to ask for after a page arrives, and move the saved cursor. */
export function nextSyncStep(walk: SyncWalk, page: SyncPage, cursor: SyncCursor, limit = SYNC_PAGE_LIMIT): { step: SyncStep; cursor: SyncCursor } {
  if (!page.size || !page.oldestId || page.oldestTs === undefined) {
    // An empty page under the deepest point means the feed is exhausted; an empty newest page just means no messages.
    const reachedBottom = walk.askedBelow !== undefined && (!cursor.oldestId || walk.askedBelow === cursor.oldestId)
    return { step: { kind: 'stop', reason: 'end' }, cursor: reachedBottom ? { ...cursor, done: true } : cursor }
  }
  const deeper = cursor.oldestTs === undefined || page.oldestTs < cursor.oldestTs
  const next: SyncCursor = deeper ? { oldestId: page.oldestId, oldestTs: page.oldestTs, done: false } : cursor
  if (walk.askedBelow === page.oldestId) return { step: { kind: 'stop', reason: 'stuck' }, cursor: next }
  if (walk.rounds >= limit) return { step: { kind: 'stop', reason: 'limit' }, cursor: next }
  if (!page.fresh && !deeper) {
    // Everything here was known: skip what earlier walks already fetched.
    if (next.done) return { step: { kind: 'stop', reason: 'caught-up' }, cursor: next }
    if (!walk.jumped && next.oldestId && next.oldestId !== page.oldestId) return { step: { kind: 'request', below: next.oldestId }, cursor: next }
  }
  return { step: { kind: 'request', below: page.oldestId }, cursor: next }
}
