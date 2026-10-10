import { describe, expect, it } from 'vitest'
import type { CallState, IncomingCall } from '../src/shared/types'
import { EMPTY_CALLS, addIncoming, callTimer, canCall, callsOf, ringAllowed, ringDeadline, withoutIncoming } from '../src/renderer/src/calls'

const call = (id: string, over: Partial<IncomingCall> = {}): IncomingCall => ({ id, accountId: 'a1', platform: 'messenger', peerName: id, kind: 'audio', at: 1, ...over })

describe('incoming calls', () => {
  it('adds a ringing call', () => {
    const next = addIncoming(EMPTY_CALLS, call('c1'))
    expect(next.incoming.map((c) => c.id)).toEqual(['c1'])
  })

  it('replaces a call announced twice instead of listing it twice', () => {
    const first = addIncoming(EMPTY_CALLS, call('c1', { peerName: 'Old' }))
    const next = addIncoming(first, call('c1', { peerName: 'New' }))
    expect(next.incoming).toHaveLength(1)
    expect(next.incoming[0].peerName).toBe('New')
  })

  it('keeps several ringing calls in the order they came', () => {
    const next = addIncoming(addIncoming(EMPTY_CALLS, call('c1')), call('c2'))
    expect(next.incoming.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('removes one by id and keeps the active call', () => {
    const state: CallState = { active: { id: 'x', accountId: 'a1', platform: 'zalo', kind: 'video', startedAt: 5 }, incoming: [call('c1'), call('c2')] }
    const next = withoutIncoming(state, 'c1')
    expect(next.incoming.map((c) => c.id)).toEqual(['c2'])
    expect(next.active?.id).toBe('x')
  })

  it('returns the same object when there is nothing to remove', () => {
    const state = addIncoming(EMPTY_CALLS, call('c1'))
    expect(withoutIncoming(state, 'nope')).toBe(state)
  })
})

describe('callsOf', () => {
  it('takes the main process picture whole, so a call that vanished from it vanishes here', () => {
    const before = addIncoming(EMPTY_CALLS, call('c1'))
    const after = callsOf({ incoming: [] })
    expect(before.incoming).toHaveLength(1)
    expect(after.incoming).toEqual([])
  })

  it('tolerates a state with no incoming list', () => {
    expect(callsOf({} as CallState).incoming).toEqual([])
  })
})

describe('callTimer', () => {
  it('shows minutes and seconds', () => {
    expect(callTimer(1000, 1000 + 133_000)).toBe('02:13')
  })
  it('starts at 00:00 and never goes negative', () => {
    expect(callTimer(5000, 5000)).toBe('00:00')
    expect(callTimer(5000, 1000)).toBe('00:00')
  })
  it('adds hours past the hour', () => {
    expect(callTimer(0, 3_725_000)).toBe('1:02:05')
  })
})

describe('canCall', () => {
  it('follows the account features', () => {
    expect(canCall({ call: 'both' }, 'audio')).toBe(true)
    expect(canCall({ call: 'both' }, 'video')).toBe(true)
    expect(canCall({ call: 'audio' }, 'video')).toBe(false)
    expect(canCall({ call: 'video' }, 'audio')).toBe(false)
    expect(canCall({ call: 'none' }, 'audio')).toBe(false)
    expect(canCall({}, 'audio')).toBe(false)
  })
})

describe('ringAllowed', () => {
  it('rings by default and when on, not when switched off', () => {
    expect(ringAllowed(undefined)).toBe(true)
    expect(ringAllowed({ incomingMessenger: true, incomingInstagram: true, ring: true })).toBe(true)
    expect(ringAllowed({ incomingMessenger: true, incomingInstagram: true, ring: false })).toBe(false)
  })
})

describe('addIncoming and the active call', () => {
  it('does not list a call that is already the active one', () => {
    const state: CallState = { active: { id: 'c1', accountId: 'a1', platform: 'messenger', kind: 'audio', startedAt: 1 }, incoming: [] }
    expect(addIncoming(state, call('c1'))).toBe(state)
  })
})

describe('ringDeadline', () => {
  const on = { incomingMessenger: true, incomingInstagram: true, ring: true }
  it('is 30 s after the earliest ringing call, not after the latest', () => {
    expect(ringDeadline([call('c2', { at: 5000 }), call('c1', { at: 1000 })], on, 2000)).toBe(31_000)
  })
  it('is nothing when the ring is off, nothing rings, or the 30 s are over', () => {
    expect(ringDeadline([call('c1', { at: 1000 })], { ...on, ring: false }, 2000)).toBeUndefined()
    expect(ringDeadline([], on, 2000)).toBeUndefined()
    expect(ringDeadline([call('c1', { at: 1000 })], on, 31_000)).toBeUndefined()
  })
})
