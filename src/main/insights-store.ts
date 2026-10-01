import { app } from 'electron'
import { join } from 'path'
import { readFile, rename, writeFile } from 'fs/promises'
import type { InsightRecord } from '@shared/insights'
import type { Message } from '@shared/types'

const DAY = 24 * 60 * 60 * 1000
/** Records older than this are dropped; "this year" needs up to a year. */
const KEEP_MS = 400 * DAY
const SAVE_EVERY_MS = 30_000

/** How far back a chat's history has been walked for the insights, and when. */
export interface Coverage {
  from: number
  at: number
  /** 2: walked to the period start for real. Older entries could be marked after a partial walk. */
  v?: number
}
const COVERAGE_VERSION = 2

export const toInsightRecord = (m: Message): InsightRecord => ({
  conversationId: m.conversationId,
  id: m.id,
  sentAt: m.sentAt,
  isOutgoing: m.isOutgoing,
  senderName: m.senderName,
  text: m.text.slice(0, 140),
  hasPhoto: m.attachments.some((a) => a.kind === 'image' || a.kind === 'video')
})

/**
 * Light message records kept on disk for the friendship insights and memories, so counting the
 * last 30 days does not depend on which chats happen to be loaded right now. Filled by the
 * backfill in AccountManager and by every message that passes through the app.
 */
export class InsightStore {
  private records = new Map<string, InsightRecord>()
  private coverage: Record<string, Coverage> = {}
  private loaded = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  private get file(): string {
    return join(app.getPath('userData'), 'insights-records.json')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { records?: InsightRecord[]; coverage?: Record<string, Coverage> }
      const cutoff = Date.now() - KEEP_MS
      for (const r of raw.records ?? []) if (r && r.sentAt >= cutoff) this.records.set(`${r.conversationId}|${r.id}`, r)
      this.coverage = raw.coverage ?? {}
    } catch {
      /* first run */
    }
  }

  add(messages: Message[]): void {
    let changed = false
    for (const m of messages) {
      if (m.system || m.id.startsWith('temp-') || m.id.startsWith('local-')) continue
      const key = `${m.conversationId}|${m.id}`
      if (this.records.has(key)) continue
      this.records.set(key, toInsightRecord(m))
      changed = true
    }
    if (changed) this.scheduleSave()
  }

  has(conversationId: string, id: string): boolean {
    return this.records.has(`${conversationId}|${id}`)
  }

  all(): InsightRecord[] {
    return [...this.records.values()]
  }

  coverageOf(conversationId: string): Coverage | undefined {
    const cover = this.coverage[conversationId]
    return cover?.v === COVERAGE_VERSION ? cover : undefined
  }

  markCovered(conversationId: string, from: number, at = Date.now()): void {
    this.coverage[conversationId] = { from, at, v: COVERAGE_VERSION }
    this.scheduleSave()
  }

  /** Forget a chat (account removed). */
  forget(conversationId: string): void {
    for (const key of this.records.keys()) if (key.startsWith(conversationId + '|')) this.records.delete(key)
    delete this.coverage[conversationId]
    this.scheduleSave()
  }

  /**
   * Saved at most every 30 s, and on quit (flush). The whole file is rewritten (megabytes once there is a year of
   * history), so saving 2 s after every message kept the disk and the main process busy while chats were lively.
   */
  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => void this.save(), SAVE_EVERY_MS)
  }

  /** Write now if anything is waiting (on quit). */
  async flush(): Promise<void> {
    if (!this.saveTimer) return
    await this.save()
  }

  private async save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    const cutoff = Date.now() - KEEP_MS
    // Old records leave memory too, not just the file.
    for (const [key, r] of this.records) if (r.sentAt < cutoff) this.records.delete(key)
    const tmp = this.file + '.tmp'
    try {
      // Through a temporary file, so quitting mid-write never leaves half a file.
      await writeFile(tmp, JSON.stringify({ records: this.all(), coverage: this.coverage }))
      await rename(tmp, this.file)
    } catch {
      /* the next save tries again */
    }
  }
}
