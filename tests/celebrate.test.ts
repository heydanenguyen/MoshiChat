import { describe, expect, it } from 'vitest'
import {
  CONFETTI_COUNT,
  CONFETTI_MAX,
  DRAG,
  GRAVITY,
  HEARTS_MAX,
  HEART_COLORS,
  HEART_COUNT,
  SHINE,
  confettiColors,
  fadeOf,
  heartPose,
  makeConfetti,
  makeHearts,
  riseScale,
  seededRandom,
  shineDelay,
  shineEnd,
  stepAll,
  stepPiece
} from '../src/renderer/src/motion/celebrate'

describe('confetti', () => {
  const colors = confettiColors('#2f5fe0')
  it('is 60 pieces in six colours, accent first, thrown up from two thirds down', () => {
    expect(colors).toEqual(['#2f5fe0', '#ff5b1f', '#ff8fc7', '#ffc53d', '#1fa35a', '#8a6bff'])
    const parts = makeConfetti(seededRandom(1), 600, 900, colors)
    expect(parts).toHaveLength(CONFETTI_COUNT)
    expect(CONFETTI_COUNT).toBe(60)
    expect(new Set(parts.map((p) => p.color)).size).toBe(6)
    expect(parts[0].color).toBe('#2f5fe0')
    for (const p of parts) {
      expect(p.y).toBeCloseTo(594)
      expect(Math.abs(p.x - 300)).toBeLessThanOrEqual(24)
      expect(p.vy).toBeLessThanOrEqual(-420)
      expect(p.vy).toBeGreaterThanOrEqual(-820)
      expect(Math.abs(p.vx)).toBeLessThanOrEqual(340)
      expect(p.max).toBe(2.5)
    }
  })
  it('is the same shower for the same seed', () => {
    expect(makeConfetti(seededRandom(7), 400, 400, colors)).toEqual(makeConfetti(seededRandom(7), 400, 400, colors))
    expect(makeConfetti(seededRandom(7), 400, 400, colors)).not.toEqual(makeConfetti(seededRandom(8), 400, 400, colors))
  })
  it('falls under 900 px/s² gravity with exp(-1.9 dt) drag', () => {
    expect(GRAVITY).toBe(900)
    expect(DRAG).toBe(1.9)
    const [p] = makeConfetti(seededRandom(3), 400, 400, colors)
    const { vx, vy, y } = p
    stepPiece(p, 0.016)
    const drag = Math.exp(-1.9 * 0.016)
    expect(p.vx).toBeCloseTo(vx * drag)
    expect(p.vy).toBeCloseTo((vy + 900 * 0.016) * drag)
    expect(p.y).toBeCloseTo(y + p.vy * 0.016)
  })
  it('is all gone by 2.5 s and fades over the last half second', () => {
    let parts = makeConfetti(seededRandom(5), 500, 500, colors)
    let t = 0
    while (parts.length && t < 5) {
      parts = stepAll(parts, 1 / 60)
      t += 1 / 60
    }
    expect(t).toBeLessThanOrEqual(CONFETTI_MAX + 0.05)
    expect(t).toBeGreaterThan(CONFETTI_MAX - 0.05)
    const p = makeConfetti(seededRandom(5), 500, 500, colors)[0]
    p.age = 1
    expect(fadeOf(p)).toBe(1)
    p.age = 2.25
    expect(fadeOf(p)).toBeCloseTo(0.5)
    p.age = 2.5
    expect(fadeOf(p)).toBe(0)
  })
  it('a stalled frame counts for at most 34 ms', () => {
    const a = makeConfetti(seededRandom(9), 400, 400, colors)
    const b = makeConfetti(seededRandom(9), 400, 400, colors)
    stepAll(a, 5)
    stepAll(b, 0.034)
    expect(a[0].y).toBeCloseTo(b[0].y)
  })
})

describe('hearts', () => {
  it('is 14 hearts in two pinks, starting under the bottom edge 70 ms apart, all gone within 2.8 s', () => {
    expect(HEART_COUNT).toBe(14)
    const hearts = makeHearts(seededRandom(2), 500, 380)
    expect(hearts).toHaveLength(14)
    expect(new Set(hearts.map((h) => h.color))).toEqual(new Set(HEART_COLORS))
    hearts.forEach((h, i) => {
      expect(h.y).toBeGreaterThanOrEqual(380)
      expect(h.age).toBeCloseTo(-i * 0.07)
      // it waits i * 70 ms, and every heart is gone 2.8 s after the shower began
      expect(h.max - h.age).toBeCloseTo(HEARTS_MAX)
    })
    let parts = hearts
    let t = 0
    while (parts.length && t < 6) {
      parts = stepAll(parts, 1 / 60)
      t += 1 / 60
    }
    expect(t).toBeLessThanOrEqual(HEARTS_MAX + 0.05)
    expect(t).toBeGreaterThan(HEARTS_MAX - 0.1)
  })
  it('drifts up, sways and tilts by at most .45 rad', () => {
    const [h] = makeHearts(seededRandom(4), 500, 380)
    h.age = 0
    const y = h.y
    stepPiece(h, 0.1)
    expect(h.y).toBeLessThan(y)
    for (let age = 0; age < 3; age += 0.05) {
      h.age = age
      const pose = heartPose(h)
      expect(Math.abs(pose.rotate)).toBeLessThanOrEqual(0.45)
      expect(Math.abs(pose.x - h.x)).toBeLessThanOrEqual(20)
    }
    h.age = 0
    expect(heartPose(h).scale).toBeCloseTo(0.55 * h.s)
    h.age = 0.6
    expect(heartPose(h).scale).toBeCloseTo(h.s)
  })
  it('rises faster in a tall column, the demo speed in a short one', () => {
    expect(riseScale(300)).toBe(1)
    expect(riseScale(760)).toBeCloseTo(2)
    expect(riseScale(5000)).toBe(2.4)
  })
})

describe('sticker shine', () => {
  it('gloss 520 ms after the landing for 560 ms, three sparkles 110 ms apart', () => {
    expect(SHINE.glossDelay).toBe(520)
    expect(SHINE.glossMs).toBe(560)
    expect(SHINE.sparkMs).toBe(520)
    expect(SHINE.sparkStagger).toBe(110)
    expect(SHINE.sparks).toBe(3)
    expect(shineDelay(-1)).toBe(520)
    expect([0, 1, 2].map((i) => shineDelay(i))).toEqual([640, 750, 860])
    expect(shineEnd()).toBe(860 + 520)
  })
  it('carries on from what has already passed (a negative delay)', () => {
    expect(shineDelay(-1, 600)).toBe(-80)
    expect(shineDelay(0, 100)).toBe(540)
    expect(shineDelay(0, 99_999)).toBe(640 - 1500)
  })
})
