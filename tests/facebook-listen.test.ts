import { describe, expect, it, vi } from 'vitest'
import type { AdapterContext } from '../src/main/adapters/types'

vi.mock('electron', () => ({ app: { getPath: () => '' }, session: { fromPartition: () => ({}) } }))
const { FacebookPersonalAdapter } = await import('../src/main/adapters/facebook-personal')

const ctx: AdapterContext = {
  emit: () => undefined,
  requestAuth: async () => '',
  presentQr: () => 'qr',
  noteAuth: () => undefined,
  dismissAuth: () => undefined,
  saveSecret: async () => undefined,
  dataDir: () => '.',
  log: () => undefined
}

/** A stand-in for ws3-fca's api: listenMqtt resolves to an emitter (it never returns a stop function), and the first
 * listen calls api.markAsReadAll() on the same object, as listenMqtt.js does. */
function fakeApi(): { api: Record<string, unknown>; stop: ReturnType<typeof vi.fn>; readAll: ReturnType<typeof vi.fn>; deliver(event: unknown): void } {
  const stop = vi.fn()
  const readAll = vi.fn(async () => undefined)
  let callback: (err: unknown, event: unknown) => void = () => undefined
  const api: Record<string, unknown> = { markAsReadAll: readAll }
  api.listenMqtt = async (cb: typeof callback) => {
    callback = cb
    await (api.markAsReadAll as () => Promise<void>)()
    return { stop }
  }
  return { api, stop, readAll, deliver: (event) => callback(null, event) }
}

type Internals = { api?: unknown; listen(api: unknown): Promise<void>; disconnect(): Promise<void>; onEvent(e: unknown): void }

describe('Messenger listening', () => {
  it('never marks every thread read when it starts listening', async () => {
    const adapter = new FacebookPersonalAdapter('messenger:fb-1', { cookies: [] }, ctx) as unknown as Internals
    const fake = fakeApi()
    adapter.api = fake.api
    await adapter.listen(fake.api)
    expect(fake.readAll).not.toHaveBeenCalled()
  })

  it('really stops the connection on disconnect, and ignores events after it', async () => {
    const adapter = new FacebookPersonalAdapter('messenger:fb-1', { cookies: [] }, ctx) as unknown as Internals
    const fake = fakeApi()
    adapter.api = fake.api
    await adapter.listen(fake.api)
    const seen = vi.spyOn(adapter, 'onEvent')
    await adapter.disconnect()
    expect(fake.stop).toHaveBeenCalledOnce()
    fake.deliver({ type: 'message', threadID: '1' })
    expect(seen).not.toHaveBeenCalled()
  })

  it('stops a connection that finished setting up after the account was disconnected', async () => {
    const adapter = new FacebookPersonalAdapter('messenger:fb-1', { cookies: [] }, ctx) as unknown as Internals
    const fake = fakeApi()
    // No current api: the account went away while listenMqtt was still connecting.
    adapter.api = undefined
    await adapter.listen(fake.api)
    expect(fake.stop).toHaveBeenCalledOnce()
  })
})
