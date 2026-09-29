import { describe, expect, it } from 'vitest'
import { nextSyncStep, type SyncCursor, type SyncWalk } from '../src/main/adapters/zalo-sync'

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
