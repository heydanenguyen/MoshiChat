import { describe, expect, it } from 'vitest'
import { WAVE_BARS, WAVE_FLOOR, waveLevels } from '../src/renderer/src/recordingWave'

describe('waveLevels', () => {
  it('gives one level per bar, all between the floor and 1', () => {
    const levels = waveLevels(new Uint8Array(128).map((_, i) => (i * 7) % 256))
    expect(levels).toHaveLength(WAVE_BARS)
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(WAVE_FLOOR)
      expect(level).toBeLessThanOrEqual(1)
    }
  })

  it('shows small bars (the floor) in silence and full bars at full level', () => {
    expect(waveLevels(new Uint8Array(128)).every((v) => v === WAVE_FLOOR)).toBe(true)
    expect(waveLevels(new Uint8Array(128).fill(255)).every((v) => v === 1)).toBe(true)
  })

  it('follows where the energy is: a louder slice gives a taller bar', () => {
    const data = new Uint8Array(128)
    data.fill(200, 0, 3) // only the lowest bins
    const levels = waveLevels(data)
    expect(levels[0]).toBeGreaterThan(levels[WAVE_BARS - 1])
    expect(levels[WAVE_BARS - 1]).toBe(WAVE_FLOOR)
  })

  it('ignores the top of the spectrum (speech does not live there)', () => {
    const data = new Uint8Array(128)
    data.fill(255, 100) // far above the 40 % that is used
    expect(waveLevels(data).every((v) => v === WAVE_FLOOR)).toBe(true)
  })

  it('copes with a short or empty spectrum', () => {
    expect(waveLevels([])).toHaveLength(WAVE_BARS)
    expect(waveLevels([255, 255])).toHaveLength(WAVE_BARS)
    expect(waveLevels(new Uint8Array(128), 4)).toHaveLength(4)
  })
})
