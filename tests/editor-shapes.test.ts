import { describe, expect, it } from 'vitest'
import { bbox, clampRect, constrain, hitTest, isEmpty, nextNumber, normRect, translate, unitFor, type Shape } from '../src/renderer/src/editor/shapes'

const measure = (text: string, px: number): number => text.length * px * 0.5
const unit = unitFor(1600, 1000)

describe('photo editor geometry', () => {
  it('normalises and clamps rectangles dragged in any direction', () => {
    expect(normRect({ x: 50, y: 40 }, { x: 10, y: 90 })).toEqual({ x: 10, y: 40, w: 40, h: 50 })
    expect(clampRect({ x: -20, y: 10, w: 100, h: 2000 }, 60, 500)).toEqual({ x: 0, y: 10, w: 60, h: 490 })
  })

  it('snaps lines to 45° and boxes to squares with Shift', () => {
    const p = constrain('arrow', { x: 0, y: 0 }, { x: 100, y: 8 })
    expect(Math.round(p.y)).toBe(0)
    expect(Math.round(p.x)).toBe(100)
    const d = constrain('arrow', { x: 0, y: 0 }, { x: 100, y: 90 })
    expect(Math.round(d.x)).toBe(Math.round(d.y))
    expect(constrain('rect', { x: 10, y: 10 }, { x: 60, y: -20 })).toEqual({ x: 60, y: -40 })
  })

  it('picks the topmost mark, and a diagonal arrow only near its line', () => {
    const arrow: Shape = { id: 1, kind: 'arrow', a: { x: 0, y: 0 }, b: { x: 400, y: 400 }, color: '#FF3B30', size: 1 }
    const box: Shape = { id: 2, kind: 'rect', a: { x: 180, y: 180 }, b: { x: 260, y: 260 }, color: '#0A84FF', size: 1 }
    expect(hitTest([arrow], { x: 200, y: 202 }, unit, measure, 4)?.id).toBe(1)
    expect(hitTest([arrow], { x: 350, y: 60 }, unit, measure, 4)).toBeUndefined()
    expect(hitTest([arrow, box], { x: 200, y: 202 }, unit, measure, 4)?.id).toBe(2)
  })

  it('sizes text by its longest line and number of lines', () => {
    const text: Shape = { id: 3, kind: 'text', at: { x: 10, y: 20 }, text: 'ab\nabcd', color: '#fff', size: 1 }
    const r = bbox(text, unit, measure)
    expect(r.x).toBe(10)
    expect(r.w).toBeCloseTo(4 * unit * 10 * 0.5)
    expect(r.h).toBeCloseTo(2 * unit * 10 * 1.25)
  })

  it('moves every kind of mark', () => {
    const pen: Shape = { id: 4, kind: 'pen', points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], color: '#000', size: 0 }
    expect(translate(pen, 10, -1)).toMatchObject({ points: [{ x: 11, y: 0 }, { x: 15, y: 4 }] })
    const n: Shape = { id: 5, kind: 'number', at: { x: 3, y: 3 }, n: 1, color: '#000', size: 0 }
    expect(translate(n, 2, 2)).toMatchObject({ at: { x: 5, y: 5 } })
  })

  it('numbers steps after the highest one and drops accidental clicks', () => {
    const shapes: Shape[] = [
      { id: 1, kind: 'number', at: { x: 0, y: 0 }, n: 1, color: '#000', size: 0 },
      { id: 2, kind: 'number', at: { x: 0, y: 0 }, n: 4, color: '#000', size: 0 }
    ]
    expect(nextNumber(shapes)).toBe(5)
    expect(nextNumber([])).toBe(1)
    expect(isEmpty({ id: 9, kind: 'rect', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, color: '#000', size: 0 }, unit)).toBe(true)
    expect(isEmpty({ id: 9, kind: 'arrow', a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, color: '#000', size: 0 }, unit)).toBe(false)
    expect(isEmpty({ id: 9, kind: 'text', at: { x: 0, y: 0 }, text: '   ', color: '#000', size: 0 }, unit)).toBe(true)
  })
})
