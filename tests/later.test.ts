import { describe, expect, it } from 'vitest'
import { answers, followState, formatLaterTime, isSnoozed, isWoken, laterPresets, without } from '../src/shared/later'

// Wednesday 1 October 2026, 10:00.
const now = new Date(2026, 9, 1, 10, 0).getTime()
const H = 60 * 60 * 1000

describe('states', () => {
  it('a snooze hides until its time or until it fired, then counts as woken', () => {
    expect(isSnoozed({ until: now + H, at: now }, now)).toBe(true)
    expect(isWoken({ until: now + H, at: now }, now)).toBe(false)
    expect(isSnoozed({ until: now - 1, at: now - H }, now)).toBe(false)
    expect(isWoken({ until: now - 1, at: now - H }, now)).toBe(true)
    expect(isWoken({ until: now + H, at: now, firedAt: now }, now)).toBe(true)
    expect(isSnoozed(undefined, now)).toBe(false)
  })

  it('a follow-up waits, then is due; only a message from them after it was set answers it', () => {
    expect(followState({ until: now + H, at: now }, now)).toBe('waiting')
    expect(followState({ until: now - 1, at: now - H }, now)).toBe('due')
    expect(followState(undefined, now)).toBeUndefined()
    const entry = { until: now + H, at: now }
    expect(answers(entry, { isOutgoing: false, sentAt: now + 1 })).toBe(true)
    expect(answers(entry, { isOutgoing: true, sentAt: now + 1 })).toBe(false)
    expect(answers(entry, { isOutgoing: false, sentAt: now - 1 })).toBe(false)
  })
})

describe('laterPresets', () => {
  it('offers this evening, tomorrow morning, the weekend and next Monday on a weekday morning', () => {
    const list = laterPresets('snooze', now)
    expect(list.map((p) => p.id)).toEqual(['hour', 'evening', 'tomorrow', 'weekend', 'nextWeek'])
    expect(new Date(list[1].until).getHours()).toBe(19)
    expect(new Date(list[2].until)).toEqual(new Date(2026, 9, 2, 8))
    expect(new Date(list[3].until)).toEqual(new Date(2026, 9, 3, 9)) // Saturday
    expect(new Date(list[4].until)).toEqual(new Date(2026, 9, 5, 8)) // Monday
  })

  it('drops this evening late in the day and the weekend when it already is one', () => {
    const late = new Date(2026, 9, 1, 18).getTime()
    expect(laterPresets('snooze', late).map((p) => p.id)).not.toContain('evening')
    const saturday = new Date(2026, 9, 3, 10).getTime()
    const ids = laterPresets('snooze', saturday).map((p) => p.id)
    expect(ids).not.toContain('weekend')
    expect(new Date(laterPresets('snooze', saturday).at(-1)!.until)).toEqual(new Date(2026, 9, 5, 8))
  })

  it('gives follow-ups their own steps', () => {
    expect(laterPresets('follow', now).map((p) => p.id)).toEqual(['hour', 'hours3', 'tomorrow', 'days3', 'nextWeek'])
  })
})

describe('formatLaterTime', () => {
  it('says the time today, "tomorrow", the weekday this week, else the date', () => {
    expect(formatLaterTime(new Date(2026, 9, 1, 15).getTime(), 'vi', now)).toBe('15:00')
    expect(formatLaterTime(new Date(2026, 9, 2, 8).getTime(), 'vi', now)).toBe('Mai 8:00')
    expect(formatLaterTime(new Date(2026, 9, 3, 9).getTime(), 'vi', now)).toBe('T7 9:00')
    expect(formatLaterTime(new Date(2026, 9, 12, 9).getTime(), 'vi', now)).toBe('12/10 9:00')
    expect(formatLaterTime(new Date(2026, 9, 2, 20, 30).getTime(), 'en', now)).toBe('Tomorrow 8:30 PM')
  })
})

describe('without', () => {
  it('drops a key without touching the original', () => {
    const record = { a: 1, b: 2 }
    expect(without(record, 'a')).toEqual({ b: 2 })
    expect(record).toEqual({ a: 1, b: 2 })
    expect(without(record, 'z')).toBe(record)
  })
})
