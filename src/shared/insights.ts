/**
 * Friendship insights and "on this day" memories, computed from the messages Moshi has on this computer.
 * Pure functions over a light record shape so they run in the renderer and in tests.
 */

export interface InsightRecord {
  conversationId: string
  id: string
  sentAt: number
  isOutgoing: boolean
  senderName: string
  /** First 140 characters. */
  text: string
  hasPhoto: boolean
}

export interface ContactInsight {
  conversationId: string
  title: string
  sent: number
  received: number
  total: number
  /** 0..1 of all messages in the period. */
  share: number
  /** Consecutive days (ending today or yesterday) with at least one message. */
  streak: number
  lastAt: number
  /** Days in the period with any message, and with messages both ways. */
  days: number
  bothDays: number
  /** How close: two-way days count most, then days at all, the last week, and volume (dampened). */
  score: number
}

export interface Insights {
  from: number
  to: number
  sent: number
  received: number
  chats: number
  top: ContactInsight[]
  /** Messages per hour of day (24) and per weekday (7, Monday first). */
  hours: number[]
  weekdays: number[]
  busiestHour: number
  busiestWeekday: number
  /** The longest current streak, if any. */
  streak?: ContactInsight
  /** Chats you wrote to but never heard back from in the period (max 5). */
  quiet: ContactInsight[]
}

const DAY = 24 * 60 * 60 * 1000

const dayKey = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Days in a row with a message, counting back from today (a gap of one day is allowed for today itself). */
export function streakDays(times: number[], now = Date.now()): number {
  const days = new Set(times.map(dayKey))
  if (!days.size) return 0
  let cursor = now
  if (!days.has(dayKey(cursor))) {
    cursor -= DAY
    if (!days.has(dayKey(cursor))) return 0
  }
  let streak = 0
  while (days.has(dayKey(cursor))) {
    streak++
    cursor -= DAY
  }
  return streak
}

/**
 * Raw message counts rewarded whoever splits a thought into ten lines, a single busy afternoon, and
 * busy group chats. Closeness is about talking with someone, often and lately: days with messages
 * both ways weigh most, volume only as a square root.
 */
export function closeness(e: { days: number; bothDays: number; recentDays: number; total: number }): number {
  return e.bothDays * 4 + e.days * 2 + e.recentDays * 1.5 + Math.sqrt(e.total) * 1.5
}

export function computeInsights(records: InsightRecord[], titles: Record<string, string>, now = Date.now(), days = 30, groups: ReadonlySet<string> = new Set()): Insights {
  const from = now - days * DAY
  const inPeriod = records.filter((r) => r.sentAt >= from && r.sentAt <= now)
  const per = new Map<string, { sent: number; received: number; times: number[]; outgoing: boolean[]; lastAt: number }>()
  const hours = Array(24).fill(0) as number[]
  const weekdays = Array(7).fill(0) as number[]
  let sent = 0
  let received = 0
  for (const r of inPeriod) {
    const entry = per.get(r.conversationId) ?? { sent: 0, received: 0, times: [], outgoing: [], lastAt: 0 }
    if (r.isOutgoing) {
      entry.sent++
      sent++
    } else {
      entry.received++
      received++
    }
    entry.times.push(r.sentAt)
    entry.outgoing.push(r.isOutgoing)
    entry.lastAt = Math.max(entry.lastAt, r.sentAt)
    per.set(r.conversationId, entry)
    const d = new Date(r.sentAt)
    hours[d.getHours()]++
    weekdays[(d.getDay() + 6) % 7]++
  }
  const total = sent + received
  const contacts: ContactInsight[] = [...per.entries()]
    .filter(([conversationId]) => !groups.has(conversationId))
    .map(([conversationId, e]) => {
      const out = new Set<string>()
      const inc = new Set<string>()
      const recent = new Set<string>()
      e.times.forEach((t, i) => {
        const key = dayKey(t)
        ;(e.outgoing[i] ? out : inc).add(key)
        if (t >= now - 7 * DAY) recent.add(key)
      })
      const all = new Set([...out, ...inc])
      const bothDays = [...out].filter((k) => inc.has(k)).length
      const totalOf = e.sent + e.received
      return {
        conversationId,
        title: titles[conversationId] ?? conversationId,
        sent: e.sent,
        received: e.received,
        total: totalOf,
        share: total ? totalOf / total : 0,
        streak: streakDays(e.times, now),
        lastAt: e.lastAt,
        days: all.size,
        bothDays,
        score: closeness({ days: all.size, bothDays, recentDays: recent.size, total: totalOf })
      }
    })
  contacts.sort((a, b) => b.score - a.score || b.total - a.total || b.lastAt - a.lastAt)
  const withStreak = contacts.filter((c) => c.streak >= 2).sort((a, b) => b.streak - a.streak || b.total - a.total)
  const quiet = contacts
    .filter((c) => c.sent >= 2 && c.received === 0)
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 5)
  const argmax = (list: number[]): number => list.reduce((best, v, i) => (v > list[best] ? i : best), 0)
  return {
    from,
    to: now,
    sent,
    received,
    chats: per.size,
    top: contacts.slice(0, 8),
    hours,
    weekdays,
    busiestHour: argmax(hours),
    busiestWeekday: argmax(weekdays),
    streak: withStreak[0],
    quiet
  }
}

export type MemoryAgo = { years: number } | { months: number } | { weeks: number }

export interface Memory {
  record: InsightRecord
  ago: MemoryAgo
}

const sameMonthDay = (a: Date, b: Date): boolean => a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * A message worth remembering from this date in earlier years, else this day of the month in earlier
 * months, else last week. Photos and longer texts win; the pick is stable for the whole day.
 */
export function onThisDay(records: InsightRecord[], now = Date.now()): Memory | undefined {
  const today = new Date(now)
  const worth = (r: InsightRecord): number => (r.hasPhoto ? 1000 : 0) + Math.min(r.text.length, 120)
  const pick = (list: InsightRecord[]): InsightRecord | undefined => {
    if (!list.length) return undefined
    // Photos first; among equals, a stable choice for the whole day.
    const pool = list.some((r) => r.hasPhoto) ? list.filter((r) => r.hasPhoto) : [...list].sort((a, b) => worth(b) - worth(a)).slice(0, 5)
    const seed = today.getFullYear() * 400 + today.getMonth() * 32 + today.getDate()
    return pool[seed % pool.length]
  }
  const usable = records.filter((r) => r.sentAt < now - 6 * DAY && (r.text.trim().length > 8 || r.hasPhoto))
  const years = usable.filter((r) => {
    const d = new Date(r.sentAt)
    return d.getFullYear() < today.getFullYear() && sameMonthDay(d, today)
  })
  const y = pick(years)
  if (y) return { record: y, ago: { years: today.getFullYear() - new Date(y.sentAt).getFullYear() } }
  const months = usable.filter((r) => {
    const d = new Date(r.sentAt)
    return d.getDate() === today.getDate() && (d.getFullYear() < today.getFullYear() || d.getMonth() < today.getMonth())
  })
  const m = pick(months)
  if (m) {
    const d = new Date(m.sentAt)
    return { record: m, ago: { months: (today.getFullYear() - d.getFullYear()) * 12 + today.getMonth() - d.getMonth() } }
  }
  const week = usable.filter((r) => Math.abs(now - 7 * DAY - r.sentAt) < DAY / 2)
  const w = pick(week)
  return w ? { record: w, ago: { weeks: 1 } } : undefined
}
