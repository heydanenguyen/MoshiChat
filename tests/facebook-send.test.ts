import { describe, expect, it, vi } from 'vitest'
import type { BridgeEvent } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const { FacebookPersonalAdapter } = await import('../src/main/adapters/facebook-personal')

function setup(api: Record<string, unknown>): { adapter: InstanceType<typeof FacebookPersonalAdapter>; events: BridgeEvent[] } {
  const events: BridgeEvent[] = []
  const ctx = { emit: (e: BridgeEvent) => events.push(e), log: () => undefined, saveSecret: async () => undefined } as never
  const adapter = new FacebookPersonalAdapter('messenger:fb-1', { cookies: [] }, ctx)
  Object.assign(adapter as unknown as Record<string, unknown>, { api, meId: '1' })
  return { adapter, events }
}

describe('sending on Facebook', () => {
  it('sends text over the realtime connection and takes the echo’s id, without showing it twice', async () => {
    const http = vi.fn()
    const api: Record<string, unknown> = { sendMessage: http }
    const { adapter, events } = setup(api)
    api.sendMessageMqtt = vi.fn(async () => {
      // Messenger echoes the message back over the same connection a moment later
      setTimeout(() => (adapter as unknown as { onEvent(e: unknown): void }).onEvent({ type: 'message', threadID: '42', senderID: '1', messageID: 'mid.$real', body: 'mẹ biết chỗ nào', timestamp: '1790000000000', attachments: [] }), 20)
      return { threadID: '42' }
    })
    const sent = await adapter.sendMessage('messenger:fb-1/42', 'mẹ biết chỗ nào')
    expect(sent.id).toBe('mid.$real')
    expect(http).not.toHaveBeenCalled()
    expect(events.filter((e) => e.type === 'message:new')).toHaveLength(0)
  })

  it('falls back to the old endpoint when the realtime connection is not there', async () => {
    const http = vi.fn(async () => ({ messageID: 'mid.$old', timestamp: 1 }))
    const { adapter } = setup({ sendMessage: http })
    const sent = await adapter.sendMessage('messenger:fb-1/42', 'xin chào')
    expect(http).toHaveBeenCalledOnce()
    expect(sent.id).toBe('mid.$old')
  })
})
