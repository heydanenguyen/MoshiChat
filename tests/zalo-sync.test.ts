import { describe, expect, it } from 'vitest'
import { isProbeRejected, isSessionRejected, nextSyncStep, savedCursor, SYNC_MAX_GAPS, SYNC_PAGE_MAX, type SyncCursor, type SyncWalk } from '../src/main/adapters/zalo-sync'

const walk = (patch: Partial<SyncWalk> = {}): SyncWalk => ({ rounds: 1, jumped: false, ...patch })

describe('zalo history walk', () => {
  it('walks down page by page on the first run and remembers the oldest point', () => {
    const { step, cursor } = nextSyncStep(walk(), { size: 50, fresh: 50, oldestId: 'm100', oldestTs: 100 }, {})
    expect(step).toEqual({ kind: 'request', below: 'm100' })
    expect(cursor).toEqual({ oldestId: 'm100', oldestTs: 100, done: false })
  })

  it('keeps going through new messages, then skips to where the last run stopped', () => {
    const saved: SyncCursor = { oldestId: 'm10', oldestTs: 10 }
    expect(nextSyncStep(walk(), { size: 50, fresh: 20, oldestId: 'm500', oldestTs: 500 }, saved).step).toEqual({ kind: 'request', below: 'm500' })
    const known = nextSyncStep(walk({ rounds: 2, askedBelow: 'm500' }), { size: 50, fresh: 0, oldestId: 'm450', oldestTs: 450 }, saved)
    expect(known.step).toEqual({ kind: 'request', below: 'm10' })
    expect(known.cursor).toBe(saved)
  })

  it('continues below the saved point after the skip and moves the cursor deeper', () => {
    const { step, cursor } = nextSyncStep(walk({ rounds: 3, jumped: true, askedBelow: 'm10' }), { size: 50, fresh: 50, oldestId: 'm5', oldestTs: 5 }, { oldestId: 'm10', oldestTs: 10 })
    expect(step).toEqual({ kind: 'request', below: 'm5' })
    expect(cursor).toEqual({ oldestId: 'm5', oldestTs: 5, done: false })
  })

  it('marks the feed finished when the page below the deepest point is empty', () => {
    const { step, cursor } = nextSyncStep(walk({ rounds: 4, askedBelow: 'm5' }), { size: 0, fresh: 0 }, { oldestId: 'm5', oldestTs: 5 })
    expect(step).toEqual({ kind: 'stop', reason: 'end' })
    expect(cursor.done).toBe(true)
  })

  it('an empty newest page does not mark the feed finished', () => {
    const { step, cursor } = nextSyncStep(walk(), { size: 0, fresh: 0 }, {})
    expect(step.kind).toBe('stop')
    expect(cursor.done).toBeUndefined()
  })

  it('stops once caught up with a finished feed', () => {
    const done: SyncCursor = { oldestId: 'm1', oldestTs: 1, done: true }
    expect(nextSyncStep(walk(), { size: 50, fresh: 0, oldestId: 'm450', oldestTs: 450 }, done).step).toEqual({ kind: 'stop', reason: 'caught-up' })
  })

  it('stops at the page limit and when Zalo answers with the same page again', () => {
    expect(nextSyncStep(walk({ rounds: 60 }), { size: 50, fresh: 50, oldestId: 'm100', oldestTs: 100 }, {}).step).toEqual({ kind: 'stop', reason: 'limit' })
    expect(nextSyncStep(walk({ askedBelow: 'm100' }), { size: 1, fresh: 0, oldestId: 'm100', oldestTs: 100 }, { oldestId: 'm100', oldestTs: 100 }).step).toEqual({ kind: 'stop', reason: 'stuck' })
  })
})

