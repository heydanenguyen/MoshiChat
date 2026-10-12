import { describe, expect, it } from 'vitest'
import { flipMoves, reordered, riseDelays, riseOf, riseOvershoot, type RowMove } from '../src/renderer/src/flip'

describe('reordered', () => {
  it('is false when nothing moved', () => {
    expect(reordered(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(false)
  })

  it('is false when a row is added or removed but the rest keep their order', () => {
    expect(reordered(['a', 'b'], ['n', 'a', 'b'])).toBe(false)
    expect(reordered(['a', 'b', 'c'], ['a', 'c'])).toBe(false)
  })

  it('is true when a chat moves to the top', () => {
    expect(reordered(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true)
  })
})

describe('flipMoves', () => {
  const viewport = { top: 0, bottom: 400 }
  const prev = new Map([
    ['a', 0],
    ['b', 68],
    ['c', 136]
  ])

  it('returns the rows that changed place, with where they were and are', () => {
    const next = [
      { id: 'c', y: 0, size: 68 },
      { id: 'a', y: 68, size: 68 },
      { id: 'b', y: 136, size: 68 }
    ]
    expect(flipMoves(prev, next, viewport)).toEqual([
      { id: 'c', from: 136, to: 0 },
      { id: 'a', from: 0, to: 68 },
      { id: 'b', from: 68, to: 136 }
    ])
  })

  it('skips rows that did not move', () => {
    expect(flipMoves(prev, [{ id: 'a', y: 0, size: 68 }], viewport)).toEqual([])
    expect(flipMoves(prev, [{ id: 'a', y: 1, size: 68 }], viewport)).toEqual([])
  })

  it('skips rows that were off screen before or end up off screen', () => {
    const far = new Map([['z', 2000]])
    expect(flipMoves(far, [{ id: 'z', y: 0, size: 68 }], viewport)).toEqual([])
    expect(flipMoves(prev, [{ id: 'a', y: 900, size: 68 }], viewport)).toEqual([])
  })

  it('skips rows that were not there before', () => {
    expect(flipMoves(prev, [{ id: 'new', y: 0, size: 68 }], viewport)).toEqual([])
  })
})

describe('riseOf', () => {
  const size = 68
  // c rises from the third place to the first; a and b make room.
  const risen: RowMove[] = [
    { id: 'c', from: 136, to: 0 },
    { id: 'a', from: 0, to: 68 },
    { id: 'b', from: 68, to: 136 }
  ]

  it('lifts the one chat that rose by more than a place; the rows it passes part, further ones later', () => {
    expect(riseOf(risen, size)).toEqual([
      { id: 'c', distance: 2, lift: true, role: 'mover', steps: 0 },
      { id: 'a', distance: -1, lift: false, role: 'part', steps: 2 },
      { id: 'b', distance: -1, lift: false, role: 'part', steps: 1 }
    ])
  })

  it('caps the stagger at six places', () => {
    const moves: RowMove[] = [{ id: 'z', from: 68 * 9, to: 0 }]
    for (let i = 0; i < 9; i++) moves.push({ id: `r${i}`, from: i * 68, to: (i + 1) * 68 })
    const rise = riseOf(moves, size)
    expect(rise[0]).toMatchObject({ id: 'z', lift: true, distance: 9 })
    expect(Math.max(...rise.slice(1).map((r) => r.steps))).toBe(6)
    expect(rise.find((r) => r.id === 'r8')?.steps).toBe(1)
  })

  it('keeps the plain slide when a chat only rises one place', () => {
    const swap: RowMove[] = [
      { id: 'b', from: 68, to: 0 },
      { id: 'a', from: 0, to: 68 }
    ]
    expect(riseOf(swap, size).every((r) => r.role === 'plain' && !r.lift)).toBe(true)
  })

  it('keeps the plain slide when several chats rose (a reshuffle)', () => {
    const shuffle: RowMove[] = [
      { id: 'c', from: 136, to: 0 },
      { id: 'd', from: 204, to: 68 },
      { id: 'a', from: 0, to: 136 }
    ]
    expect(riseOf(shuffle, size).every((r) => r.role === 'plain' && !r.lift)).toBe(true)
  })

  it('does not lift a chat that fell, and has nothing to do for no moves', () => {
    expect(riseOf([{ id: 'a', from: 0, to: 204 }], size)).toEqual([{ id: 'a', distance: -3, lift: false, role: 'plain', steps: 0 }])
    expect(riseOf([], size)).toEqual([])
  })
})

describe('riseOvershoot', () => {
  it('is 10 % of the travel scaled by the bounce, never more than 20 px, and 0 without bounce', () => {
    expect(riseOvershoot(100, 1)).toBeCloseTo(0.1)
    expect(riseOvershoot(1000, 1) * 1000).toBeCloseTo(20)
    expect(riseOvershoot(300, 0)).toBe(0)
    expect(riseOvershoot(0, 1)).toBe(0)
  })
})

describe('riseDelays', () => {
  it('waits for the lift and 25 ms a place (up to six) for a fresh rise', () => {
    expect(riseDelays(false, 0)).toEqual({ mover: 160, part: 160, dot: 720 })
    expect(riseDelays(false, 3).part).toBe(235)
    expect(riseDelays(false, 9).part).toBe(310)
  })

  it('does not wait at all when it continues a rise that is under way', () => {
    expect(riseDelays(true, 4)).toEqual({ mover: 0, part: 0, dot: 560 })
  })
})
