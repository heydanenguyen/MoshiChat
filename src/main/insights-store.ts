import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import type { InsightRecord } from '@shared/insights'
import type { Message } from '@shared/types'

const DAY = 24 * 60 * 60 * 1000
/** Records older than this are dropped; "this year" needs up to a year. */
const KEEP_MS = 400 * DAY

/** How far back a chat's history has been walked for the insights, and when. */
export interface Coverage {
  from: number
  at: number
}

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
    return this.coverage[conversationId]
  }

  markCovered(conversationId: string, from: number): void {
    this.coverage[conversationId] = { from, at: Date.now() }
    this.scheduleSave()
  }

  /** Forget a chat (account removed). */
  forget(conversationId: string): void {
    for (const key of this.records.keys()) if (key.startsWith(conversationId + '|')) this.records.delete(key)
    delete this.coverage[conversationId]
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      const cutoff = Date.now() - KEEP_MS
      const records = this.all().filter((r) => r.sentAt >= cutoff)
      void writeFile(this.file, JSON.stringify({ records, coverage: this.coverage })).catch(() => undefined)
    }, 2000)
  }
}
