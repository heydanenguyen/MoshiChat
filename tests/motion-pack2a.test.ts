import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BURST_GAP_MS, BURST_MS, PARTICLES, burstAllowed, burstColors, burstKeyframes } from '../src/renderer/src/motion/burst'
import { MAX_TILT, PRESSABLE, tiltFor } from '../src/renderer/src/motion/press'

describe('burstKeyframes', () => {
  const all = Array.from({ length: PARTICLES }, (_, i) => burstKeyframes(i, 12345))

  it('is the same burst for the same seed and a different one for another', () => {
    expect(burstKeyframes(3, 99)).toEqual(burstKeyframes(3, 99))
    expect(burstKeyframes(3, 99)).not.toEqual(burstKeyframes(3, 100))
  })

  it('is four emoji copies (13-19 px) and four specks (6-9 px), two colours of each', () => {
    expect(all.filter((p) => p.kind === 'emoji')).toHaveLength(4)
    expect(all.filter((p) => p.kind === 'speck')).toHaveLength(4)
    for (const p of all) {
      const [min, max] = p.kind === 'emoji' ? [13, 19] : [6, 9]
      expect(p.size).toBeGreaterThanOrEqual(min)
      expect(p.size).toBeLessThanOrEqual(max)
    }
    expect(new Set(all.filter((p) => p.kind === 'speck').map((p) => p.color))).toEqual(new Set([0, 1]))
  })

  it('starts at the tap and flies up on a parabola that gravity bends back down', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (let i = 0; i < PARTICLES; i++) {
        const { frames } = burstKeyframes(i, seed)
        expect(frames[0]).toMatchObject({ offset: 0, x: 0, y: 0, rotate: 0, opacity: 1 })
        expect(frames.at(-1)?.offset).toBe(1)
        // the launch is within -90 deg +- 75 deg of straight up: always upward (y falls first)
        expect(frames[1].y).toBeLessThan(0)
        // the vertical speed is gravity-shaped: the later steps climb less than the earlier ones
        const dy = frames.slice(1).map((f, k) => f.y - frames[k].y)
        for (let k = 1; k < dy.length; k++) expect(dy[k]).toBeGreaterThan(dy[k - 1])
      }
    }
  })

  it('launches at 80-150 px/s, turns at most 70 degrees and fades from 55 %', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (let i = 0; i < PARTICLES; i++) {
        const { frames } = burstKeyframes(i, seed)
        const dt = (frames[1].offset * BURST_MS) / 1000
        // first step: position = v t + g t^2 / 2
        const vx = frames[1].x / dt
        const vy = (frames[1].y - 0.5 * 230 * dt * dt) / dt
        const speed = Math.hypot(vx, vy)
        expect(speed).toBeGreaterThan(79)
        expect(speed).toBeLessThan(151)
        const angle = (Math.atan2(vy, vx) * 180) / Math.PI
        expect(angle).toBeGreaterThanOrEqual(-165.5)
        expect(angle).toBeLessThanOrEqual(-14.5)
        expect(Math.abs(frames.at(-1)!.rotate)).toBeLessThanOrEqual(70)
        for (const f of frames) {
          if (f.offset <= 0.55) expect(f.opacity).toBe(1)
          else expect(f.opacity).toBeLessThan(1)
        }
        expect(frames.at(-1)?.opacity).toBe(0)
      }
    }
  })
})

describe('burst timing and colours', () => {
  it('allows one burst per 150 ms', () => {
    expect(burstAllowed(1000, 900)).toBe(false)
    expect(burstAllowed(1000, 1000 - BURST_GAP_MS)).toBe(true)
    expect(burstAllowed(5000, 0)).toBe(true)
  })

  it('has two colours per emoji family, the accent for the rest', () => {
    expect(burstColors('❤️')).toEqual(['#ff4d6d', '#ff9eb5'])
    expect(burstColors('😂')).toEqual(['#ffc53d', '#ff8a3d'])
    expect(burstColors('👍')).toEqual(['#2f5fe0', '#7aa2ff'])
    expect(burstColors('🙏')[0]).toBe('var(--accent)')
  })
})

describe('tiltFor', () => {
  const rect = { left: 100, top: 50, width: 32, height: 32 }

  it('does not tilt a press in the middle', () => {
    expect(tiltFor({ x: 116, y: 66 }, rect)).toEqual({ rx: 0, ry: 0 })
  })

  it('dips the side that is pressed: right gives +ry, the bottom gives -rx', () => {
    expect(tiltFor({ x: 132, y: 66 }, rect)).toEqual({ rx: 0, ry: MAX_TILT })
    expect(tiltFor({ x: 100, y: 66 }, rect)).toEqual({ rx: 0, ry: -MAX_TILT })
    expect(tiltFor({ x: 116, y: 82 }, rect)).toEqual({ rx: -MAX_TILT, ry: 0 })
    expect(tiltFor({ x: 116, y: 50 }, rect)).toEqual({ rx: MAX_TILT, ry: 0 })
  })

  it('never goes past 2 degrees, even for a point outside the box, and survives an empty box', () => {
    expect(tiltFor({ x: 900, y: -900 }, rect)).toEqual({ rx: MAX_TILT, ry: MAX_TILT })
    expect(tiltFor({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ rx: 0, ry: 0 })
  })
})

describe('press feel stylesheet', () => {
  const css = readFileSync('src/renderer/src/styles/app.css', 'utf8')
  const section = css.slice(css.indexOf('/* ==== Motion pack 2 (ideas 3, 11, 19)'))

  it('styles every pressable class and never a row', () => {
    for (const cls of PRESSABLE.split(',').map((c) => c.trim())) expect(section).toContain(cls)
    expect(PRESSABLE).not.toContain('conv-row')
    expect(PRESSABLE).not.toContain('conv-item')
  })

  it('dips on :active or .pressed in 90 ms, with the transform sprung back on --spring-soft, and falls back to opacity under reduced motion', () => {
    expect(section).toMatch(/:is\(:active, \.pressed\)\s*\{\s*transform: perspective\(240px\) rotateX\(var\(--rx, 0deg\)\) rotateY\(var\(--ry, 0deg\)\) scale\(0\.96\) !important/)
    expect(section).toContain('transform 90ms ease-out')
    expect(section).toContain('transform var(--spring-soft-ms, 280ms) var(--spring-soft')
    expect(section).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*:root:root[\s\S]*?opacity: 0\.7/)
  })

  it('moves nothing on hover in its own section', () => {
    const hover = [...section.matchAll(/([^{}]*:hover[^{}]*)\{([^{}]*)\}/g)].filter((m) => /transform|scale|translate|rotate/.test(m[2]))
    expect(hover).toEqual([])
  })
})
