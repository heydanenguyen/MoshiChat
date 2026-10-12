import { describe, expect, it } from 'vitest'
import type { CallState, IncomingCall } from '../src/shared/types'
import {
  FLAT_RADIUS,
  callPhase,
  islandSize,
  islandSprings,
  newestIncoming,
  nextIslandState,
  pillCallId,
  phaseEvent,
  type IslandEvent,
  type IslandState
} from '../src/renderer/src/motion/island'
import { springVars } from '../src/renderer/src/motion/spring'

const call = (id: string, at: number): IncomingCall => ({ id, accountId: 'a', platform: 'messenger', peerName: id, kind: 'audio', at })
const run = (start: IslandState, events: IslandEvent[]): IslandState[] => {
  const out: IslandState[] = []
  let s = start
  for (const e of events) out.push((s = nextIslandState(s, e)))
  return out
}
const ALL: IslandState[] = ['idle', 'ring', 'live', 'open', 'end']
const peak = (css: string): number => Math.max(...css.slice(7, -1).split(',').map(parseFloat))

describe('islandSize', () => {
  it('has the sizes of the demo', () => {
    expect(islandSize('idle')).toEqual({ w: 14, h: 14, r: 7 })
    expect(islandSize('ring')).toEqual({ w: 264, h: 48, r: 24 })
    expect(islandSize('live')).toEqual({ w: 172, h: 40, r: 20 })
    expect(islandSize('open')).toEqual({ w: 340, h: 92, r: 30 })
    expect(islandSize('end')).toEqual({ w: 156, h: 40, r: 20 })
  })

  it('keeps one corner radius when flat (Mono)', () => {
    for (const s of ALL) {
      expect(islandSize(s, true).r).toBe(FLAT_RADIUS)
      expect(islandSize(s, true).w).toBe(islandSize(s).w)
    }
  })

  it('returns a copy', () => {
    islandSize('ring').w = 1
    expect(islandSize('ring').w).toBe(264)
  })
})

