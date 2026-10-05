/**
 * Zalo history beyond what the live cache keeps (the newest 1,000 messages a chat): everything older the history
 * walk brings in, one file per chat, oldest first, so it is never fetched and dropped again. Read when the chat is
 * scrolled past its cache and when it is searched.
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TMessage } from 'zca-js'

export class ZaloArchive {
  private loaded = new Map<string, TMessage[]>()

  constructor(private readonly dir: string) {}

  private file(threadId: string): string {
    return join(this.dir, `${threadId.replace(/[^\w-]/g, '_')}.json`)
  }

  async get(threadId: string): Promise<TMessage[]> {
    const cached = this.loaded.get(threadId)
    if (cached) return cached
    let list: TMessage[] = []
    try {
      list = JSON.parse(await readFile(this.file(threadId), 'utf8')) as TMessage[]
    } catch {
      /* nothing imported for this chat */
    }
    this.loaded.set(threadId, list)
    return list
  }

  /** Add messages (by id, newer copies win), keep them oldest first, and write the chat's file. */
  async add(threadId: string, messages: TMessage[]): Promise<number> {
    const byId = new Map((await this.get(threadId)).map((m) => [m.msgId, m]))
    const before = byId.size
    for (const m of messages) if (m.msgId) byId.set(m.msgId, m)
    const list = [...byId.values()].sort((a, b) => Number(a.ts) - Number(b.ts))
    this.loaded.set(threadId, list)
    await mkdir(this.dir, { recursive: true })
    const target = this.file(threadId)
    await writeFile(`${target}.tmp`, JSON.stringify(list))
    await rename(`${target}.tmp`, target)
    return byId.size - before
  }

  /** Up to `limit` messages sent before `ts`, oldest first. */
  async before(threadId: string, ts: number, limit: number): Promise<TMessage[]> {
    const list = await this.get(threadId)
    let end = list.length
    while (end > 0 && Number(list[end - 1].ts) >= ts) end--
    return list.slice(Math.max(0, end - limit), end)
  }

  /** Every archived message id, per chat (read once at sign-in, so the history walk can tell what it has). */
  async ids(): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>()
    const files = await readdir(this.dir).catch(() => [] as string[])
    for (const name of files.filter((f) => f.endsWith('.json'))) {
      try {
        const list = JSON.parse(await readFile(join(this.dir, name), 'utf8')) as TMessage[]
        const threadId = name.slice(0, -'.json'.length)
        out.set(threadId, new Set(list.map((m) => m.msgId)))
      } catch {
        /* a damaged file: its messages count as missing and are fetched again */
      }
    }
    return out
  }

  /** When a message was sent, if the archive has it. */
  async timeOf(threadId: string, msgId: string): Promise<number | undefined> {
    const found = (await this.get(threadId)).find((m) => m.msgId === msgId)
    return found ? Number(found.ts) : undefined
  }
}
