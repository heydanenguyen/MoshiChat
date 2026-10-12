import { describe, expect, it } from 'vitest'
import { bounceOf, springCacheSize, springEasing, springVars } from '../src/renderer/src/motion/spring'

/** The numbers inside a linear(...) string. */
function points(css: string): number[] {
  const m = /^linear\((.*)\)$/.exec(css)
  expect(m).not.toBeNull()
  return m![1].split(',').map((s) => parseFloat(s))
}

describe('springEasing', () => {
  it('starts at 0 and ends at exactly 1', () => {
    for (const os of [0, 0.06, 0.25, 0.5]) {
      const p = points(springEasing(320, os))
      expect(p[0]).toBe(0)
      expect(p[p.length - 1]).toBe(1)
    }
  })

  it('never overshoots and never goes back when there is no bounce', () => {
    const p = points(springEasing(320, 0))
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1])
    expect(Math.max(...p)).toBeLessThanOrEqual(1)
  })

  it('overshoots by about the asked fraction', () => {
    const peak = Math.max(...points(springEasing(320, 0.25)))
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeGreaterThan(1.2)
    expect(peak).toBeLessThan(1.27)
    const small = Math.max(...points(springEasing(360, 0.06)))
    expect(small).toBeGreaterThan(1.04)
    expect(small).toBeLessThan(1.07)
  })

  it('is sampled about every 12 ms, at least 24 points', () => {
    expect(points(springEasing(320, 0.25)).length).toBeGreaterThanOrEqual(24)
    expect(points(springEasing(100, 0)).length).toBeGreaterThanOrEqual(24)
    expect(points(springEasing(440, 0.3)).length).toBe(Math.ceil(440 / 12) + 1)
  })

  it('clamps the overshoot to [0, 0.5]', () => {
    expect(springEasing(300, -1)).toBe(springEasing(300, 0))
    expect(springEasing(300, 3)).toBe(springEasing(300, 0.5))
    expect(springEasing(300, Number.NaN)).toBe(springEasing(300, 0))
  })

  it('has settled before its last sample, for every spring', () => {
    for (const [name, value] of Object.entries(springVars(1))) {
      if (name.endsWith('-ms')) continue
      const p = points(value)
      expect(Math.abs(1 - p[p.length - 2])).toBeLessThan(0.01)
    }
    const p = points(springEasing(320, 0))
    expect(Math.abs(1 - p[p.length - 2])).toBeLessThan(0.01)
  })

  it('computes a curve once per key', () => {
    const before = springCacheSize()
    springEasing(777, 0.11)
    expect(springCacheSize()).toBe(before + 1)
    springEasing(777, 0.11)
    springEasing(777, 0.1100001) // the same key at three decimals
    expect(springCacheSize()).toBe(before + 1)
    springEasing(777, 0.12)
    expect(springCacheSize()).toBe(before + 2)
  })

  it('is deterministic and cached', () => {
    const a = springEasing(333, 0.2)
    expect(springEasing(333, 0.2)).toBe(a)
    expect(springEasing(333, 0.2)).toBe(a)
  })
})

