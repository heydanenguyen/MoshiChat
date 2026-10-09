import { describe, expect, it } from 'vitest'
import { flipMoves, reordered } from '../src/renderer/src/flip'

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
