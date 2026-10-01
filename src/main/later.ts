import type { BridgeEvent, MessagePreview, Settings } from '@shared/types'
import { answers, type LaterEntry, type LaterKind, without } from '@shared/later'
import type { Storage } from './storage'

const TICK_MS = 30_000

export interface LaterDue {
  kind: LaterKind
  conversationId: string
  entry: LaterEntry
}

/**
 * Snoozed chats and follow-ups. Only the main process edits settings.snoozed and settings.followUps (the renderer
 * asks through IPC), so a timer firing and a click in the window never write over each other. When something comes
 * due it is marked (firedAt) and shown once as a system notification; the chat then waits at the top of the inbox
 * until it is opened. A message from them wakes a snooze early and answers a follow-up, which then just goes away.
 */
export class Later {
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private storage: Storage,
    private emit: (event: BridgeEvent) => void,
    private notify: (due: LaterDue[]) => void,
    /** The newest message of each chat behind a shown chat id (a merged person has several). */
    private latest: (conversationId: string) => MessagePreview[],
    private log: (...args: unknown[]) => void
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    setTimeout(() => void this.tick(), 6_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private get snoozed(): Record<string, LaterEntry> {
    return this.storage.settings.snoozed ?? {}
  }

  private get followUps(): Record<string, LaterEntry> {
    return this.storage.settings.followUps ?? {}
  }

  private async save(patch: Pick<Settings, 'snoozed' | 'followUps'>): Promise<Settings> {
    const settings = await this.storage.setSettings(patch)
    this.emit({ type: 'settings:updated', settings })
    return settings
  }

  snooze(conversationId: string, until: number): Promise<Settings> {
    const now = Date.now()
    return this.save({ snoozed: { ...this.snoozed, [conversationId]: { until: Math.max(until, now + 60_000), at: now } } })
  }

  unsnooze(conversationId: string): Promise<Settings> {
    return this.save({ snoozed: without(this.snoozed, conversationId) })
  }

  follow(conversationId: string, until: number): Promise<Settings> {
    const now = Date.now()
    return this.save({ followUps: { ...this.followUps, [conversationId]: { until: Math.max(until, now + 60_000), at: now } } })
  }

  unfollow(conversationId: string): Promise<Settings> {
    return this.save({ followUps: without(this.followUps, conversationId) })
  }

  /** Opened: a snooze whose time came and a follow-up that fired have both been seen. */
  async seen(conversationId: string): Promise<Settings> {
    const now = Date.now()
    const snooze = this.snoozed[conversationId]
    const follow = this.followUps[conversationId]
    const dropSnooze = !!snooze && (!!snooze.firedAt || snooze.until <= now)
    const dropFollow = !!follow && (!!follow.firedAt || follow.until <= now)
    if (!dropSnooze && !dropFollow) return this.storage.settings
    return this.save({
      ...(dropSnooze ? { snoozed: without(this.snoozed, conversationId) } : {}),
      ...(dropFollow ? { followUps: without(this.followUps, conversationId) } : {})
    })
  }

  /** A message in a shown chat: one from them brings a snoozed chat back and settles a follow-up. */
  onMessage(conversationId: string, message: { isOutgoing: boolean; sentAt: number }): void {
    const snooze = this.snoozed[conversationId]
    const follow = this.followUps[conversationId]
    const wake = !!snooze && answers(snooze, message)
    const settle = !!follow && answers(follow, message)
    if (!wake && !settle) return
    void this.save({
      ...(wake ? { snoozed: without(this.snoozed, conversationId) } : {}),
      ...(settle ? { followUps: without(this.followUps, conversationId) } : {})
    })
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    const due: LaterDue[] = []
    const snoozed = { ...this.snoozed }
    const followUps = { ...this.followUps }
    let changed = false
    for (const [id, entry] of Object.entries(snoozed)) {
      if (entry.firedAt || entry.until > now) continue
      snoozed[id] = { ...entry, firedAt: now }
      due.push({ kind: 'snooze', conversationId: id, entry })
      changed = true
    }
    for (const [id, entry] of Object.entries(followUps)) {
      if (entry.firedAt || entry.until > now) continue
      changed = true
      // They wrote back while Moshi was closed (the chat list knows even when no message event came).
      if (this.latest(id).some((m) => answers(entry, m))) {
        delete followUps[id]
        continue
      }
      followUps[id] = { ...entry, firedAt: now }
      due.push({ kind: 'follow', conversationId: id, entry })
    }
    if (!changed) return
    await this.save({ snoozed, followUps })
    if (due.length) {
      this.notify(due)
      this.log(`[later] due ${due.length}`)
    }
  }
}
