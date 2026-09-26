import { describe, expect, it } from 'vitest'
import { clampZoom, stepZoom } from '../src/shared/types'

describe('interface zoom', () => {
  it('steps through the presets and stays in range', () => {
    expect(stepZoom(undefined, 1)).toBe(1.1)
    expect(stepZoom(1.1, 1)).toBe(1.25)
    expect(stepZoom(1.25, -1)).toBe(1.1)
    expect(stepZoom(2, 1)).toBe(2)
    expect(stepZoom(0.8, -1)).toBe(0.8)
    expect(stepZoom(1.3, -1)).toBe(1.25)
    expect(clampZoom(5)).toBe(2)
    expect(clampZoom(Number.NaN)).toBe(1)
  })
})
