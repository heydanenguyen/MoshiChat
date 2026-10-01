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
  /** Messages between 22:00 and 04:59, either way. */
  night: number
}

/** The one-word character of a friendship in the period, for the Close friends list. */
export type Vibe = 'night' | 'you' | 'them' | 'even'

/**
 * Night owls first: at least 40% of the talking after 22:00 and clearly more than your own habit (1.5 times
 * your overall night share, so someone who texts at night anyway does not make everyone an owl); then who
 * carries the chat: one side writing at least 1.6 times as much as the other; otherwise it is even.
 */
export function vibeOf(c: Pick<ContactInsight, 'sent' | 'received' | 'total' | 'night'>, overallNight = 0): Vibe {
  const share = c.total ? c.night / c.total : 0
  if (c.total >= 6 && share >= 0.4 && share >= overallNight * 1.5) return 'night'
  if (c.sent >= 1.6 * Math.max(1, c.received)) return 'you'
  if (c.received >= 1.6 * Math.max(1, c.sent)) return 'them'
  return 'even'
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
  /** Share (0..1) of all messages in the period sent between 22:00 and 04:59. */
  nightShare: number
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
  const per = new Map<string, { sent: number; received: number; night: number; times: number[]; outgoing: boolean[]; lastAt: number }>()
  const hours = Array(24).fill(0) as number[]
  const weekdays = Array(7).fill(0) as number[]
  let sent = 0
  let received = 0
  for (const r of inPeriod) {
    const entry = per.get(r.conversationId) ?? { sent: 0, received: 0, night: 0, times: [], outgoing: [], lastAt: 0 }
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
    if (d.getHours() >= 22 || d.getHours() < 5) entry.night++
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
        score: closeness({ days: all.size, bothDays, recentDays: recent.size, total: totalOf }),
        night: e.night
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
    // A chat that never wrote back in the period is not a close friend (and your own Saved Messages never do).
    top: contacts.filter((c) => c.received > 0).slice(0, 8),
    hours,
    weekdays,
    busiestHour: argmax(hours),
    busiestWeekday: argmax(weekdays),
    nightShare: total ? (hours.slice(22).reduce((a, b) => a + b, 0) + hours.slice(0, 5).reduce((a, b) => a + b, 0)) / total : 0,
    streak: withStreak[0],
    quiet
  }
}

/** Everything the 9:16 share image shows, resolved by the sheet (it is drawn in a window without the app's store). */
export interface ShareCardData {
  language: 'vi' | 'en'
  period: 'month' | 'year'
  /** CSS colours: the accent and the chosen logo character. */
  accent: string
  logoColor: string
  logo: string
  me: { name: string; avatarUrl?: string }
  /** The closest, in order (up to 8). */
  friends: Array<{ name: string; avatarUrl?: string; streak: number; total: number }>
  total: number
  sent: number
  received: number
  busiestHour: number
  busiestWeekday: number
  streak?: { name: string; days: number }
}

export interface Memory {
  record: InsightRecord
  years: number
}

const sameMonthDay = (a: Date, b: Date): boolean => a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * A message worth remembering from this date in an earlier year. Only real years: a month ago is not a
 * memory, and a card that falls back to it just fills space. Photos and longer texts win; the pick is
 * stable for the whole day.
 */
export function onThisDay(records: InsightRecord[], now = Date.now()): Memory | undefined {
  const today = new Date(now)
  const worth = (r: InsightRecord): number => (r.hasPhoto ? 1000 : 0) + Math.min(r.text.length, 120)
  const years = records.filter((r) => {
    const d = new Date(r.sentAt)
    return d.getFullYear() < today.getFullYear() && sameMonthDay(d, today) && (r.text.trim().length > 8 || r.hasPhoto)
  })
  if (!years.length) return undefined
  // Photos first; among equals, a stable choice for the whole day.
  const pool = years.some((r) => r.hasPhoto) ? years.filter((r) => r.hasPhoto) : [...years].sort((a, b) => worth(b) - worth(a)).slice(0, 5)
  const seed = today.getFullYear() * 400 + today.getMonth() * 32 + today.getDate()
  const record = pool[seed % pool.length]
  return { record, years: today.getFullYear() - new Date(record.sentAt).getFullYear() }
}

export interface Reconnect {
  conversationId: string
  title: string
  /** Whole days since the last message either way. */
  silentDays: number
  /** Your usual gap, in days, between days you talked before the silence. */
  usualDays: number
  lastAt: number
  bothDays: number
}

const startOfDay = (t: number): number => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Close friends gone quiet: in the window, at least 4 days you talked and 3 of them both ways, and now
 * silent for three times your usual gap with them (a week at least). Stronger friendships and longer
 * silences, against habit, come first. `lastActivity` is the chat list's own last update, which can be
 * newer than the records (a message handled on the phone); `snoozed` maps chats to when they may return.
 */
export function reconnectCandidates(
  records: InsightRecord[],
  titles: Record<string, string>,
  opts: { now?: number; days?: number; groups?: ReadonlySet<string>; lastActivity?: Record<string, number>; snoozed?: Record<string, number> } = {}
): Reconnect[] {
  const now = opts.now ?? Date.now()
  const from = now - (opts.days ?? 60) * DAY
  const per = new Map<string, { out: Set<number>; inc: Set<number>; lastAt: number }>()
  for (const r of records) {
    if (r.sentAt < from || r.sentAt > now || opts.groups?.has(r.conversationId)) continue
    const e = per.get(r.conversationId) ?? { out: new Set<number>(), inc: new Set<number>(), lastAt: 0 }
    ;(r.isOutgoing ? e.out : e.inc).add(startOfDay(r.sentAt))
    e.lastAt = Math.max(e.lastAt, r.sentAt)
    per.set(r.conversationId, e)
  }
  const out: Array<Reconnect & { score: number }> = []
  for (const [conversationId, e] of per) {
    if ((opts.snoozed?.[conversationId] ?? 0) > now) continue
    const days = [...new Set([...e.out, ...e.inc])].sort((a, b) => a - b)
    const bothDays = [...e.out].filter((d) => e.inc.has(d)).length
    if (days.length < 4 || bothDays < 3) continue
    const lastAt = Math.max(e.lastAt, opts.lastActivity?.[conversationId] ?? 0)
    const silentDays = Math.floor((now - lastAt) / DAY)
    const usualDays = Math.max(1, Math.round((days[days.length - 1] - days[0]) / DAY / (days.length - 1)))
    const threshold = Math.max(7, usualDays * 3)
    if (silentDays < threshold) continue
    out.push({
      conversationId,
      title: titles[conversationId] ?? conversationId,
      silentDays,
      usualDays,
      lastAt,
      bothDays,
      score: (bothDays * 4 + days.length * 2) * Math.min(2, silentDays / threshold)
    })
  }
  return out.sort((a, b) => b.score - a.score).map(({ score: _score, ...r }) => r)
}