describe('springVars', () => {
  it('emits an easing and a duration for every spring', () => {
    const v = springVars(1)
    for (const n of ['pop', 'settle', 'arrive', 'soft', 'exhale', 'sticker']) {
      expect(v[`--spring-${n}`]).toMatch(/^linear\(0, /)
      expect(v[`--spring-${n}-ms`]).toMatch(/^\d+ms$/)
    }
    expect(v['--spring-pop-ms']).toBe('320ms')
    expect(v['--spring-settle-ms']).toBe('360ms')
    expect(v['--spring-arrive-ms']).toBe('300ms')
    expect(v['--spring-soft-ms']).toBe('280ms')
    expect(v['--spring-exhale-ms']).toBe('360ms')
  })

  it('scales the overshoot by the bounce; at 0 nothing goes past 1', () => {
    expect(Math.max(...points(springVars(1)['--spring-pop']))).toBeGreaterThan(1.2)
    for (const [name, value] of Object.entries(springVars(0))) {
      if (name.endsWith('-ms')) continue
      expect(Math.max(...points(value))).toBeLessThanOrEqual(1)
    }
  })

  it('pop is the same curve as springEasing(320, .25 x bounce)', () => {
    expect(springVars(0.5)['--spring-pop']).toBe(springEasing(320, 0.125))
  })
})

describe('bounceOf', () => {
  it('Moshi and Liquid and Pals bounce, Mono does not', () => {
    expect(bounceOf(undefined)).toBe(1)
    expect(bounceOf('moshi')).toBe(1)
    expect(bounceOf('liquid')).toBe(1)
    expect(bounceOf('pals')).toBe(1)
    expect(bounceOf('mono')).toBe(0)
  })
})

describe('typing bubble linger', () => {
  it('stays for the rest of the cycle after typing stops, until a message arrives', async () => {
    const { nextHeld, lingerShown } = await import('../src/renderer/src/motion/linger')
    let held = nextHeld(true, null, 'm1')
    expect(held).toEqual({ key: 'm1' })
    expect(lingerShown(true, held, 'm1', false)).toBe(true)
    // typing stopped, nothing arrived: it lingers
    held = nextHeld(false, held, 'm1')
    expect(lingerShown(false, held, 'm1', false)).toBe(true)
    // the message arrived (a new newest id): gone at once
    expect(lingerShown(false, held, 'm2', false)).toBe(false)
    // reduced motion: no lingering
    expect(lingerShown(false, held, 'm1', true)).toBe(false)
    // never typed
    expect(lingerShown(false, null, 'm1', false)).toBe(false)
  })

  it('keeps the same object while on with the same key, follows a changed key', async () => {
    const { nextHeld } = await import('../src/renderer/src/motion/linger')
    const held = nextHeld(true, null, 'a')
    expect(nextHeld(true, held, 'a')).toBe(held)
    expect(nextHeld(true, held, 'b')).toEqual({ key: 'b' })
    expect(nextHeld(false, held, 'zzz')).toBe(held)
  })
})

describe('send hand-off (the platform echo of a temporary bubble carries on its entry)', () => {
  const temp = { id: 'temp-1', conversationId: 'c', text: 'hi', attachments: [] }
  const real = { id: 'real-9', conversationId: 'c', text: 'hi', attachments: [] }

  it('returns how long ago the temporary one was drawn, once', async () => {
    const { noteSent, takeSent, resetSent } = await import('../src/renderer/src/motion/handoff')
    resetSent()
    expect(noteSent(temp, 1000)).toBe(0)
    expect(noteSent(temp, 1050)).toBe(50) // drawn again (its run remounted): carries on from the first start
    expect(takeSent(real, 1080)).toBe(80)
    expect(takeSent(real, 1090)).toBe(90) // the same bubble asking again (a remount, strict mode) hears the same
    expect(takeSent({ ...real, id: 'real-10' }, 1090)).toBeUndefined()
  })

  it('does not mix up other chats, other texts, or old ones', async () => {
    const { noteSent, takeSent, resetSent } = await import('../src/renderer/src/motion/handoff')
    resetSent()
    noteSent(temp, 0)
    expect(takeSent({ ...real, conversationId: 'd' }, 10)).toBeUndefined()
    expect(takeSent({ ...real, text: 'other' }, 10)).toBeUndefined()
    expect(takeSent(real, 20_000)).toBeUndefined()
  })

  it('two identical sends hand off one each', async () => {
    const { noteSent, takeSent, resetSent } = await import('../src/renderer/src/motion/handoff')
    resetSent()
    noteSent(temp, 0)
    noteSent({ ...temp, id: 'temp-2' }, 100)
    expect(takeSent(real, 150)).toBe(150)
    expect(takeSent({ ...real, id: 'real-10' }, 160)).toBe(60)
  })
})