describe('zalo history walk after a long absence', () => {
  // the last walk got down to m10; since then far more than 60 pages of messages arrived
  const deep: SyncCursor = { oldestId: 'm10', oldestTs: 10 }
  const gap = (below: string, ts: number): { below: string; ts: number } => ({ below, ts })

  it('remembers where it stopped when the page limit hits above the saved point', () => {
    const { step, cursor } = nextSyncStep(walk({ rounds: 60, askedBelow: 'm620' }), { size: 50, fresh: 20, oldestId: 'm600', oldestTs: 600 }, deep)
    expect(step).toEqual({ kind: 'stop', reason: 'limit' })
    expect(cursor).toEqual({ oldestId: 'm10', oldestTs: 10, gaps: [gap('m600', 600)] })
  })

  it('the next walk skips the pages it already fetched and goes on below the gap', () => {
    const saved: SyncCursor = { ...deep, gaps: [gap('m600', 600)] }
    const { step, cursor } = nextSyncStep(walk(), { size: 50, fresh: 0, oldestId: 'm4000', oldestTs: 4000 }, saved)
    expect(step).toEqual({ kind: 'request', below: 'm600' })
    expect(cursor).toEqual(saved)
    // even a finished feed is not caught up while that gap is open
    const finished = nextSyncStep(walk(), { size: 50, fresh: 0, oldestId: 'm4000', oldestTs: 4000 }, { ...saved, done: true })
    expect(finished.step).toEqual({ kind: 'request', below: 'm600' })
    // then the gap's edge follows the walk down
    const below = nextSyncStep(walk({ rounds: 2, askedBelow: 'm600' }), { size: 50, fresh: 50, oldestId: 'm550', oldestTs: 550 }, saved)
    expect(below.step).toEqual({ kind: 'request', below: 'm550' })
    expect(below.cursor).toEqual({ ...deep, gaps: [gap('m550', 550)] })
  })

  it('closes the gap once the walk reaches what earlier walks had', () => {
    const saved: SyncCursor = { ...deep, gaps: [gap('m60', 60)] }
    const known = nextSyncStep(walk({ rounds: 9, askedBelow: 'm60' }), { size: 50, fresh: 0, oldestId: 'm40', oldestTs: 40 }, saved)
    expect(known.step).toEqual({ kind: 'request', below: 'm10' })
    expect(known.cursor).toEqual(deep)
    const deeper = nextSyncStep(walk({ rounds: 9, askedBelow: 'm60' }), { size: 50, fresh: 30, oldestId: 'm8', oldestTs: 8 }, saved)
    expect(deeper.step).toEqual({ kind: 'request', below: 'm8' })
    expect(deeper.cursor).toEqual({ oldestId: 'm8', oldestTs: 8, done: false })
  })

  it('walks past the page limit while pages are still mostly new, up to a hard cap', () => {
    const page = { size: 50, fresh: 40, oldestId: 'm600', oldestTs: 600 }
    expect(nextSyncStep(walk({ rounds: 60 }), page, deep).step).toEqual({ kind: 'request', below: 'm600' })
    expect(nextSyncStep(walk({ rounds: 200 }), page, deep).step).toEqual({ kind: 'request', below: 'm600' })
    expect(nextSyncStep(walk({ rounds: SYNC_PAGE_MAX }), page, deep).step).toEqual({ kind: 'stop', reason: 'limit' })
    expect(SYNC_PAGE_MAX).toBe(300)
    // mostly known pages: the usual limit
    expect(nextSyncStep(walk({ rounds: 60 }), { ...page, fresh: 10 }, deep).step).toEqual({ kind: 'stop', reason: 'limit' })
  })

  it('forgets a gap Zalo has nothing below', () => {
    const saved: SyncCursor = { ...deep, gaps: [gap('m600', 600)] }
    const { step, cursor } = nextSyncStep(walk({ rounds: 2, askedBelow: 'm600' }), { size: 0, fresh: 0 }, saved)
    expect(step).toEqual({ kind: 'stop', reason: 'end' })
    expect(cursor).toEqual(deep)
  })

  it('a newer gap opened before the older one was filled is finished first, then the older one', () => {
    type Page = { fresh: number; oldestId: string; oldestTs: number }
    let cursor: SyncCursor = deep
    const step = (w: SyncWalk, p: Page): unknown => {
      const out = nextSyncStep(w, { size: 50, ...p }, cursor)
      cursor = out.cursor
      return out.step
    }
    // walk A: a long absence, cut short at m600
    step(walk({ rounds: 60, askedBelow: 'm620' }), { fresh: 20, oldestId: 'm600', oldestTs: 600 })
    // closed again; walk B starts on new messages above everything and is cut short (quit) at m4900
    expect(step(walk(), { fresh: 50, oldestId: 'm5000', oldestTs: 5000 })).toEqual({ kind: 'request', below: 'm5000' })
    expect(step(walk({ rounds: 2, askedBelow: 'm5000' }), { fresh: 50, oldestId: 'm4900', oldestTs: 4900 })).toEqual({ kind: 'request', below: 'm4900' })
    expect(cursor.gaps).toEqual([gap('m4900', 4900), gap('m600', 600)])
    // walk C: the newest page is known; it goes on below B's gap, not A's
    expect(step(walk(), { fresh: 0, oldestId: 'm5500', oldestTs: 5500 })).toEqual({ kind: 'request', below: 'm4900' })
    expect(step(walk({ rounds: 2, askedBelow: 'm4900' }), { fresh: 50, oldestId: 'm4800', oldestTs: 4800 })).toEqual({ kind: 'request', below: 'm4800' })
    // B's gap ends where A's walk had been: on to A's gap
    expect(step(walk({ rounds: 3, askedBelow: 'm4800' }), { fresh: 0, oldestId: 'm3000', oldestTs: 3000 })).toEqual({ kind: 'request', below: 'm600' })
    expect(cursor.gaps).toEqual([gap('m600', 600)])
    expect(step(walk({ rounds: 4, askedBelow: 'm600' }), { fresh: 50, oldestId: 'm550', oldestTs: 550 })).toEqual({ kind: 'request', below: 'm550' })
    // A's gap ends in the old history: the usual skip to the oldest point
    expect(step(walk({ rounds: 5, askedBelow: 'm550' }), { fresh: 0, oldestId: 'm40', oldestTs: 40 })).toEqual({ kind: 'request', below: 'm10' })
    expect(cursor).toEqual(deep)
  })

  it('keeps the newest gaps when too many are open', () => {
    const gaps = [gap('m5000', 5000), gap('m4000', 4000), gap('m3000', 3000), gap('m2000', 2000), gap('m1000', 1000)]
    const { cursor } = nextSyncStep(walk(), { size: 50, fresh: 50, oldestId: 'm9000', oldestTs: 9000 }, { ...deep, gaps })
    expect(SYNC_MAX_GAPS).toBe(5)
    expect(cursor.gaps).toEqual([gap('m9000', 9000), ...gaps.slice(0, 4)])
  })

  it('reads the single resume point saved by the build before', () => {
    expect(savedCursor({ ...deep, resumeBelow: 'm600', resumeTs: 600 })).toEqual({ ...deep, gaps: [gap('m600', 600)] })
    expect(savedCursor(deep)).toEqual(deep)
    expect(savedCursor(undefined)).toEqual({})
  })
})

