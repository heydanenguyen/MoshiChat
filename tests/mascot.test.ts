import { describe, expect, it } from 'vitest'
import { HOP_GAP_MS, hopAllowed, hopKeyframes, incomingSince, isPalLogo, isSleepy, mascotOn, nextIdleAct, peekStep, pupilOffset, sleepAfterMs } from '../src/renderer/src/motion/mascot'

const seq = (...values: number[]) => {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('nextIdleAct', () => {
  it('blinks seven times in ten, glances three in ten, 2.6-5.6 s apart', () => {
    expect(nextIdleAct(seq(0.5, 0), { sleeping: false, following: false })).toEqual({ act: 'blink', afterMs: 2600 })
    expect(nextIdleAct(seq(0.29, 1), { sleeping: false, following: false })).toEqual({ act: 'glance', afterMs: 5600 })
    expect(nextIdleAct(seq(0.3, 0.5), { sleeping: false, following: false }).act).toBe('blink')
    const spacing = Array.from({ length: 200 }, (_, i) => nextIdleAct(seq((i % 10) / 10, i / 200), { sleeping: false, following: false }).afterMs)
    expect(Math.min(...spacing)).toBeGreaterThanOrEqual(2600)
    expect(Math.max(...spacing)).toBeLessThanOrEqual(5600)
  })
  it('does nothing asleep, and does not glance while the eyes follow the pointer', () => {
    expect(nextIdleAct(seq(0.1, 0.2), { sleeping: true, following: false }).act).toBe('none')
    expect(nextIdleAct(seq(0.9, 0.2), { sleeping: true, following: false }).act).toBe('none')
    expect(nextIdleAct(seq(0.1, 0.2), { sleeping: false, following: true }).act).toBe('none')
    expect(nextIdleAct(seq(0.9, 0.2), { sleeping: false, following: true }).act).toBe('blink')
  })
})

describe('pupilOffset', () => {
  const eye = { left: 100, top: 100, width: 20, height: 10 } // centre 110, 105
  it('looks toward the pointer by at most 4 px', () => {
    const right = pupilOffset({ x: 1000, y: 105 }, eye)
    expect(right.x).toBeCloseTo(4)
    expect(right.y).toBeCloseTo(0)
    const up = pupilOffset({ x: 110, y: -500 }, eye)
    expect(up.x).toBeCloseTo(0)
    expect(up.y).toBeCloseTo(-4)
    const diagonal = pupilOffset({ x: 5000, y: 5000 }, eye)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(4)
  })
  it('eases in over the first 140 px and sits still on top of the eyes', () => {
    expect(pupilOffset({ x: 110 + 70, y: 105 }, eye).x).toBeCloseTo(2)
    expect(pupilOffset({ x: 110, y: 105 }, eye)).toEqual({ x: 0, y: 0 })
    expect(pupilOffset({ x: 110.2, y: 105 }, eye)).toEqual({ x: 0, y: 0 })
  })
  it('takes another maximum', () => {
    expect(pupilOffset({ x: 1000, y: 105 }, eye, 2).x).toBeCloseTo(2)
  })
})

describe('sleep and hop timing', () => {
  it('falls asleep after 30 s without activity', () => {
    expect(sleepAfterMs).toBe(30_000)
    expect(isSleepy(0, 29_999)).toBe(false)
    expect(isSleepy(0, 30_000)).toBe(true)
    expect(isSleepy(10_000, 39_000)).toBe(false)
  })
  it('hops at most once per 1.5 s', () => {
    expect(HOP_GAP_MS).toBe(1500)
    expect(hopAllowed(1000, -Infinity)).toBe(true)
    expect(hopAllowed(2499, 1000)).toBe(false)
    expect(hopAllowed(2500, 1000)).toBe(true)
  })
  it('the hop is the demo squash and stretch', () => {
    const k = hopKeyframes()
    expect(k.map((f) => f.translate)).toEqual(['0 0', '0 -14px', '0 0', '0 0'])
    expect(k[1].scale).toBe('.95 1.07')
    expect(k[2].scale).toBe('1.08 .92')
    expect(k[1].offset).toBe(0.38)
    expect(k[2].offset).toBe(0.72)
  })
})

describe('incomingSince', () => {
  const now = 100_000
  const m = (id: string, isOutgoing: boolean, ago = 500) => ({ id, isOutgoing, sentAt: now - ago })
  it('counts a fresh incoming message after the last one seen', () => {
    expect(incomingSince('a', [m('a', false, 9000), m('b', false)], now)).toBe(true)
  })
  it('ignores our own sends', () => {
    expect(incomingSince('a', [m('a', false, 9000), m('b', true)], now)).toBe(false)
  })
  it('ignores old messages (history arriving) and an unknown starting point', () => {
    expect(incomingSince('a', [m('a', false, 99_000), m('b', false, 60_000)], now)).toBe(false)
    expect(incomingSince(undefined, [m('b', false)], now)).toBe(false)
    expect(incomingSince('gone', [m('b', false)], now)).toBe(false)
  })
  it('one incoming among our own still counts', () => {
    expect(incomingSince('a', [m('a', true, 9000), m('b', true), m('c', false)], now)).toBe(true)
  })
})

describe('incomingSince: system rows and the first message', () => {
  const now = 100_000
  it('a notice (a call ended) is not a message that arrives', () => {
    expect(incomingSince('a', [{ id: 'a', isOutgoing: false, sentAt: now - 9000 }, { id: 'n', isOutgoing: false, sentAt: now - 100, system: { kind: 'call' } }], now)).toBe(false)
  })
  it('the first message into a chat that loaded empty counts (null), an unloaded chat does not (undefined)', () => {
    const m = [{ id: 'b', isOutgoing: false, sentAt: now - 100 }]
    expect(incomingSince(null, m, now)).toBe(true)
    expect(incomingSince(undefined, m, now)).toBe(false)
    expect(incomingSince(null, [{ ...m[0], isOutgoing: true }], now)).toBe(false)
  })
})

describe('mascotOn', () => {
  it('is on in the Pals look whatever the logo, and with a Pals logo in any look', () => {
    expect(mascotOn('pals', 'buddies')).toBe(true)
    expect(mascotOn('pals', undefined)).toBe(true)
    expect(mascotOn('pals', 'pal-hoa')).toBe(true)
    expect(mascotOn('moshi', 'pal-hoa')).toBe(true)
    expect(mascotOn('liquid', 'pal-bong')).toBe(true)
    expect(mascotOn('mono', 'pal-co')).toBe(true)
  })
  it('is off for the other looks with a classic logo', () => {
    for (const style of ['moshi', 'liquid', 'mono', undefined]) for (const logo of ['buddies', 'sunny', 'grape', undefined]) expect(mascotOn(style, logo)).toBe(false)
  })
  it('knows a Pals logo', () => {
    expect(isPalLogo('pal-hoa')).toBe(true)
    expect(isPalLogo('buddies')).toBe(false)
    expect(isPalLogo(undefined)).toBe(false)
  })
})

describe('peekStep, the life of the peek', () => {
  it('slides in on a ring, only when the mascot is on and motion is not reduced', () => {
    expect(peekStep('out', true, true, false)).toBe('in')
    expect(peekStep('out', true, false, false)).toBe('out')
    expect(peekStep('out', true, true, true)).toBe('out')
  })
  it('stays in while it rings and slips back when the ring ends or the call is answered', () => {
    expect(peekStep('in', true, true, false)).toBe('in')
    expect(peekStep('in', false, true, false)).toBe('leaving')
    expect(peekStep('in', true, false, false)).toBe('leaving')
  })
  it('leaves when the mascot turns off mid-ring, never starts by itself, and a ring during the retreat brings it back', () => {
    expect(peekStep('out', false, true, false)).toBe('out')
    expect(peekStep('leaving', false, true, false)).toBe('leaving')
    expect(peekStep('leaving', true, true, false)).toBe('in')
  })
})
