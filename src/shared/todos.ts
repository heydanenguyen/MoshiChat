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
