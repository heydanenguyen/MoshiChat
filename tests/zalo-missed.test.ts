import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

const { ZaloAdapter } = await import('../src/main/adapters/zalo')
let lastAdapter: InstanceType<typeof ZaloAdapter> | undefined

type Emitted = { type: string; message?: { id: string } }

const raw = (msgId: string, ts: number, uidFrom = 'friend') => ({ msgId, cliMsgId: msgId, uidFrom, dName: 'Lan', ts: String(ts), msgType: 'webchat', content: `tin ${msgId}` })

function setup(): { emitted: Emitted[]; listener: EventEmitter } {
  const emitted: Emitted[] = []
  const ctx = { emit: (e: Emitted) => emitted.push(e), log: () => undefined, dataDir: () => '', saveSecret: async () => undefined }
  const adapter = new ZaloAdapter({ id: 'zalo:me', platform: 'zalo', displayName: 'Me', status: 'connected' } as never, {}, ctx as never)
  const listener = Object.assign(new EventEmitter(), { requestOldMessages: () => undefined, requestOldReactions: () => undefined })
  const internals = adapter as unknown as { meId: string; raw: Map<string, unknown[]>; threadTypes: Map<string, number>; wireListener(api: unknown, zca: unknown): void }
  internals.meId = 'me-uid'
  // what this computer had: an older message in the chat with Lan
  internals.raw.set('lan', [raw('1', 1_000)])
  internals.threadTypes.set('lan', 0)
  internals.wireListener({ listener }, {})
  lastAdapter = adapter
  return { emitted, listener }
}

describe('Zalo messages written on another computer', () => {
  it('reach an open chat as updates once this computer signs in again', () => {
    const { emitted, listener } = setup()
    // the account-wide history feed after signing in: two messages from today, and the old one again
    listener.emit('old_messages', [
      { threadId: 'lan', type: 0, data: raw('2', 5_000, 'me-uid') },
      { threadId: 'lan', type: 0, data: raw('3', 6_000) },
      { threadId: 'lan', type: 0, data: raw('1', 1_000) }
    ], 0)
    const updates = emitted.filter((e) => e.type === 'message:updated').map((e) => e.message!.id)
    expect(updates).toEqual(['2', '3'])
    // never as new messages: no sound and no unread count for what may already have been read elsewhere
    expect(emitted.some((e) => e.type === 'message:new')).toBe(false)
  })

  it('leave older history alone (it is loaded when the chat is scrolled)', () => {
    const { emitted, listener } = setup()
    listener.emit('old_messages', [{ threadId: 'lan', type: 0, data: raw('0', 500) }], 0)
    expect(emitted.filter((e) => e.type === 'message:updated')).toEqual([])
  })
})

describe('Zalo history beyond the cache', () => {
  it('is kept in the archive and read when the chat is scrolled past the cache', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { ZaloArchive } = await import('../src/main/adapters/zalo-archive')
    const { listener } = setup()
    const adapter = lastAdapter!
    const internals = adapter as unknown as { archive: unknown; raw: Map<string, Array<{ msgId: string }>>; flushArchive(): Promise<void> }
    internals.archive = new ZaloArchive(await mkdtemp(join(tmpdir(), 'zalo-archive-')))
    // a full cache (1,000 messages), then the history walk brings 5 older ones
    internals.raw.set('lan', Array.from({ length: 1000 }, (_, i) => raw(`n${i}`, 100_000 + i)))
    listener.emit('old_messages', Array.from({ length: 5 }, (_, i) => ({ threadId: 'lan', type: 0, data: raw(`o${i}`, 10_000 + i) })), 0)
    await internals.flushArchive()
    expect(internals.raw.get('lan')!.length).toBe(1000)
    const oldestCached = internals.raw.get('lan')![0].msgId
    const older = await adapter.fetchMessages('zalo:me/lan', { limit: 50, beforeId: oldestCached })
    expect(older.map((m) => m.id)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4'])
  })

  it('a history sync walks until Zalo has nothing older, with progress', async () => {
    const { listener } = setup()
    const adapter = lastAdapter!
    const asked: Array<[number, string | undefined]> = []
    Object.assign(listener, { requestOldMessages: (type: number, below?: string) => asked.push([type, below]) })
    ;(adapter as unknown as { api: unknown }).api = { listener }
    const progress: number[] = []
    const done = adapter.syncHistory((p) => progress.push(p.pages))
    await Promise.resolve()
    // a page for direct chats, then nothing older for either kind
    listener.emit('old_messages', [{ threadId: 'lan', type: 0, data: raw('9', 900) }], 0)
    listener.emit('old_messages', [], 0)
    listener.emit('old_messages', [], 1)
    const result = await done
    expect(result).toMatchObject({ added: 1, reachedEnd: true })
    expect(progress.length).toBe(3)
  })
})
