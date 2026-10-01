import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BridgeEvent } from '../src/shared/types'
import type { AdapterContext } from '../src/main/adapters/types'
import { planChatSync, WhatsAppAdapter } from '../src/main/adapters/whatsapp'

type Handler = (payload: unknown) => void

function setup(): { emit: (name: string, payload: unknown) => void; events: BridgeEvent[] } {
  const handlers = new Map<string, Handler[]>()
  const events: BridgeEvent[] = []
  const ctx = { emit: (e: BridgeEvent) => events.push(e), log: () => undefined } as unknown as AdapterContext
  const adapter = new WhatsAppAdapter('whatsapp:1', { authDir: 'x' }, ctx)
  const sock = { ev: { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) } }
  ;(adapter as unknown as { wireEvents(sock: unknown, lib: unknown): void }).wireEvents(sock, { areJidsSameUser: () => false })
  return { emit: (name, payload) => (handlers.get(name) ?? []).forEach((fn) => fn(payload)), events }
}

describe('planChatSync', () => {
  it('sends only the changed listable chats', () => {
    expect(planChatSync(['a@s.whatsapp.net', 'a@s.whatsapp.net', 'status@broadcast', 'n@newsletter'], false)).toEqual({ reset: false, jids: ['a@s.whatsapp.net'] })
  })

  it('falls back to the full list for history sync or a big batch', () => {
    expect(planChatSync(['a@s.whatsapp.net'], true)).toEqual({ reset: true })
    expect(planChatSync(['a@s.whatsapp.net', 'b@s.whatsapp.net', 'c@s.whatsapp.net'], false, 2)).toEqual({ reset: true })
  })
})

describe('WhatsApp chat events', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('an update to one chat upserts that chat instead of resetting the account', () => {
    vi.useFakeTimers()
    const { emit, events } = setup()
    emit('chats.upsert', [
      { id: 'a@s.whatsapp.net', name: 'A', conversationTimestamp: 1 },
      { id: 'b@s.whatsapp.net', name: 'B', conversationTimestamp: 1 }
    ])
    vi.advanceTimersByTime(800)
    events.length = 0
    emit('chats.update', [{ id: 'a@s.whatsapp.net', unreadCount: 2, conversationTimestamp: 5 }])
    emit('chats.update', [{ id: 'a@s.whatsapp.net', unreadCount: 3 }])
    vi.advanceTimersByTime(800)
    expect(events.map((e) => e.type)).toEqual(['conversation:upserted'])
    const event = events[0] as Extract<BridgeEvent, { type: 'conversation:upserted' }>
    expect(event.conversation.id).toBe('whatsapp:1/a@s.whatsapp.net')
    expect(event.conversation.unreadCount).toBe(3)
  })

  it('history sync still sends the full list', async () => {
    vi.useFakeTimers()
    const { emit, events } = setup()
    emit('messaging-history.set', { chats: [{ id: 'a@s.whatsapp.net', name: 'A' }], contacts: [], messages: [] })
    emit('chats.update', [{ id: 'a@s.whatsapp.net', unreadCount: 1 }])
    await vi.advanceTimersByTimeAsync(800)
    expect(events.map((e) => e.type)).toEqual(['conversations:reset'])
  })
})