describe('zalo sign-in errors', () => {
  const zca = (message: string): Error => Object.assign(new Error(message), { name: 'ZcaApiError' })

  it('only a refused cookie means the session is over', () => {
    expect(isSessionRejected(zca('Đăng nhập thất bại'))).toBe(true)
    expect(isSessionRejected(zca('Khởi tạo ngữ cảnh thất bại.'))).toBe(true)
    expect(isSessionRejected(zca('Missing required params'))).toBe(true)
  })

  it('network trouble and Zalo hiccups are worth retrying with the same cookie', () => {
    expect(isSessionRejected(zca('Failed to fetch login info: Bad Gateway'))).toBe(false)
    expect(isSessionRejected(zca('Failed to fetch server info: Service unavailable'))).toBe(false)
    expect(isSessionRejected(zca('Failed to encrypt params: oops'))).toBe(false)
    expect(isSessionRejected(new TypeError('fetch failed'))).toBe(false)
    expect(isSessionRejected(undefined)).toBe(false)
  })
})

describe('zalo session check on a running session', () => {
  const zca = (message: string, code?: number): Error => Object.assign(new Error(message), { name: 'ZcaApiError', code: code ?? null })

  it('an HTTP 401 or 403, or Zalo answering with an error code, counts as refused', () => {
    expect(isProbeRejected(zca('Request failed with status code 401'))).toBe(true)
    expect(isProbeRejected(zca('Request failed with status code 403'))).toBe(true)
    expect(isProbeRejected(zca('Session expired', 114))).toBe(true)
  })

  it('server trouble and a dropped network do not', () => {
    expect(isProbeRejected(zca('Request failed with status code 502'))).toBe(false)
    expect(isProbeRejected(zca('Failed to parse response data'))).toBe(false)
    expect(isProbeRejected(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(false)
    expect(isProbeRejected(new TypeError('fetch failed'))).toBe(false)
    expect(isProbeRejected(undefined)).toBe(false)
  })
})
