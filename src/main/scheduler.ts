import { randomUUID } from 'crypto'
import type { BridgeEvent, ScheduledMessage, Settings } from '@shared/types'
import type { AccountManager } from './adapters/manager'
import { RATE_LIMIT_FORWARD, RATE_LIMIT_SEND } from './rate-limit'
import type { Storage } from './storage'

/** A message that was due while Moshi was closed is only sent late if it is still this fresh. */
const LATE_GRACE_MS = 60 * 60 * 1000
/** Accounts that are still connecting (or were sending too fast) get this long before a scheduled message counts as failed. */
const RETRY_WINDOW_MS = 10 * 60 * 1000
const TICK_MS = 15_000

/** A send that failed only because the account is still connecting or was sending too fast: worth another try soon. */
export const isRetryableSend = (error: string): boolean => /connecting/i.test(error) || error.includes(RATE_LIMIT_SEND) || error.includes(RATE_LIMIT_FORWARD)

/**
 * "Send later": messages wait in settings.scheduled and are sent from here when their time comes.
 * Only the main process edits the list (the renderer asks through IPC) and every change is pushed
 * back as a settings:updated event. Sending needs Moshi to be running.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false

  constructor(
    private storage: Storage,
    private manager: AccountManager,
    private emit: (event: BridgeEvent) => void,
    private onFailed: (item: ScheduledMessage) => void,
    private log: (...args: unknown[]) => void
  ) {}

  private get list(): ScheduledMessage[] {
    return this.storage.settings.scheduled ?? []
  }

  private async save(list: ScheduledMessage[]): Promise<Settings> {
    const settings = await this.storage.setSettings({ scheduled: list })
    this.emit({ type: 'settings:updated', settings })
    return settings
  }

  /** Anything that fell due long ago (the app was closed, or the computer slept) waits for the user to decide; returns those. */
  private async markMissed(): Promise<ScheduledMessage[]> {
    const now = Date.now()
    const missed = this.list.filter((m) => m.status === 'pending' && m.sendAt < now - LATE_GRACE_MS).map((m) => ({ ...m, status: 'missed' as const }))
    if (missed.length) await this.save(this.list.map((m) => missed.find((x) => x.id === m.id) ?? m))
    return missed
  }

  async start(): Promise<void> {
    await this.markMissed()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    setTimeout(() => void this.tick(), 5_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async add(input: { conversationId: string; text: string; sendAt: number; replyToId?: string }): Promise<Settings> {
    const text = input.text.trim()
    if (!text) throw new Error('Nothing to send')
    if (!Number.isFinite(input.sendAt)) throw new Error('Invalid time')
    const item: ScheduledMessage = {
      id: randomUUID(),
      conversationId: input.conversationId,
      text: text.slice(0, 4000),
      sendAt: Math.max(input.sendAt, Date.now() + 5_000),
      createdAt: Date.now(),
      replyToId: input.replyToId,
      status: 'pending'
    }
    this.log('scheduled message for', new Date(item.sendAt).toISOString())
    return this.save([...this.list, item].slice(-200))
  }

  async cancel(id: string): Promise<Settings> {
    return this.save(this.list.filter((m) => m.id !== id))
  }

  async reschedule(id: string, sendAt: number): Promise<Settings> {
    return this.save(this.list.map((m) => (m.id === id ? { ...m, sendAt: Math.max(sendAt, Date.now() + 5_000), status: 'pending' as const, error: undefined } : m)))
  }

  /** Send one right away (also used to retry failed or missed ones). */
  async sendNow(id: string): Promise<Settings> {
    const item = this.list.find((m) => m.id === id)
    if (!item) return this.storage.settings
    await this.deliver(item, true)
    return this.storage.settings
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      // The timer does not run while the computer sleeps: on waking, old items are missed, not sent hours late.
      for (const item of await this.markMissed()) this.onFailed(item)
      const due = this.list.filter((m) => m.status === 'pending' && m.sendAt <= Date.now())
      for (const item of due) await this.deliver(item, false)
    } finally {
      this.running = false
    }
  }

  private async deliver(item: ScheduledMessage, manual: boolean): Promise<void> {
    try {
      const message = await this.manager.sendMessage(item.conversationId, item.text, item.replyToId ? { replyToId: item.replyToId } : {})
      this.emit({ type: 'message:new', message })
      await this.save(this.list.filter((m) => m.id !== item.id))
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      // Still connecting, or sending too fast: try again on the next tick for a while before giving up.
      const retry = !manual && isRetryableSend(error) && Date.now() - item.sendAt < RETRY_WINDOW_MS
      if (retry) return
      this.log('scheduled message failed:', error)
      const failed = { ...item, status: 'failed' as const, error }
      await this.save(this.list.map((m) => (m.id === item.id ? failed : m)))
      if (!manual) this.onFailed(failed)
    }
  }
}
