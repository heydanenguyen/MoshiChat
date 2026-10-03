import { describe, expect, it } from 'vitest'
import { PIXEL_ART, PIXEL_GRID, PIXEL_TILE, MONO_HUES, pixelPath, tagPastel } from '../src/shared/pixel-art'
import { PLATFORM_ORDER, TAG_PALETTE, iconStyleOf } from '../src/shared/types'

/** Everything the tile icon sets draw: the apps, the Settings pages and the sidebar's own items. */
const TILE_ICONS = [...PLATFORM_ORDER, 'general', 'appearance', 'accounts', 'chat', 'notifications', 'tags', 'ai', 'data', 'inbox', 'todos', 'insights']

describe('pixel art', () => {
  it('draws every glyph on the full 9x9 grid, in pixels and blanks only', () => {
    for (const [name, rows] of Object.entries(PIXEL_ART)) {
      expect(rows, name).toHaveLength(PIXEL_GRID)
      for (const row of rows) expect(row, name).toMatch(new RegExp(`^[#.]{${PIXEL_GRID}}$`))
    }
  })

  it('has a glyph and a tile for every icon the tile sets draw', () => {
    for (const name of TILE_ICONS) {
      expect(PIXEL_ART[name as keyof typeof PIXEL_ART], name).toBeDefined()
      expect(PIXEL_TILE[name as keyof typeof PIXEL_TILE], name).toBeDefined()
    }
  })

  it('turns each run of pixels into one closed rectangle', () => {
    // inbox row 4 is '###...###': two runs
    const path = pixelPath('inbox')
    expect(path).toContain('M0 4h3v1h-3z')
    expect(path).toContain('M6 4h3v1h-3z')
    const pixels = PIXEL_ART.inbox.join('').split('').filter((c) => c === '#').length
    const drawn = [...path.matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0)
    expect(drawn).toBe(pixels)
  })
})

describe('icon style in use', () => {
  it('follows the surface style until one is picked', () => {
    expect(iconStyleOf({})).toBe('classic')
    expect(iconStyleOf({ style: 'liquid' })).toBe('liquid')
    expect(iconStyleOf({ style: 'mono' })).toBe('pixel')
    expect(iconStyleOf({ style: 'mono', iconStyle: 'gummy' })).toBe('gummy')
    expect(iconStyleOf({ style: 'moshi', iconStyle: 'pixel' })).toBe('pixel')
  })
})

describe('tag pastels (Mono)', () => {
  it('gives every colour of the tag palette its own pastel', () => {
    const pastels = TAG_PALETTE.map((p) => tagPastel(p.color))
    expect(new Set(pastels).size).toBe(TAG_PALETTE.length)
    for (const p of pastels) expect(Object.values(MONO_HUES)).toContain(p)
  })

  it('gives the built-in tags their Mono hues, unless recoloured', () => {
    expect(tagPastel('#E0457F', 'love')).toBe(MONO_HUES.redDeep)
    expect(tagPastel('#A052E8', 'vip')).toBe(MONO_HUES.yellow)
    expect(tagPastel('#11996A', 'family')).toBe(MONO_HUES.periwinkle)
    expect(tagPastel('#EC7212', 'friend')).toBe(MONO_HUES.teal)
    expect(tagPastel('#3B82EE', 'love')).toBe(MONO_HUES.blue)
  })

  it('maps a custom colour to the pastel nearest in hue, and a greyish one to grey', () => {
    expect(tagPastel('#ff1493')).toBe(MONO_HUES.pink)
    expect(tagPastel('#00b4ff')).toBe(MONO_HUES.sky)
    expect(tagPastel('#777780')).toBe(MONO_HUES.grey)
    expect(tagPastel('not a colour')).toBe(MONO_HUES.grey)
  })
})