describe('islandSprings', () => {
  it('grows with the grow curves and a 24 ms later height', () => {
    expect(islandSprings('idle', 'ring')).toEqual({
      grow: true,
      width: '--spring-isl-grow',
      height: '--spring-isl-grow-h',
      radius: '--spring-isl-radius',
      heightDelay: 24
    })
    expect(islandSprings('live', 'open').grow).toBe(true)
    expect(islandSprings('end', 'live').grow).toBe(true)
  })

  it('shrinks with the shrink curves and no delay', () => {
    for (const [from, to] of [
      ['open', 'live'],
      ['ring', 'live'],
      ['live', 'end'],
      ['end', 'idle'],
      ['ring', 'idle']
    ] as const) {
      const s = islandSprings(from, to)
      expect(s.grow).toBe(false)
      expect(s.width).toBe('--spring-isl-shrink')
      expect(s.height).toBe('--spring-isl-shrink-h')
      expect(s.heightDelay).toBe(0)
    }
  })

  it('names variables that springVars defines; Moshi overshoots them, Mono (bounce 0) never does', () => {
    const names = new Set<string>()
    for (const from of ALL)
      for (const to of ALL) {
        const s = islandSprings(from, to)
        names.add(s.width).add(s.height).add(s.radius)
      }
    const moshi = springVars(1)
    const mono = springVars(0)
    for (const n of names) {
      expect(moshi[n]).toMatch(/^linear\(/)
      expect(moshi[`${n}-ms`]).toBe('380ms')
      expect(peak(moshi[n])).toBeGreaterThan(1)
      expect(peak(mono[n])).toBeLessThanOrEqual(1)
    }
  })

  it('grow overshoots more than shrink, and the height more than the width', () => {
    const v = springVars(1)
    expect(peak(v['--spring-isl-grow-h'])).toBeGreaterThan(peak(v['--spring-isl-grow']))
    expect(peak(v['--spring-isl-grow'])).toBeGreaterThan(peak(v['--spring-isl-shrink-h']))
    expect(peak(v['--spring-isl-shrink-h'])).toBeGreaterThan(peak(v['--spring-isl-shrink']))
  })
})

describe('callPhase / phaseEvent / newestIncoming', () => {
  const active = { id: 'x', accountId: 'a', platform: 'messenger' as const, kind: 'audio' as const, startedAt: 1 }
  it('ringing wins over a call in progress', () => {
    expect(callPhase({ incoming: [] })).toBe('none')
    expect(callPhase({ incoming: [call('a', 1)] })).toBe('ring')
    expect(callPhase({ incoming: [], active })).toBe('live')
    expect(callPhase({ incoming: [call('a', 1)], active })).toBe('ring')
  })

  it('maps a change of phase to an event', () => {
    expect(phaseEvent('none', 'none')).toBeNull()
    expect(phaseEvent('none', 'ring')).toBe('ring')
    expect(phaseEvent('ring', 'live')).toBe('connect')
    expect(phaseEvent('none', 'live')).toBe('connect')
    expect(phaseEvent('ring', 'none')).toBe('dismiss')
    expect(phaseEvent('live', 'none')).toBe('hangup')
    expect(phaseEvent('live', 'ring')).toBe('ring')
  })

  it('shows the newest call', () => {
    expect(newestIncoming([])).toBeUndefined()
    expect(newestIncoming([call('old', 1), call('new', 5), call('mid', 3)])?.id).toBe('new')
    expect(newestIncoming([call('a', 5), call('b', 5)])?.id).toBe('b')
  })
})

describe('nextIslandState: the life of a call', () => {
  it('ring -> live -> open -> live -> end -> idle', () => {
    expect(run('idle', ['ring', 'connect', 'expand', 'collapse', 'hangup', 'settle'])).toEqual(['ring', 'live', 'open', 'live', 'end', 'idle'])
  })

  it('a declined or missed call goes back to idle without "Ended"', () => {
    expect(run('idle', ['ring', 'dismiss'])).toEqual(['ring', 'idle'])
  })

  it('hanging up while expanded ends too', () => {
    expect(run('idle', ['ring', 'connect', 'expand', 'hangup', 'settle'])).toEqual(['ring', 'live', 'open', 'end', 'idle'])
  })

  it('hover and focus only expand a live call', () => {
    expect(nextIslandState('idle', 'expand')).toBe('idle')
    expect(nextIslandState('ring', 'expand')).toBe('ring')
    expect(nextIslandState('end', 'expand')).toBe('end')
    expect(nextIslandState('live', 'collapse')).toBe('live')
    expect(nextIslandState('open', 'expand')).toBe('open')
  })

  it('a call we start ourselves goes straight to live', () => {
    expect(run('idle', ['connect', 'hangup', 'settle'])).toEqual(['live', 'end', 'idle'])
  })

  it('a second ring during a call takes the pill, and after it the call is live again', () => {
    expect(run('idle', ['connect', 'expand', 'ring', 'connect'])).toEqual(['live', 'open', 'ring', 'live'])
  })

  it('a ring during "Ended" replaces it; settle is ignored afterwards', () => {
    expect(run('idle', ['connect', 'hangup', 'ring', 'settle'])).toEqual(['live', 'end', 'ring', 'ring'])
  })

  it('stray events do nothing to idle', () => {
    for (const e of ['dismiss', 'hangup', 'collapse', 'settle', 'expand'] as const) expect(nextIslandState('idle', e)).toBe('idle')
  })

  it('a ring that ends because the call is gone goes straight to idle', () => {
    expect(nextIslandState('ring', 'hangup')).toBe('idle')
  })
})

describe('islandSprings with a measured size', () => {
  it('grows or shrinks by where the pill really is, not by the last state', () => {
    // ring (264) cut at 250 px while going to live, then back to ring: still growing
    expect(islandSprings('live', 'ring').grow).toBe(true)
    expect(islandSprings({ w: 250, h: 47, r: 24 }, 'ring').grow).toBe(true)
    expect(islandSprings({ w: 280, h: 49, r: 24 }, 'ring').grow).toBe(false)
    // same width: the height decides
    expect(islandSprings({ w: 264, h: 40, r: 20 }, 'ring').grow).toBe(true)
  })
})

describe('pillCallId', () => {
  it('is the newest call listed, ringing or just gone', () => {
    expect(pillCallId([])).toBeUndefined()
    expect(pillCallId([call('old', 1), call('gone-newest', 9)])).toBe('gone-newest')
  })
})

describe('the island over a sequence of call states', () => {
  const act = { id: 'x', accountId: 'a', platform: 'messenger' as const, kind: 'audio' as const, startedAt: 1 }
  const fold = (snapshots: CallState[]): IslandState[] => {
    let phase = 'none' as ReturnType<typeof callPhase>
    let state: IslandState = 'idle'
    const out: IslandState[] = []
    for (const snap of snapshots) {
      const event = phaseEvent(phase, (phase = callPhase(snap)))
      if (event) state = nextIslandState(state, event)
      out.push(state)
    }
    return out
  }

  it('answered on the phone: ring -> live without any click here', () => {
    expect(fold([{ incoming: [call('r', 1)] }, { incoming: [], active: act }, { incoming: [] }])).toEqual(['ring', 'live', 'end'])
  })

  it('a ring during a call whose call ends mid-ring never shows Ended for the one still ringing', () => {
    const states = fold([{ incoming: [], active: act }, { incoming: [call('r', 2)], active: act }, { incoming: [call('r', 2)] }, { incoming: [] }])
    expect(states).toEqual(['live', 'ring', 'ring', 'idle'])
    expect(states).not.toContain('end')
  })

  it('a ring during a call that is declined goes back to the live call', () => {
    expect(fold([{ incoming: [], active: act }, { incoming: [call('r', 2)], active: act }, { incoming: [], active: act }])).toEqual(['live', 'ring', 'live'])
  })

  it('two rings, the newest ends: the pill stays on ring for the other, then goes idle without Ended', () => {
    expect(fold([{ incoming: [call('a', 1)] }, { incoming: [call('a', 1), call('b', 2)] }, { incoming: [call('a', 1)] }, { incoming: [] }])).toEqual([
      'ring',
      'ring',
      'ring',
      'idle'
    ])
  })
})
