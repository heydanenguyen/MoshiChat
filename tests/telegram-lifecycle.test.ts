import { describe, expect, it, vi } from 'vitest'

const { clients, auth } = vi.hoisted(() => ({ clients: [] as Array<Record<string, ReturnType<typeof vi.fn>>>, auth: { fail: false } }))

vi.mock('telegram', () => ({
  Api: {},
  TelegramClient: class {
    session = { save: () => 'session' }
    setLogLevel = vi.fn()
    start = vi.fn(async () => {
      if (auth.fail) throw new Error('cancelled')
    })
    getMe = vi.fn(async () => ({ id: { toString: () => '42' }, firstName: 'Me' }))
    downloadProfilePhoto = vi.fn(async () => undefined)
    addEventHandler = vi.fn()
    disconnect = vi.fn(async () => undefined)
    destroy = vi.fn(async () => undefined)
    constructor() {
      clients.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>)
    }
  }
}))
vi.mock('telegram/sessions', () => ({ StringSession: class {} }))
vi.mock('telegram/events', () => ({ NewMessage: class {}, NewMessageEvent: class {} }))
vi.mock('telegram/extensions/Logger', () => ({ LogLevel: { ERROR: 'error' } }))

import type { AdapterContext } from '../src/main/adapters/types'
import { TelegramAdapter } from '../src/main/adapters/telegram'

const ctx = { emit: () => undefined, log: () => undefined, saveSecret: async () => undefined } as unknown as AdapterContext

describe('TelegramAdapter client lifecycle', () => {
  it('destroys the client on disconnect (disconnect alone leaves the update loop reconnecting)', async () => {
    clients.length = 0
    const adapter = new TelegramAdapter('telegram:pending', { apiId: 1, apiHash: 'h' }, ctx)
    await adapter.connect()
    await adapter.disconnect()
    expect(clients[0].destroy).toHaveBeenCalledTimes(1)
  })

  it('a reconnect destroys the previous client first', async () => {
    clients.length = 0
    const adapter = new TelegramAdapter('telegram:pending', { apiId: 1, apiHash: 'h' }, ctx)
    await adapter.connect()
    await adapter.connect()
    expect(clients).toHaveLength(2)
    expect(clients[0].destroy).toHaveBeenCalledTimes(1)
    expect(clients[1].destroy).not.toHaveBeenCalled()
  })

  it('a failed sign-in does not leave its client running', async () => {
    clients.length = 0
    const adapter = new TelegramAdapter('telegram:pending', { apiId: 1, apiHash: 'h' }, ctx)
    auth.fail = true
    await expect(adapter.connect()).rejects.toThrow('cancelled')
    auth.fail = false
    expect(clients[0].destroy).toHaveBeenCalledTimes(1)
  })
})
