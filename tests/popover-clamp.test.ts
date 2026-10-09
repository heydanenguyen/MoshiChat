import { describe, expect, it } from 'vitest'
import { popoverClampHeight } from '../src/renderer/src/popover'

describe('popoverClampHeight', () => {
  const panel = { top: 100, bottom: 700 }

  it('is undefined when the popover fits', () => {
    expect(popoverClampHeight({ top: 300, bottom: 660 }, panel)).toBeUndefined()
  })

  it('shrinks from the top when an upward popover is cut off there', () => {
    // bottom stays at 660; the top may reach 100 + 12
    expect(popoverClampHeight({ top: 40, bottom: 660 }, panel)).toBe(548)
  })

  it('shrinks from the bottom when a downward popover is cut off there', () => {
    expect(popoverClampHeight({ top: 400, bottom: 800 }, panel)).toBe(288)
  })

  it('fits a popover taller than the panel to the panel', () => {
    expect(popoverClampHeight({ top: 0, bottom: 900 }, panel)).toBe(576)
  })

  it('never goes below the floor', () => {
    expect(popoverClampHeight({ top: 0, bottom: 130 }, panel)).toBe(120)
  })
})
