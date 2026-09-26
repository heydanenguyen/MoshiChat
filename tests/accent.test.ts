import { describe, expect, it } from 'vitest'
import { accentVars, isHexColor, luminance, textOn } from '../src/shared/accent'

describe('custom accents', () => {
  it('validates hex colours', () => {
    expect(isHexColor('#1F6BFF')).toBe(true)
    expect(isHexColor('1F6BFF')).toBe(false)
    expect(isHexColor('#fff')).toBe(false)
    expect(isHexColor('red')).toBe(false)
  })

  it('picks readable text', () => {
    expect(textOn({ from: '#1F6BFF' })).toBe('#ffffff')
    expect(textOn({ from: '#FFC21A' })).toBe('#141414')
    // a gradient ending in a pale colour needs dark text
    expect(textOn({ from: '#1F6BFF', to: '#FFF3B0' })).toBe('#141414')
    expect(luminance('#ffffff')).toBeCloseTo(1)
    expect(luminance('#000000')).toBeCloseTo(0)
  })

  it('builds solid and gradient variables', () => {
    const solid = accentVars({ from: '#10A862' })
    expect(solid['--bubble-out']).toBe('#10A862')
    expect(solid['--accent-gradient']).toBe('#10A862')
    expect(solid['--accent-soft']).toBe('rgba(16, 168, 98, 0.14)')
    const gradient = accentVars({ from: '#FF5B1F', to: '#9B5DE5' })
    expect(gradient['--bubble-out']).toBe('linear-gradient(135deg, #FF5B1F 0%, #9B5DE5 100%)')
    expect(gradient['--accent-2']).toBe('#9B5DE5')
  })

  it('falls back safely on bad input', () => {
    expect(accentVars({ from: 'nope' })['--bubble-out']).toBe('#4f7df3')
    expect(accentVars({ from: '#FF5B1F', to: 'bad' })['--bubble-out']).toBe('#FF5B1F')
  })
})
