/** To-dos made from messages (or typed by hand), with an optional reminder time. Kept in settings.todos. */
export interface Todo {
  id: string
  /** The chat it came from, when it came from a message. */
  conversationId?: string
  messageId?: string
  text: string
  /** When to remind (ms since epoch). */
  due?: number
  done?: boolean
  createdAt: number
  doneAt?: number
  /** Set once the reminder was shown, so it fires only once. */
  remindedAt?: number
}

export type TodoGroup = 'overdue' | 'today' | 'upcoming' | 'someday' | 'done'
export const TODO_GROUPS: TodoGroup[] = ['overdue', 'today', 'upcoming', 'someday', 'done']

const endOfDay = (now: number): number => {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** Open to-dos by urgency (due soonest first), then done ones (finished most recently first). */
export function groupTodos(todos: Todo[], now = Date.now()): Record<TodoGroup, Todo[]> {
  const groups: Record<TodoGroup, Todo[]> = { overdue: [], today: [], upcoming: [], someday: [], done: [] }
  const today = endOfDay(now)
  for (const todo of todos) {
    if (todo.done) groups.done.push(todo)
    else if (todo.due === undefined) groups.someday.push(todo)
    else if (todo.due < now) groups.overdue.push(todo)
    else if (todo.due <= today) groups.today.push(todo)
    else groups.upcoming.push(todo)
  }
  const byDue = (a: Todo, b: Todo): number => (a.due ?? 0) - (b.due ?? 0)
  groups.overdue.sort(byDue)
  groups.today.sort(byDue)
  groups.upcoming.sort(byDue)
  groups.someday.sort((a, b) => b.createdAt - a.createdAt)
  groups.done.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
  return groups
}

export type DueTone = 'late' | 'today' | 'tomorrow' | 'later'

/** How a reminder time relates to now, for the label and its colour. */
export function dueInfo(due: number, now = Date.now()): { tone: DueTone; lateMinutes: number; lateDays: number } {
  const lateMinutes = Math.max(0, Math.floor((now - due) / 60_000))
  if (due < now) {
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const dueDay = new Date(due)
    dueDay.setHours(0, 0, 0, 0)
    return { tone: 'late', lateMinutes, lateDays: Math.round((startOfToday.getTime() - dueDay.getTime()) / 86_400_000) }
  }
  const d = new Date(due)
  const today = new Date(now)
  const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return { tone: 'today', lateMinutes: 0, lateDays: 0 }
  const tomorrow = new Date(now + 86_400_000)
  if (sameDay(d, tomorrow)) return { tone: 'tomorrow', lateMinutes: 0, lateDays: 0 }
  return { tone: 'later', lateMinutes: 0, lateDays: 0 }
}

/** Quick reminder times offered while adding or snoozing: tonight (if still ahead), tomorrow morning. */
export function quickTimes(now = Date.now()): { tonight?: number; tomorrow: number } {
  const at = (days: number, hour: number): number => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d.getTime()
  }
  const tonight = at(0, 20)
  return { tonight: tonight > now + 15 * 60_000 ? tonight : undefined, tomorrow: at(1, 9) }
}

/** Reminders that should fire now: due, still open, not shown yet. */
export function dueReminders(todos: Todo[], now = Date.now()): Todo[] {
  return todos.filter((t) => !t.done && t.due !== undefined && t.due <= now && t.remindedAt === undefined)
}

/**
 * Reads a reminder time out of a to-do as typed, in Vietnamese or English, and returns the text without it:
 * "gọi mẹ tối nay", "nộp báo cáo mai 9h", "họp thứ 6 14h30", "uống nước 30 phút nữa", "call Ann tomorrow 3pm",
 * "pay rent friday", "stretch in 20 min". No time found: the text as it was and no due.
 */
