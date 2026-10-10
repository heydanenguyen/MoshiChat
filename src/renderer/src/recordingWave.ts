/** The level meter shown while a voice note is being recorded (UI direction A): 18 bars drawn from the microphone's level. */
export const WAVE_BARS = 18

/** The shortest a bar gets (a fraction of its full height), so a quiet room still shows a row of small bars. */
export const WAVE_FLOOR = 0.18

/**
 * Bar heights, 0.18 to 1, from one frame of an analyser's byte spectrum (0 to 255 per bin). Speech sits in the lower
 * part of the spectrum, so only that part is used, split into equal slices; each bar is its slice's mean level,
 * lifted a little (a power below 1) because a voice at normal volume only fills a fraction of the byte range.
 */
export function waveLevels(data: ArrayLike<number>, bars = WAVE_BARS): number[] {
  const used = Math.max(bars, Math.floor(data.length * 0.4))
  const out: number[] = []
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor((bar * used) / bars)
    const to = Math.max(from + 1, Math.floor(((bar + 1) * used) / bars))
    let sum = 0
    let count = 0
    for (let bin = from; bin < to && bin < data.length; bin++) {
      sum += data[bin]
      count++
    }
    const level = count ? sum / count / 255 : 0
    out.push(Math.min(1, WAVE_FLOOR + (1 - WAVE_FLOOR) * Math.pow(level, 0.7)))
  }
  return out
}
