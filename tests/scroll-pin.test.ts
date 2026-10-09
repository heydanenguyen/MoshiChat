import { describe, expect, it } from 'vitest'
import { nextPinned, NEAR_BOTTOM_PX } from '../src/renderer/src/scrollPin'

const at = (distance: number, prevDistance: number, input: boolean, pinned: boolean): boolean =>
  nextPinned({ pinned, distanceFromBottom: distance, prevDistanceFromBottom: prevDistance, userInput: input })

describe('nextPinned', () => {
  it('unpins as soon as the person scrolls up, even inside the near-bottom band', () => {
    // The bug: within 80px of the bottom the thread stayed pinned, and every row entering the view snapped it back down.
    expect(at(12, 0, true, true)).toBe(false)
    expect(at(50, 38, true, true)).toBe(false)
  })

  it('keeps following the bottom when rows grow without the person touching anything', () => {
    // A photo finishing loading moves the bottom away; that is not the person scrolling up.
    expect(at(60, 0, false, true)).toBe(true)
    expect(at(300, 0, false, true)).toBe(true)
  })

  it('re-pins when the person scrolls back down into the near-bottom band', () => {
    expect(at(NEAR_BOTTOM_PX - 1, NEAR_BOTTOM_PX + 40, true, false)).toBe(true)
    expect(at(0, 20, true, false)).toBe(true)
  })

  it('stays unpinned while far from the bottom', () => {
    expect(at(500, 520, true, false)).toBe(false)
    expect(at(500, 480, true, false)).toBe(false)
    expect(at(500, 480, false, false)).toBe(false)
  })

  it('re-pins on a programmatic jump to the bottom (jump pill, new chat)', () => {
    expect(at(0, 500, false, false)).toBe(true)
  })
})
