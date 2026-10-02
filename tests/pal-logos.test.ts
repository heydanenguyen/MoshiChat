import { describe, expect, it } from 'vitest'
import { ALL_LOGOS, LOGOS, LOGO_ORDER, PAL_LOGO_ORDER, isLogoId, logoIconSvg, logoMarkInner } from '../src/shared/logos'
import { CAST } from '../src/shared/pals-art'
import { isStickerId } from '../src/shared/stickers'

describe('Pals as logos', () => {
  it('offers every pal of the cast after the six Moshi characters', () => {
    expect(PAL_LOGO_ORDER).toEqual(CAST.map((c) => `pal-${c.id}`))
    expect(ALL_LOGOS).toEqual([...LOGO_ORDER, ...PAL_LOGO_ORDER])
    for (const id of PAL_LOGO_ORDER) expect(LOGOS[id].name.vi.length).toBeGreaterThan(0)
  })

  it('accepts only known logos (the id becomes an icon file name in the main process)', () => {
    expect(isLogoId('pal-hoa')).toBe(true)
    expect(isLogoId('buddies')).toBe(true)
    expect(isLogoId('pal-nobody')).toBe(false)
    expect(isLogoId('pal-../../secret')).toBe(false)
    expect(isLogoId(undefined)).toBe(false)
  })

  it('draws a pal mark that blinks like the others, on its own tile', () => {
    const mark = logoMarkInner('pal-ma')
    expect(mark).toContain('buddy-eyes')
    expect(mark).toContain('radialGradient')
    expect(logoMarkInner('pal-ma', 'calm')).not.toBe(mark)
    expect(logoIconSvg('pal-ma')).toContain(LOGOS['pal-ma'].background)
  })

  it('keeps the logo sticker packs to the six Moshi characters', () => {
    expect(isStickerId('buddies-love')).toBe(true)
    expect(isStickerId('pal-hoa-love')).toBe(false)
  })
})
