import { describe, expect, it } from 'vitest'
import { accentVars, darkBaseVars, isHexColor, luminance, textOn } from '../src/shared/accent'
import { darkBaseHex } from '../src/shared/types'

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

describe('dark base tone', () => {
  it('derives the dark surfaces a few steps above the base', () => {
    const vars = darkBaseVars('#161618')
    expect(vars['--dark-base']).toBe('#161618')
    expect(vars['--dark-sidebar']).toBe('#1b1b1d')
    expect(vars['--dark-glass']).toBe('rgba(31, 31, 33, 0.62)')
    expect(vars['--dark-elevated']).toBe('rgba(41, 41, 43, 0.96)')
  })
  it('lands within a couple of steps of the hand-tuned navy defaults', () => {
    const vars = darkBaseVars('#0f1122')
    expect(vars['--dark-sidebar']).toBe('#141627') // stylesheet: #14162a
    expect(vars['--dark-glass']).toBe('rgba(24, 26, 43, 0.62)') // stylesheet: rgba(24, 26, 44, 0.62)
    expect(vars['--dark-ring-gap']).toBe('#1a1c2d') // stylesheet: #1a1c2e
  })
  it('falls back to navy for a bad colour and never overflows on black or white', () => {
    expect(darkBaseVars('nope')['--dark-base']).toBe('#0f1122')
    expect(darkBaseVars('#000000')['--dark-sidebar']).toBe('#050505')
    expect(darkBaseVars('#ffffff')['--dark-ring-gap']).toBe('#ffffff')
  })
  it('resolves presets, custom hex and nothing', () => {
    expect(darkBaseHex('graphite')).toBe('#161618')
    expect(darkBaseHex('#1a1a1a')).toBe('#1a1a1a')
    expect(darkBaseHex(undefined)).toBe('#0f1122')
    expect(darkBaseHex('bogus')).toBe('#0f1122')
  })
})
