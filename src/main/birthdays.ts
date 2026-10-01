import type { BridgeEvent, Conversation } from '@shared/types'
import { isBirthdayToday } from '@shared/extras'
import type { Storage } from './storage'

const TICK_MS = 15 * 60_000
/** Nobody wants a birthday reminder at 00:01. */
const FROM_HOUR = 9

export interface BirthdayDue {
  conversationId: string
  birthday: string
}

/**
 * Birthday reminders: on the morning of the day (from 9:00, or when Moshi opens later that day) one notification
 * per person, once a year. Birthdays come from what you set on a contact, else what the platform said. Groups and
 * hidden chats are left out. Only this class writes settings.birthdaysNotified.
 */
export class Birthdays {
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private storage: Storage,
    private emit: (event: BridgeEvent) => void,
    private conversations: () => Conversation[],
    private notify: (due: BirthdayDue[]) => void,
    private log: (...args: unknown[]) => void
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    setTimeout(() => void this.tick(), 20_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Who has a birthday today and has not been announced this year. */
  due(now = new Date()): BirthdayDue[] {
    const settings = this.storage.settings
    if (settings.birthdayReminders === false || now.getHours() < FROM_HOUR) return []
    const year = now.getFullYear()
    const known = new Map(this.conversations().map((c) => [c.id, c]))
    const ids = new Set([...Object.keys(settings.contactOverrides ?? {}), ...Object.keys(settings.knownBirthdays ?? {})])
    const due: BirthdayDue[] = []
    for (const id of ids) {
      const birthday = settings.contactOverrides?.[id]?.birthday ?? settings.knownBirthdays?.[id]
      const chat = known.get(id)
      if (!birthday || !chat || chat.isGroup || settings.hidden?.[id]) continue
      if (settings.birthdaysNotified?.[id] === year || !isBirthdayToday(birthday, now)) continue
      due.push({ conversationId: id, birthday })
    }
    return due
  }

  private async tick(): Promise<void> {
    const due = this.due()
    if (!due.length) return
    const year = new Date().getFullYear()
    const notified = { ...this.storage.settings.birthdaysNotified }
    for (const d of due) notified[d.conversationId] = year
    const settings = await this.storage.setSettings({ birthdaysNotified: notified })
    this.emit({ type: 'settings:updated', settings })
    if (settings.notifications) this.notify(due)
    this.log(`[birthday] ${due.length} today`)
  }
}
