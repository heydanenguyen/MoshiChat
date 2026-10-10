import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startRing } from '../src/renderer/src/sounds'

describe('startRing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('chimes at once, repeats, and stops by itself when the deadline passes', () => {
    const play = vi.fn()
    startRing(0.5, Date.now() + 30_000, play)
    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith(0.5)
    vi.advanceTimersByTime(30_000)
    const plays = play.mock.calls.length
    expect(plays).toBeGreaterThan(5)
    expect(plays).toBeLessThanOrEqual(14)
    vi.advanceTimersByTime(60_000)
    expect(play).toHaveBeenCalledTimes(plays)
  })

  it('stop() ends it, and a new ring can start afterwards', () => {
    const play = vi.fn()
    const stop = startRing(0.5, Date.now() + 30_000, play)
    stop()
    vi.advanceTimersByTime(10_000)
    expect(play).toHaveBeenCalledTimes(1)
    const again = vi.fn()
    startRing(0.5, Date.now() + 30_000, again)
    expect(again).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
  })

  it('starting twice (a double effect run) rings once', () => {
    const play = vi.fn()
    const first = startRing(0.5, Date.now() + 30_000, play)
    const second = startRing(0.5, Date.now() + 30_000, play)
    expect(second).toBe(first)
    expect(play).toHaveBeenCalledTimes(1)
    first()
  })

  it('plays nothing when the deadline is already past', () => {
    const play = vi.fn()
    startRing(0.5, Date.now() - 1, play)
    vi.advanceTimersByTime(10_000)
    expect(play).not.toHaveBeenCalled()
  })

  it('gives up when audio is unavailable', () => {
    const play = vi.fn(() => {
      throw new Error('no audio')
    })
    startRing(0.5, Date.now() + 30_000, play)
    vi.advanceTimersByTime(10_000)
    expect(play).toHaveBeenCalledTimes(1)
  })
})
