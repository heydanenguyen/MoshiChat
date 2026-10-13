import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MAX, TH, iconLook, rubber, swipeAllowed, swipeDecision } from '../src/renderer/src/motion/swipe'
import { translateY } from '../src/renderer/src/motion/collapse'
import { digitChanges } from '../src/renderer/src/components/RollingNumber'
import { formatBadge } from '../src/renderer/src/quickFilter'
import { bounceOf, springVars } from '../src/renderer/src/motion/spring'

describe('swipe to reply', () => {
  it('rubber band: starts at the pointer, gets heavier, never passes MAX', () => {
    expect(rubber(0)).toBe(0)
    expect(rubber(-20)).toBe(0)
    expect(rubber(10)).toBeGreaterThan(9)
    expect(rubber(10)).toBeLessThan(10)
    let last = 0
    for (const d of [20, 50, 96, 200, 1000, 100000]) {
      const x = rubber(d)
      expect(x).toBeGreaterThan(last)
      expect(x).toBeLessThanOrEqual(MAX)
      last = x
    }
    expect(rubber(1000)).toBeCloseTo(MAX, 1)
  })

  it('needs a real pull to reach the threshold', () => {
    expect(rubber(TH)).toBeLessThan(TH)
    expect(rubber(62.7)).toBeGreaterThan(TH - 0.1)
  })

  it('8 px to the right starts a swipe; more than 12 px up or down first gives it back to scrolling', () => {
    expect(swipeDecision(3, 4, 'pending')).toBe('pending')
    expect(swipeDecision(8, 0, 'pending')).toBe('swiping')
    expect(swipeDecision(8, 11, 'pending')).toBe('swiping')
    expect(swipeDecision(2, 13, 'pending')).toBe('cancelled')
    expect(swipeDecision(2, -13, 'pending')).toBe('cancelled')
    expect(swipeDecision(-9, 0, 'pending')).toBe('cancelled')
  })

  it('a decision sticks', () => {
    expect(swipeDecision(0, 80, 'swiping')).toBe('swiping')
    expect(swipeDecision(60, 0, 'cancelled')).toBe('cancelled')
  })

  it('the icon grows in over the threshold', () => {
    expect(iconLook(0)).toEqual({ opacity: 0, scale: 0.4 })
    expect(iconLook(TH / 2).opacity).toBeCloseTo(0.5)
    expect(iconLook(TH)).toEqual({ opacity: 1, scale: 1 })
    expect(iconLook(500)).toEqual({ opacity: 1, scale: 1 })
    expect(iconLook(-10).opacity).toBe(0)
  })
})

describe('swipe pointers', () => {
  it('a finger or a pen swipes; a mouse drag keeps selecting text', () => {
    expect(swipeAllowed('touch')).toBe(true)
    expect(swipeAllowed('pen')).toBe(true)
    expect(swipeAllowed('mouse')).toBe(false)
    expect(swipeAllowed('')).toBe(false)
  })
})

describe('collapse', () => {
  it('reads the vertical part of a computed translate', () => {
    expect(translateY('none')).toBe(0)
    expect(translateY('0px 12.5px')).toBe(12.5)
    expect(translateY('4px')).toBe(0)
    expect(translateY(' 0px -8px ')).toBe(-8)
    expect(translateY('0px  3px')).toBe(3)
    expect(translateY('')).toBe(0)
    expect(translateY('garbage nope')).toBe(0)
  })
})

describe('rolling number', () => {
  it('counts positions from the right: the units digit stays the same cell', () => {
    expect(digitChanges('7', '8')).toEqual({ cells: ['roll'], exit: 0 })
    expect(digitChanges('9', '10')).toEqual({ cells: ['enter', 'roll'], exit: 0 })
    expect(digitChanges('10', '11')).toEqual({ cells: ['same', 'roll'], exit: 0 })
    expect(digitChanges('19', '20')).toEqual({ cells: ['roll', 'roll'], exit: 0 })
  })

  it('a lost digit exits on the left', () => {
    expect(digitChanges('10', '9')).toEqual({ cells: ['roll'], exit: 1 })
    expect(digitChanges('100', '9')).toEqual({ cells: ['roll'], exit: 2 })
  })

  it('rolls the digits of what formatBadge shows', () => {
    const rolled = (from: number, to: number): ReturnType<typeof digitChanges> => digitChanges(formatBadge(from), formatBadge(to))
    expect(rolled(9, 10)).toEqual({ cells: ['enter', 'roll'], exit: 0 })
    expect(rolled(99, 100)).toEqual({ cells: ['enter', 'same', 'roll'], exit: 0 })
    expect(rolled(100, 150)).toEqual({ cells: ['same', 'same', 'same'], exit: 0 })
    expect(rolled(150, 7)).toEqual({ cells: ['roll'], exit: 2 })
  })

  it('99+ rolls as the string it is', () => {
    expect(digitChanges('99', '99+')).toEqual({ cells: ['enter', 'same', 'roll'], exit: 0 })
    expect(digitChanges('99+', '99+')).toEqual({ cells: ['same', 'same', 'same'], exit: 0 })
  })
})

describe('pack 4 springs', () => {
  const peak = (css: string): number => Math.max(...css.slice(7, -1).split(',').map(Number))
  it('are there, in every look, and Mono does not overshoot', () => {
    const moshi = springVars(bounceOf('moshi'))
    for (const name of ['swipe', 'tick', 'digits']) {
      expect(moshi[`--spring-${name}`]).toMatch(/^linear\(/)
      expect(peak(moshi[`--spring-${name}`])).toBeGreaterThan(1)
      expect(peak(springVars(bounceOf('mono'))[`--spring-${name}`])).toBeLessThanOrEqual(1)
      expect(peak(springVars(bounceOf('pals'))[`--spring-${name}`])).toBeLessThan(1.5)
    }
    expect(moshi['--spring-swipe-ms']).toBe('380ms')
    expect(moshi['--spring-tick-ms']).toBe('260ms')
    expect(moshi['--spring-digits-ms']).toBe('300ms')
  })
  it('the new ones come last', () => {
    const names = Object.keys(springVars(1)).filter((k) => !k.endsWith('-ms'))
    expect(names.slice(-3)).toEqual(['--spring-swipe', '--spring-tick', '--spring-digits'])
  })
})

describe('the pack 4 css', () => {
  const css = readFileSync('src/renderer/src/styles/app.css', 'utf8')
  const marker = '/* ==== Motion pack 4 (ideas 22-25) ===='
  const section = css.slice(css.indexOf(marker))
  it('is the last section of the file', () => {
    expect(css.split(marker).length).toBe(2)
    expect(section.length).toBeGreaterThan(500)
    expect(section.slice(marker.length).includes('/* ==== ')).toBe(false)
  })
  it('keeps no layer alive for the digits and has a reduced-motion answer', () => {
    expect(section).not.toMatch(/will-change/)
    expect(section.includes('@media (prefers-reduced-motion: reduce)')).toBe(true)
    expect(section.replace(/\s+/g, ' ').includes('.audio-fill.resetting { transition: none;')).toBe(true)
  })
})
