import { Notification } from 'electron'
import type { BridgeEvent } from '@shared/types'
import { dueReminders, type Todo } from '@shared/todos'
import type { Storage } from './storage'

const TICK_MS = 30_000

/**
 * To-do reminders: when a to-do's time comes, a system notification shows it (whether or not Moshi is
 * in front); clicking it opens the message it came from. Each reminder fires once (remindedAt).
 */
export class Reminders {
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private storage: Storage,
    private emit: (event: BridgeEvent) => void,
    private open: (todo: Todo) => void,
    private log: (...args: unknown[]) => void
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    setTimeout(() => void this.tick(), 8_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private async tick(): Promise<void> {
    const todos = this.storage.settings.todos ?? []
    const due = dueReminders(todos)
    if (!due.length) return
    const now = Date.now()
    const vi = this.storage.settings.language === 'vi'
    // A pile of old reminders (the app was closed for days) becomes one notification, not a storm.
    const shown = due.slice(0, 3)
    if (Notification.isSupported()) {
      for (const todo of shown) {
        const n = new Notification({
          title: vi ? 'Việc cần làm' : 'To-do',
          body: (due.length > 3 && todo === shown[shown.length - 1] ? `${todo.text}  (+${due.length - 3})` : todo.text).slice(0, 160),
          silent: false
        })
        n.on('click', () => this.open(todo))
        n.show()
      }
    }
    const marked = todos.map((t) => (due.includes(t) ? { ...t, remindedAt: now } : t))
    const settings = await this.storage.setSettings({ todos: marked })
    this.emit({ type: 'settings:updated', settings })
    this.log(`[todo] reminded ${due.length}`)
  }
}
