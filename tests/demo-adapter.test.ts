import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeEvent } from '../src/shared/types'
import { DemoAdapter } from '../src/main/adapters/demo'
import type { AdapterContext } from '../src/main/adapters/types'

function makeCtx(): { ctx: AdapterContext; events: BridgeEvent[] } {
  const events: BridgeEvent[] = []
  const ctx: AdapterContext = {
    emit: (e) => events.push(e),
    requestAuth: async () => '',
    presentQr: () => 'qr',
    noteAuth: () => undefined,
    dismissAuth: () => undefined,
    saveSecret: async () => undefined,
    dataDir: () => '.',
    log: () => undefined
  }
  return { ctx, events }
}

describe('DemoAdapter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('connects and exposes sample conversations for its platform', async () => {
    const { ctx, events } = makeCtx()
    const adapter = new DemoAdapter('zalo', ctx)
    const connecting = adapter.connect()
    await vi.advanceTimersByTimeAsync(1500)
    await connecting
    expect(adapter.account.status).toBe('connected')
    expect(events.map((e) => e.type)).toEqual(['account:updated', 'account:updated'])
    const conversations = await adapter.listConversations()
    expect(conversations.length).toBeGreaterThan(0)
    expect(conversations.every((c) => c.platform === 'zalo' && c.accountId === 'demo-zalo')).toBe(true)
    await adapter.disconnect()
  })

  it('answers a sent message with typing and an auto-reply', async () => {
    const { ctx, events } = makeCtx()
    const adapter = new DemoAdapter('messenger', ctx)
    const connecting = adapter.connect()
    await vi.advanceTimersByTimeAsync(1500)
    await connecting
    const [conversation] = await adapter.listConversations()
    events.length = 0
    const sent = await adapter.sendMessage(conversation.id, 'xin chào')
    expect(sent.isOutgoing).toBe(true)
    expect(events.some((e) => e.type === 'message:new' && e.message.id === sent.id)).toBe(true)
    await vi.advanceTimersByTimeAsync(6000)
    const types = events.map((e) => e.type)
    expect(types).toContain('typing')
    const replies = events.filter((e): e is Extract<BridgeEvent, { type: 'message:new' }> => e.type === 'message:new' && !e.message.isOutgoing)
    expect(replies.length).toBe(1)
    expect(replies[0].message.conversationId).toBe(conversation.id)
    const readUpdate = events.find((e) => e.type === 'message:updated' && e.message.id === sent.id && e.message.status === 'read')
    expect(readUpdate).toBeTruthy()
    await adapter.disconnect()
  })

  it('threads replies, toggles reactions, forwards and searches', async () => {
    const { ctx, events } = makeCtx()
    const adapter = new DemoAdapter('telegram', ctx)
    const connecting = adapter.connect()
    await vi.advanceTimersByTimeAsync(1500)
    await connecting
    const conversations = await adapter.listConversations()
    const [a, b] = conversations
    const history = await adapter.fetchMessages(a.id, { limit: 50 })
    const target = history[0]

    const reply = await adapter.sendMessage(a.id, 'reply', { replyToId: target.id })
    expect(reply.replyTo?.id).toBe(target.id)

    await adapter.react(a.id, target.id, '👍')
    let updated = events.filter((e): e is Extract<BridgeEvent, { type: 'message:updated' }> => e.type === 'message:updated').at(-1)!
    expect(updated.message.reactions.some((r) => r.emoji === '👍' && r.byMe)).toBe(true)
    await adapter.react(a.id, target.id, '👍')
    updated = events.filter((e): e is Extract<BridgeEvent, { type: 'message:updated' }> => e.type === 'message:updated').at(-1)!
    expect(updated.message.reactions.some((r) => r.emoji === '👍' && r.byMe)).toBe(false)

    const forwarded = await adapter.forward(a.id, target.id, b.id)
    expect(forwarded.conversationId).toBe(b.id)
    expect(forwarded.text).toBe(target.text)
    expect(forwarded.isOutgoing).toBe(true)

    const word = target.text.split(' ')[0]
    const hits = await adapter.searchMessages(word, 10)
    expect(hits.some((m) => m.id === target.id)).toBe(true)
    await adapter.disconnect()
  })

  it('clears unread on markRead and paginates history', async () => {
    const { ctx, events } = makeCtx()
    const adapter = new DemoAdapter('instagram', ctx)
    const connecting = adapter.connect()
    await vi.advanceTimersByTimeAsync(1500)
    await connecting
    const unread = (await adapter.listConversations()).find((c) => c.unreadCount > 0)!
    await adapter.markRead(unread.id)
    const upsert = events.filter((e): e is Extract<BridgeEvent, { type: 'conversation:upserted' }> => e.type === 'conversation:upserted').at(-1)!
    expect(upsert.conversation.unreadCount).toBe(0)
    const all = await adapter.fetchMessages(unread.id, { limit: 50 })
    const older = await adapter.fetchMessages(unread.id, { limit: 2, beforeId: all[all.length - 1].id })
    expect(older.length).toBeLessThanOrEqual(2)
    expect(older.every((m) => m.sentAt <= all[all.length - 1].sentAt)).toBe(true)
    await adapter.disconnect()
  })
})
