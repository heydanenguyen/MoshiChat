import { describe, expect, it } from 'vitest'
import { computeInsights, onThisDay, streakDays, type InsightRecord } from '../src/shared/insights'

const DAY = 24 * 60 * 60 * 1000
const now = new Date(2026, 8, 29, 15, 0).getTime()
let n = 0
const rec = (conversationId: string, sentAt: number, over: Partial<InsightRecord> = {}): InsightRecord => ({
  conversationId,
  id: `m${++n}`,
  sentAt,
  isOutgoing: false,
  senderName: conversationId,
  text: 'hello there friend',
  hasPhoto: false,
  ...over
})

describe('streakDays', () => {
  it('counts consecutive days back from today, tolerating no message yet today', () => {
    expect(streakDays([now, now - DAY, now - 2 * DAY], now)).toBe(3)
    expect(streakDays([now - DAY, now - 2 * DAY], now)).toBe(2)
    expect(streakDays([now - 2 * DAY, now - 3 * DAY], now)).toBe(0)
    expect(streakDays([now, now - 2 * DAY], now)).toBe(1)
    expect(streakDays([], now)).toBe(0)
  })
})

describe('computeInsights', () => {
  it('ranks chats, splits sent/received, finds busy hours and quiet chats', () => {
    const records = [
      rec('lan', now - 2 * 3600e3, { isOutgoing: true }),
      rec('lan', now - DAY, {}),
      rec('lan', now - 2 * DAY, {}),
      rec('minh', now - 3 * DAY, {}),
      rec('bo', now - 4 * DAY, { isOutgoing: true }),
      rec('bo', now - 5 * DAY, { isOutgoing: true }),
      rec('old', now - 60 * DAY, {})
    ]
    const i = computeInsights(records, { lan: 'Lan', minh: 'Minh', bo: 'Bố' }, now, 30)
    expect(i.chats).toBe(3)
    expect(i.sent).toBe(3)
    expect(i.received).toBe(3)
    expect(i.top.map((c) => c.title)).toEqual(['Lan', 'Bố', 'Minh'])
    expect(i.top[0].streak).toBe(3)
    expect(i.streak?.title).toBe('Lan')
    expect(i.quiet.map((c) => c.title)).toEqual(['Bố'])
    expect(i.hours.reduce((a, b) => a + b, 0)).toBe(6)
    expect(i.hours[new Date(now - 2 * 3600e3).getHours()]).toBeGreaterThan(0)
  })
})

describe('onThisDay', () => {
  it('prefers the same date a year ago, then the same day last month, then last week', () => {
    const yearAgo = new Date(2025, 8, 29, 12).getTime()
    const monthAgo = new Date(2026, 7, 29, 12).getTime()
    const weekAgo = now - 7 * DAY
    const both = [rec('a', yearAgo, { text: 'a short one' }), rec('a', yearAgo, { hasPhoto: true, text: '' }), rec('b', monthAgo), rec('c', weekAgo)]
    const y = onThisDay(both, now)
    expect(y?.ago).toEqual({ years: 1 })
    expect(y?.record.hasPhoto).toBe(true)
    expect(onThisDay([rec('b', monthAgo), rec('c', weekAgo)], now)?.ago).toEqual({ months: 1 })
    expect(onThisDay([rec('c', weekAgo)], now)?.ago).toEqual({ weeks: 1 })
    expect(onThisDay([rec('d', now - DAY)], now)).toBeUndefined()
  })
})
