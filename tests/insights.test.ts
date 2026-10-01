import { describe, expect, it } from 'vitest'
import { computeInsights, onThisDay, streakDays, vibeOf, type InsightRecord } from '../src/shared/insights'

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
    // Bố never wrote back in the period: not among the closest (still counted in quiet).
    expect(i.top.map((c) => c.title)).toEqual(['Lan', 'Minh'])
    expect(i.top[0].streak).toBe(3)
    expect(i.streak?.title).toBe('Lan')
    expect(i.quiet.map((c) => c.title)).toEqual(['Bố'])
    expect(i.hours.reduce((a, b) => a + b, 0)).toBe(6)
    expect(i.hours[new Date(now - 2 * 3600e3).getHours()]).toBeGreaterThan(0)
  })
})

describe('vibeOf', () => {
  it('spots night owls, then who carries the chat', () => {
    expect(vibeOf({ sent: 5, received: 5, total: 10, night: 5 })).toBe('night')
    expect(vibeOf({ sent: 2, received: 2, total: 4, night: 4 })).toBe('even') // too few to call it
    expect(vibeOf({ sent: 16, received: 10, total: 26, night: 0 })).toBe('you')
    expect(vibeOf({ sent: 2, received: 24, total: 26, night: 1 })).toBe('them')
    expect(vibeOf({ sent: 12, received: 10, total: 22, night: 2 })).toBe('even')
    // If you text at night with everyone, nobody stands out as the night owl.
    expect(vibeOf({ sent: 5, received: 5, total: 10, night: 9 }, 0.9)).toBe('even')
    expect(vibeOf({ sent: 5, received: 5, total: 10, night: 9 }, 0.3)).toBe('night')
  })

  it('counts messages sent between 22:00 and 04:59 per person', () => {
    const late = new Date(2026, 8, 28, 23, 30).getTime()
    const early = new Date(2026, 8, 28, 3, 0).getTime()
    const noon = new Date(2026, 8, 28, 12, 0).getTime()
    const i = computeInsights([rec('owl', late), rec('owl', early), rec('owl', noon)], { owl: 'Owl' }, now, 30)
    expect(i.top[0].night).toBe(2)
  })
})

describe('closeness ranking', () => {
  it('puts a friend you talk with both ways most days above a one-afternoon burst and above groups', () => {
    const records: InsightRecord[] = []
    // "burst": 200 messages from them in one afternoon, you never answer
    for (let i = 0; i < 200; i++) records.push(rec('burst', now - 3 * DAY + i * 1000))
    // "friend": one message each way on 10 different days
    for (let d = 1; d <= 10; d++) {
      records.push(rec('friend', now - d * DAY, { isOutgoing: true }))
      records.push(rec('friend', now - d * DAY + 60_000))
    }
    // a busy group
    for (let i = 0; i < 400; i++) records.push(rec('team', now - (i % 20) * DAY, { isOutgoing: i % 2 === 0 }))
    const i = computeInsights(records, { burst: 'Burst', friend: 'Friend', team: 'Team' }, now, 30, new Set(['team']))
    expect(i.top.map((c) => c.title)).toEqual(['Friend', 'Burst'])
    expect(i.top[0]).toMatchObject({ days: 10, bothDays: 10, total: 20 })
    // group messages still count in the totals
    expect(i.sent + i.received).toBe(620)
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
