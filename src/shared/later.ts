/**
 * "Later": chats snoozed out of the inbox until a time, and follow-ups that remind you when someone has not
 * written back. Pure helpers shared by the main process (timers, notifications) and the renderer (the list).
 */

export interface LaterEntry {
  /** When it comes due. */
  until: number
  /** When it was set: only messages after this count (a reply wakes a snooze, answers a follow-up). */
  at: number
  /** When it came due, set by the main process once it has told you. */
  firedAt?: number
}

export type LaterKind = 'snooze' | 'follow'

/** Hidden from the inbox, waiting for its time. */
export const isSnoozed = (entry: LaterEntry | undefined, now = Date.now()): boolean => !!entry && !entry.firedAt && entry.until > now
/** Its time came: back at the top of the inbox until you open it. */
export const isWoken = (entry: LaterEntry | undefined, now = Date.now()): boolean => !!entry && (!!entry.firedAt || entry.until <= now)

/** A follow-up: still waiting for its time, or due (they have not written back). */
export function followState(entry: LaterEntry | undefined, now = Date.now()): 'waiting' | 'due' | undefined {
  if (!entry) return undefined
  return !entry.firedAt && entry.until > now ? 'waiting' : 'due'
}

/** Whether a message answers the entry: someone else wrote after it was set. */
export const answers = (entry: LaterEntry, message: { isOutgoing: boolean; sentAt: number }): boolean => !message.isOutgoing && message.sentAt > entry.at

export type PresetId = 'hour' | 'hours3' | 'evening' | 'tomorrow' | 'weekend' | 'days3' | 'nextWeek'

export interface Preset {
  id: PresetId
  until: number
}

const at = (base: Date, days: number, hour: number): number => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hour, 0, 0, 0).getTime()

/**
 * The times offered, nearest first. Snooze: in an hour, this evening (until 17:00), tomorrow morning, the weekend
 * (on a weekday), next Monday. Follow-up: in an hour, in three hours, tomorrow, in three days, next Monday.
 * Each is a time people say out loud, never "in 1,440 minutes".
 */
export function laterPresets(kind: LaterKind, now = Date.now()): Preset[] {
  const d = new Date(now)
  const day = d.getDay() // 0 Sunday .. 6 Saturday
  const toMonday = ((8 - day) % 7) || 7
  const list: Preset[] = [{ id: 'hour', until: now + 60 * 60 * 1000 }]
  if (kind === 'snooze') {
    if (d.getHours() < 17) list.push({ id: 'evening', until: at(d, 0, 19) })
    list.push({ id: 'tomorrow', until: at(d, 1, 8) })
    if (day >= 1 && day <= 4) list.push({ id: 'weekend', until: at(d, 6 - day, 9) })
    list.push({ id: 'nextWeek', until: at(d, toMonday, 8) })
  } else {
    list.push({ id: 'hours3', until: now + 3 * 60 * 60 * 1000 })
    list.push({ id: 'tomorrow', until: at(d, 1, 9) })
    list.push({ id: 'days3', until: at(d, 3, 9) })
    list.push({ id: 'nextWeek', until: at(d, toMonday, 9) })
  }
  return list
}

const VI_DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function clock(t: Date, vi: boolean): string {
  const m = String(t.getMinutes()).padStart(2, '0')
  if (vi) return `${t.getHours()}:${m}`
  const h = t.getHours() % 12 || 12
  return `${h}:${m} ${t.getHours() < 12 ? 'AM' : 'PM'}`
}

/** "15:00", "Mai 8:00", "T7 9:00", "12/10 9:00": when something comes due, as short as it can be. */
export function formatLaterTime(until: number, language: string, now = Date.now()): string {
  const vi = language === 'vi'
  const t = new Date(until)
  const today = new Date(now)
  const days = Math.round((at(t, 0, 0) - at(today, 0, 0)) / 86_400_000)
  const time = clock(t, vi)
  if (days === 0) return time
  if (days === 1) return `${vi ? 'Mai' : 'Tomorrow'} ${time}`
  if (days > 1 && days < 7) return `${(vi ? VI_DAYS : EN_DAYS)[t.getDay()]} ${time}`
  return vi ? `${t.getDate()}/${t.getMonth() + 1} ${time}` : `${t.getMonth() + 1}/${t.getDate()} ${time}`
}

/** A record without one key (or the same record when the key is not there). */
export function without<T>(record: Record<string, T> | undefined, key: string): Record<string, T> {
  if (!record || !(key in record)) return record ?? {}
  const next = { ...record }
  delete next[key]
  return next
}
