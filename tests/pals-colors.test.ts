import { describe, expect, it } from 'vitest'
import { AVATAR_FACES, CAST, PAL_FACES, palAvatarUrl, palOf, palPickId, palPickUrl, palPicks, palSvg, parsePalPickId } from '../src/shared/pals-art'

/** sRGB hex -> OKLCH (L 0..1, C, H degrees). */
function oklch(hex: string): { L: number; C: number; H: number } {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}

const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe('Pals cast colours', () => {
  for (const member of CAST) {
    for (const backdrop of member.backdrops) {
      it(`${member.id} stands out on ${backdrop}`, () => {
        const pal = oklch(member.edge ?? member.color)
        const back = oklch(backdrop)
        // A clear lightness step, so the silhouette reads at list size...
        expect(Math.abs(back.L - pal.L)).toBeGreaterThanOrEqual(0.09)
        // ...and a different hue family, so the two never melt into one blob.
        expect(hueGap(pal.H, back.H)).toBeGreaterThanOrEqual(45)
      })
    }
  }

  it('gives a name the same pal every time and spreads names across the cast', () => {
    expect(palOf('Lan Phương')).toEqual(palOf('Lan Phương'))
    expect(palAvatarUrl('Lan Phương')).toBe(palAvatarUrl('Lan Phương'))
    const used = new Set(Array.from({ length: 200 }, (_, i) => palOf(`person ${i}`).member.id))
    expect(used.size).toBe(CAST.length)
  })

  it('gives automatic avatars only friendly faces, and varies them within one pal', () => {
    const people = Array.from({ length: 400 }, (_, i) => palOf(`person ${i}`))
    for (const p of people) expect(AVATAR_FACES).toContain(p.spec.face)
    for (const face of ['sleepy', 'grumpy', 'cry', 'meh']) expect(AVATAR_FACES).not.toContain(face)
    // people who share a pal mostly differ in expression
    const suns = people.filter((p) => p.member.id === 'nang').map((p) => p.spec.face)
    expect(new Set(suns).size).toBeGreaterThanOrEqual(6)
  })

  it('only gives avatars faces with open eyes or a clear expression', () => {
    for (const member of CAST) expect(member.faces).not.toContain('sleepy')
  })

  it('has twelve distinct expressions, each drawn on every body', () => {
    expect(new Set(PAL_FACES).size).toBe(12)
    const drawn = new Set(PAL_FACES.map((face) => palSvg({ shape: 'scallop', color: '#96ccff', face }, 'x')))
    expect(drawn.size).toBe(12)
    for (const member of CAST) for (const face of PAL_FACES) expect(palSvg({ shape: member.shape, color: member.color, face }, 'x')).not.toContain('undefined')
  })

  it('draws every body and face without leftover placeholders', () => {
    for (const member of CAST)
      for (const face of member.faces) {
        const svg = palSvg({ shape: member.shape, color: member.color, color2: member.color2, face }, 't')
        expect(svg).not.toContain('CORE')
        expect(svg).not.toContain('undefined')
      }
  })
})

describe('Pals picked as a contact photo', () => {
  it('round-trips a pick and rejects anything else', () => {
    const pick = { member: CAST[0], face: 'love' as const, backdrop: 1 }
    const id = palPickId(pick)
    expect(id).toBe(`pal:${CAST[0].id}.love.1`)
    expect(parsePalPickId(id)).toEqual(pick)
    expect(palPickUrl(id)).toMatch(/^data:image\/svg\+xml/)
    for (const bad of ['pal:nobody.love.0', 'pal:hoa.shout.0', 'pal:hoa.love.9', 'pal:hoa.love', 'abstract:1.2.3.4.0']) expect(parsePalPickId(bad)).toBeUndefined()
  })

  it('offers the name its own pal first, then the whole cast, walking all expressions as it shuffles', () => {
    const first = palPicks('Lan Phương', 0)
    const own = palOf('Lan Phương')
    expect(first[0].member.id).toBe(own.member.id)
    expect(new Set(first.map((p) => p.member.id)).size).toBe(CAST.length)
    const seen = new Set<string>()
    for (let round = 1; round <= PAL_FACES.length; round++) for (const p of palPicks('x', round)) seen.add(p.face)
    expect(seen.size).toBe(PAL_FACES.length)
  })
})
