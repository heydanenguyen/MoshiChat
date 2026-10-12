import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exitHoldMs, unfoldCompleted, unfoldKind } from '../src/renderer/src/motion/unfold'
import { BLOCKS_PER_ROW, SKELETON_CAP, SKELETON_DELAY_MS, rowsWithin } from '../src/renderer/src/components/Skeleton'

const css = readFileSync('src/renderer/src/styles/app.css', 'utf8')
const section = css.slice(css.indexOf('/* ==== Motion pack 1 (ideas 6, 8, 15, 20)'))

describe('the composer swap (motion pack 1, part B)', () => {
  it('keeps the dimming of a disabled mic or send button', () => {
    expect(section).toMatch(/\.composer-swap > :is\(\.composer-send, \.composer-mic\):disabled:not\(\.idle, \.swap-off\) \{\s*opacity: 0\.4;/)
  })
  it('hides the unused button for good (no clicks, out of the tab order)', () => {
    expect(section).toMatch(/\.composer-send\.idle,\s*:root \.composer-box \.composer-swap > \.composer-mic\.swap-off \{[^}]*visibility: hidden;[^}]*pointer-events: none;/)
  })
  it('closes the slot of a chat without voice while nothing is to be sent', () => {
    expect(section).toMatch(/\.composer-swap\.no-mic:has\(> \.composer-send\.idle\) \{\s*width: 0;/)
  })
})

describe('the send-later pill helpers', () => {
  it('unfolds by width only when the word is shown', () => {
    expect(unfoldKind(107, 36)).toBe('width')
    expect(unfoldKind(36, 36)).toBe('fade')
    expect(unfoldKind(37, 36)).toBe('fade')
  })
  it('holds the pill for its fold, not at all under reduced motion', () => {
    expect(exitHoldMs(220, false)).toBe(220)
    expect(exitHoldMs(220, true)).toBe(0)
    expect(exitHoldMs(-5, false)).toBe(0)
  })
  it('clears the inline styles only after an unfold that ran to its end', () => {
    expect(unfoldCompleted('finished')).toBe(true)
    expect(unfoldCompleted('idle')).toBe(false)
    expect(unfoldCompleted('running')).toBe(false)
  })
})

describe('skeletons', () => {
  it('count their cap in blocks, not rows', () => {
    expect(rowsWithin(SKELETON_CAP) * BLOCKS_PER_ROW).toBeLessThanOrEqual(SKELETON_CAP)
    expect(rowsWithin(SKELETON_CAP)).toBe(4)
  })
  it('appear after the delay the code uses', () => {
    expect(section).toContain(`skeleton-appear 160ms linear ${SKELETON_DELAY_MS}ms backwards`)
  })
})
