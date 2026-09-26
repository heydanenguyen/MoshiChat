import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BridgeEvent } from '../src/shared/types'
import { MetaAdapter } from '../src/main/adapters/meta'
import type { AdapterContext } from '../src/main/adapters/types'

function makeCtx(): { ctx: AdapterContext; events: BridgeEvent[] } {
  const events: BridgeEvent[] = []
  return {
    events,
    ctx: {
      emit: (e) => events.push(e),
      requestAuth: async () => '',
      presentQr: () => 'qr',
      noteAuth: () => undefined,
      dismissAuth: () => undefined,
      saveSecret: async () => undefined,
      dataDir: () => '.',
      log: () => undefined
    }
  }
}

interface Call {
  url: URL
  method: string
  body?: unknown
}

/** Fake Graph API: records calls and answers by path. */
function mockGraph(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input))
    const call: Call = { url, method: init?.method ?? 'GET' }
    if (typeof init?.body === 'string') call.body = JSON.parse(init.body)
    calls.push(call)
    const key = `${call.method} ${url.pathname}`
    const payload = routes[key] ?? routes[url.pathname]
    if (!payload) return new Response(JSON.stringify({ error: { message: `no route ${key}`, code: 404 } }), { status: 404 })
    return new Response(JSON.stringify(payload), { status: 200 })
  })
  return calls
}

describe('MetaAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('connects as a Page and maps conversations and messages', async () => {
    vi.useFakeTimers()
    const calls = mockGraph({
      '/v21.0/123': { id: '123', name: 'My Page', picture: { data: { url: 'https://img/p.jpg' } } },
      '/v21.0/123/conversations': {
        data: [
          {
            id: 't_1',
            updated_time: '2026-09-26T10:00:00+0000',
            unread_count: 2,
            participants: { data: [{ id: '123', name: 'My Page' }, { id: '999', name: 'Khách A' }] },
            messages: { data: [{ id: 'm_1', message: 'Shop còn hàng không?', from: { id: '999', name: 'Khách A' }, created_time: '2026-09-26T10:00:00+0000' }] }
          }
        ]
      },
      '/v21.0/t_1/messages': {
        data: [
          { id: 'm_2', message: 'Dạ còn ạ', from: { id: '123', name: 'My Page' }, created_time: '2026-09-26T10:01:00+0000' },
          {
            id: 'm_1',
            message: 'Shop còn hàng không?',
            from: { id: '999', name: 'Khách A' },
            created_time: '2026-09-26T10:00:00+0000',
            attachments: { data: [{ id: 'a1', mime_type: 'image/jpeg', image_data: { url: 'https://img/a.jpg', preview_url: 'https://img/a-s.jpg', width: 800, height: 600 } }] }
          }
        ],
        paging: { cursors: { after: 'CURSOR' } }
      }
    })
    const { ctx } = makeCtx()
    const adapter = new MetaAdapter('messenger', { pageId: '123', accessToken: 'TOKEN' }, ctx)
    await adapter.connect()
    expect(adapter.account.status).toBe('connected')
    expect(adapter.account.displayName).toBe('My Page')
    expect(adapter.account.avatarUrl).toBe('https://img/p.jpg')
    expect(calls[0].url.searchParams.get('access_token')).toBe('TOKEN')

    const [conversation] = await adapter.listConversations()
    expect(conversation.id).toBe('messenger:123/t_1')
    expect(conversation.title).toBe('Khách A')
    expect(conversation.unreadCount).toBe(2)
    expect(conversation.lastMessage?.text).toBe('Shop còn hàng không?')
    expect(conversation.participants.find((p) => p.isMe)?.id).toBe('123')

    const messages = await adapter.fetchMessages(conversation.id, { limit: 50 })
    expect(messages.map((m) => m.id)).toEqual(['m_1', 'm_2'])
    expect(messages[0].isOutgoing).toBe(false)
    expect(messages[1].isOutgoing).toBe(true)
    expect(messages[0].attachments[0]).toMatchObject({ kind: 'image', url: 'https://img/a.jpg', thumbnailUrl: 'https://img/a-s.jpg', width: 800 })
    await adapter.disconnect()
  })

  it('sends text to the other participant with the Send API', async () => {
    vi.useFakeTimers()
    const calls = mockGraph({
      '/v21.0/123': { id: '123', name: 'My Page' },
      '/v21.0/123/conversations': {
        data: [{ id: 't_1', updated_time: '2026-09-26T10:00:00+0000', participants: { data: [{ id: '123' }, { id: '999', name: 'Khách A' }] } }]
      },
      'POST /v21.0/123/messages': { message_id: 'mid.sent' }
    })
    const { ctx, events } = makeCtx()
    const adapter = new MetaAdapter('messenger', { pageId: '123', accessToken: 'TOKEN' }, ctx)
    await adapter.connect()
    await adapter.listConversations()
    const sent = await adapter.sendMessage('messenger:123/t_1', 'Cảm ơn bạn')
    expect(sent.id).toBe('mid.sent')
    expect(sent.isOutgoing).toBe(true)
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ recipient: { id: '999' }, messaging_type: 'RESPONSE', message: { text: 'Cảm ơn bạn' } })
    expect(events.some((e) => e.type === 'conversation:upserted' && e.conversation.lastMessage?.text === 'Cảm ơn bạn')).toBe(true)
    await adapter.disconnect()
  })

  it('requires a linked professional account for Instagram', async () => {
    mockGraph({ '/v21.0/123': { id: '123', name: 'My Page' } })
    const { ctx } = makeCtx()
    const adapter = new MetaAdapter('instagram', { pageId: '123', accessToken: 'TOKEN' }, ctx)
    await expect(adapter.connect()).rejects.toThrow('Instagram')
    expect(adapter.account.status).toBe('error')
  })

  it('surfaces Graph API errors with their code', async () => {
    mockGraph({})
    const { ctx } = makeCtx()
    const adapter = new MetaAdapter('messenger', { pageId: '123', accessToken: 'BAD' }, ctx)
    await expect(adapter.connect()).rejects.toThrow('code 404')
  })
})