export function parseDue(input: string, now = Date.now()): { text: string; due?: number } {
  // fold accents char by char so positions in the folded copy match the original
  const folded = [...input].map((c) => (c === 'đ' || c === 'Đ' ? 'd' : c.normalize('NFD')[0].toLowerCase())).join('')
  const spans: Array<[number, number]> = []
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(folded)
    if (m) spans.push([m.index, m.index + m[0].length])
    return m
  }
  const base = new Date(now)
  let day: Date | undefined
  let hour: number | undefined
  let minute = 0
  let part: 'morning' | 'noon' | 'afternoon' | 'evening' | undefined

  // "30 phút nữa", "2 tiếng nữa", "in 20 min", "in 2 hours": an exact moment
  const rel = take(/(?:^|\s)(?:sau |trong |in )?(\d{1,3})\s*(phut|p|tieng|gio|h|min|mins|minutes|hours?|hrs?)\s*(?:nua)?(?=\s|$|[.,!])/)
  if (rel && (/nua/.test(rel[0]) || /\bin\b/.test(rel[0]))) {
    const n = Number(rel[1])
    const minutes = /^(phut|p|min)/.test(rel[2]) ? n : n * 60
    return { text: strip(input, spans), due: now + minutes * 60_000 }
  }
  if (rel) spans.pop()

  const dayWords: Array<[RegExp, number, typeof part]> = [
    [/(?:^|\s)(toi nay|tonight|this evening)(?=\s|$|[.,!])/, 0, 'evening'],
    [/(?:^|\s)(chieu nay|this afternoon)(?=\s|$|[.,!])/, 0, 'afternoon'],
    [/(?:^|\s)(trua nay)(?=\s|$|[.,!])/, 0, 'noon'],
    [/(?:^|\s)(sang nay|this morning)(?=\s|$|[.,!])/, 0, 'morning'],
    [/(?:^|\s)(sang mai|tomorrow morning)(?=\s|$|[.,!])/, 1, 'morning'],
    [/(?:^|\s)(trua mai)(?=\s|$|[.,!])/, 1, 'noon'],
    [/(?:^|\s)(chieu mai|tomorrow afternoon)(?=\s|$|[.,!])/, 1, 'afternoon'],
    [/(?:^|\s)(toi mai|tomorrow evening|tomorrow night)(?=\s|$|[.,!])/, 1, 'evening'],
    [/(?:^|\s)(ngay mot|mot)(?=\s|$|[.,!])/, 2, undefined],
    [/(?:^|\s)(ngay mai|mai|tomorrow)(?=\s|$|[.,!])/, 1, undefined],
    [/(?:^|\s)(hom nay|today)(?=\s|$|[.,!])/, 0, undefined]
  ]
  for (const [re, offset, p] of dayWords) {
    if (take(re)) {
      day = new Date(base)
      day.setDate(base.getDate() + offset)
      part = p
      break
    }
  }
  if (!day) {
    const weekdays: Array<[RegExp, number]> = [
      [/(?:^|\s)(chu nhat|cn|sunday)(?=\s|$|[.,!])/, 0],
      [/(?:^|\s)(thu (?:2|hai)|monday)(?=\s|$|[.,!])/, 1],
      [/(?:^|\s)(thu (?:3|ba)|tuesday)(?=\s|$|[.,!])/, 2],
      [/(?:^|\s)(thu (?:4|tu)|wednesday)(?=\s|$|[.,!])/, 3],
      [/(?:^|\s)(thu (?:5|nam)|thursday)(?=\s|$|[.,!])/, 4],
      [/(?:^|\s)(thu (?:6|sau)|friday)(?=\s|$|[.,!])/, 5],
      [/(?:^|\s)(thu (?:7|bay)|saturday)(?=\s|$|[.,!])/, 6]
    ]
    for (const [re, wd] of weekdays) {
      if (take(re)) {
        day = new Date(base)
        const ahead = (wd - base.getDay() + 7) % 7 || 7
        day.setDate(base.getDate() + ahead)
        break
      }
    }
  }

  // "9h", "9h30", "14:30", "9 giờ", "lúc 8h", "3pm", "at 7"
  const time =
    take(/(?:^|\s)(?:luc |at )?(\d{1,2})\s*(?:h|g|:|gio)\s*(\d{2})?(?:\s*(sang|trua|chieu|toi|am|pm))?(?=\s|$|[.,!])/) ??
    take(/(?:^|\s)(?:luc |at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s|$|[.,!])/)
  if (time) {
    hour = Number(time[1])
    minute = Number(time[2] ?? 0)
    const suffix = time[3]
    if ((suffix === 'pm' || suffix === 'chieu' || suffix === 'toi' || part === 'afternoon' || part === 'evening') && hour < 12) hour += 12
    if (suffix === 'am' && hour === 12) hour = 0
    if (hour > 23 || minute > 59) {
      spans.pop()
      hour = undefined
      minute = 0
    }
  }
  if (!day && hour === undefined) return { text: input.trim() }

  const at = new Date(day ?? base)
  if (hour === undefined) hour = part === 'evening' ? 20 : part === 'afternoon' ? 15 : part === 'noon' ? 12 : 9
  at.setHours(hour, minute, 0, 0)
  // only a time, already past today: the next one
  if (!day && at.getTime() <= now) at.setDate(at.getDate() + 1)
  return { text: strip(input, spans), due: at.getTime() }
}

function strip(input: string, spans: Array<[number, number]>): string {
  let out = input
  for (const [from, to] of [...spans].sort((a, b) => b[0] - a[0])) out = out.slice(0, from) + out.slice(to)
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,!])/g, '$1').replace(/[\s,–-]+$/, '').trim()
}
