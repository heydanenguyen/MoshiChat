import { describe, expect, it } from 'vitest'
import { leadingEdge, pillEdges } from '../src/renderer/src/motion/pill'

// A bar from x 100 to 500 with the pill layer spanning all of it, and four equal tabs of 100.
const pill = { left: 100, right: 500 }
const tabs = [
  { left: 100, right: 200 },
  { left: 200, right: 300 },
  { left: 300, right: 400 },
  { left: 400, right: 500 }
]

describe('pillEdges', () => {
  it('cuts in the left edge to the tab start and the right edge to the tab end', () => {
    expect(pillEdges(tabs, 0, pill)).toEqual({ l: 0, r: 300 })
    expect(pillEdges(tabs, 1, pill)).toEqual({ l: 100, r: 200 })
    expect(pillEdges(tabs, 3, pill)).toEqual({ l: 300, r: 0 })
  })
  it('works with a bar that does not start at 0 and a pill inset from the tabs', () => {
    const inset = { left: 108, right: 492 }
    expect(pillEdges(tabs, 1, inset)).toEqual({ l: 92, r: 192 })
  })
  it('clamps an index outside the tabs and survives having none', () => {
    expect(pillEdges(tabs, -3, pill)).toEqual(pillEdges(tabs, 0, pill))
    expect(pillEdges(tabs, 9, pill)).toEqual(pillEdges(tabs, 3, pill))
    expect(pillEdges([], 0, pill)).toEqual({ l: 0, r: 0 })
  })
  it('keeps the pill as wide as the tab', () => {
    for (let i = 0; i < tabs.length; i++) {
      const { l, r } = pillEdges(tabs, i, pill)
      expect(pill.right - pill.left - l - r).toBe(tabs[i].right - tabs[i].left)
    }
  })
})

describe('leadingEdge', () => {
  it('is the right edge going right and the left edge going left', () => {
    expect(leadingEdge(0, 2)).toBe('r')
    expect(leadingEdge(3, 1)).toBe('l')
  })
})
