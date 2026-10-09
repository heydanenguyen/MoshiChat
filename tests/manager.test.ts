import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))

import type { Account, BridgeEvent, Conversation, Message } from '../src/shared/types'
import { ALL_FEATURES } from '../src/shared/types'
import { AccountManager, isTransientConnectError } from '../src/main/adapters/manager'
import type { AdapterContext, PlatformAdapter } from '../src/main/adapters/types'
import type { Storage, StoredAccount } from '../src/main/storage'

/** Minimal in-memory stand-in for the encrypted store. */
function fakeStorage(initial: StoredAccount[] = []): Storage {
  const accounts: StoredAccount[] = [...initial]
  const secrets = new Map<string, unknown>()
  return {
    accounts,
    settings: { theme: 'system', language: 'vi', notifications: true, sendOnEnter: true },
    load: async () => undefined,
    setSettings: async (patch) => ({ theme: 'system', language: 'vi', notifications: true, sendOnEnter: true, ...patch }),
    upsertAccount: async (account: Account, secret?: unknown) => {
      const existing = accounts.find((a) => a.id === account.id)
      const stored = { id: account.id, platform: account.platform, displayName: account.displayName, demo: account.demo }
      if (existing) Object.assign(existing, stored)
      else accounts.push(stored)
      if (secret !== undefined) secrets.set(account.id, secret)
    },
    removeAccount: async (id: string) => {
      const i = accounts.findIndex((a) => a.id === id)
      if (i >= 0) accounts.splice(i, 1)
    },
    readSecret: <T,>(id: string) => secrets.get(id) as T | undefined
  } as unknown as Storage
}

function message(conversationId: string, id: string, text: string, isOutgoing = false): Message {
  return { id, conversationId, senderId: isOutgoing ? 'me' : 'them', senderName: isOutgoing ? 'Me' : 'Them', text, attachments: [], reactions: [], sentAt: Number(id.replace(/\D/g, '')) || 1, isOutgoing, status: 'delivered' }
}

/** A scriptable adapter: learns its real id during connect like Telegram/WhatsApp do. */
class FakeAdapter implements PlatformAdapter {
  account: Account
  sent: Array<{ to: string; text: string }> = []
  forwarded: string[] = []
  remote: Message[] = []
  constructor(
    id: string,
    private readonly ctx: AdapterContext,
    private readonly realId?: string,
    private readonly failConnect?: Error
  ) {
    this.account = { id, platform: 'telegram', displayName: 'Fake', status: 'disconnected', features: ALL_FEATURES }
  }
  async connect(): Promise<void> {
    if (this.failConnect) throw this.failConnect
    if (this.realId) this.account.id = this.realId
    this.account.status = 'connected'
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
  async disconnect(): Promise<void> {
    this.account.status = 'disconnected'
  }
  async listConversations(): Promise<Conversation[]> {
    return ['c1', 'c2'].map((ext) => ({
      id: `${this.account.id}/${ext}`,
      accountId: this.account.id,
      platform: 'telegram',
      title: ext,
      isGroup: false,
      participants: [],
      unreadCount: 0,
      updatedAt: 1
    }))
  }
  async fetchMessages(conversationId: string): Promise<Message[]> {
    return [message(conversationId, 'm10', `hello from ${conversationId}`), message(conversationId, 'm20', 'second', true)]
  }
  async sendMessage(conversationId: string, text: string): Promise<Message> {
    this.sent.push({ to: conversationId, text })
    return message(conversationId, `m${Date.now()}`, text, true)
  }
  async forward(from: string, messageId: string, to: string): Promise<Message> {
    this.forwarded.push(`${from}#${messageId}->${to}`)
    return message(to, 'fwd', 'native forward', true)
  }
  async searchMessages(): Promise<Message[]> {
    return this.remote
  }
  async markRead(): Promise<void> {}
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('AccountManager', () => {
  it('restores stored accounts through the factory and loads their conversations', async () => {
    const events: BridgeEvent[] = []
    const storage = fakeStorage([{ id: 'telegram:1', platform: 'telegram', displayName: 'Old' }])
    const manager = new AccountManager(storage, (e) => events.push(e), () => undefined, (stored, ctx) => new FakeAdapter(stored.id, ctx))
    await manager.restore()
    await flush()
    await flush()
    expect(manager.listAccounts().map((a) => a.id)).toEqual(['telegram:1'])
    expect(manager.listConversations().map((c) => c.id).sort()).toEqual(['telegram:1/c1', 'telegram:1/c2'])
    expect(events.some((e) => e.type === 'conversations:reset' && e.accountId === 'telegram:1')).toBe(true)
  })

  it('re-keys a pending account once sign-in reveals the real id', async () => {
    const events: BridgeEvent[] = []
    const storage = fakeStorage()
    const manager = new AccountManager(storage, (e) => events.push(e), () => undefined)
    let adapter!: FakeAdapter
    const ctx = manager['contextFor']('telegram:pending-x', () => adapter.account.id)
    adapter = new FakeAdapter('telegram:pending-x', ctx, 'telegram:42')
    const account = await manager.adoptPending('telegram:pending-x', adapter)
    expect(account.id).toBe('telegram:42')
    expect(manager.listAccounts().map((a) => a.id)).toEqual(['telegram:42'])
    expect(storage.accounts.map((a) => a.id)).toEqual(['telegram:42'])
    expect(events.some((e) => e.type === 'account:removed' && e.accountId === 'telegram:pending-x')).toBe(true)
  })

  it('drops a pending account when sign-in fails', async () => {
    const events: BridgeEvent[] = []
    const manager = new AccountManager(fakeStorage(), (e) => events.push(e), () => undefined)
    const ctx = manager['contextFor']('whatsapp:pending-y')
    const adapter = new FakeAdapter('whatsapp:pending-y', ctx, undefined, new Error('Sign-in cancelled'))
    await expect(manager.adoptPending('whatsapp:pending-y', adapter)).rejects.toThrow('Sign-in cancelled')
    expect(manager.listAccounts()).toEqual([])
    expect(events.at(-1)).toEqual({ type: 'account:removed', accountId: 'whatsapp:pending-y' })
  })

  it('forwards natively within an account and falls back to text across accounts', async () => {
    const manager = new AccountManager(fakeStorage(), () => undefined, () => undefined)
    const a = new FakeAdapter('telegram:a', manager['contextFor']('telegram:a'))
    const b = new FakeAdapter('telegram:b', manager['contextFor']('telegram:b'))
    await manager.adoptPending('telegram:a', a)
    await manager.adoptPending('telegram:b', b)
    await manager.fetchMessages('telegram:a/c1')

    const native = await manager.forward('telegram:a/c1', 'm10', 'telegram:a/c2')
    expect(native.text).toBe('native forward')
    expect(a.forwarded).toEqual(['telegram:a/c1#m10->telegram:a/c2'])

    const copied = await manager.forward('telegram:a/c1', 'm10', 'telegram:b/c1')
    expect(copied.text).toBe('hello from telegram:a/c1')
    expect(b.sent).toEqual([{ to: 'telegram:b/c1', text: 'hello from telegram:a/c1' }])

    await expect(manager.forward('telegram:a/c1', 'nope', 'telegram:b/c1')).rejects.toThrow('not available')
  })

  it('merges cached and adapter search results without duplicates', async () => {
    const manager = new AccountManager(fakeStorage(), () => undefined, () => undefined)
    const a = new FakeAdapter('telegram:a', manager['contextFor']('telegram:a'))
    await manager.adoptPending('telegram:a', a)
    await manager.fetchMessages('telegram:a/c1')
    a.remote = [message('telegram:a/c1', 'm10', 'hello from telegram:a/c1'), message('telegram:a/c2', 'm99', 'hello remote')]
    const hits = await manager.search('hello')
    expect(hits.map((h) => `${h.conversation.id}#${h.message.id}`).sort()).toEqual(['telegram:a/c1#m10', 'telegram:a/c2#m99'])
    expect(await manager.search('h')).toEqual([])
  })

  it('routes auth prompts and QR codes through the bridge', async () => {
    const events: BridgeEvent[] = []
    const manager = new AccountManager(fakeStorage(), (e) => events.push(e), () => undefined)
    const ctx = manager['contextFor']('telegram:z')
    manager['adapters'].set('telegram:z', new FakeAdapter('telegram:z', ctx))

    const answer = ctx.requestAuth('code')
    const prompt = events.find((e): e is Extract<BridgeEvent, { type: 'auth:prompt' }> => e.type === 'auth:prompt')!
    expect(prompt.prompt.kind).toBe('code')
    manager.respondAuth(prompt.prompt.requestId, '12345')
    await expect(answer).resolves.toBe('12345')
    expect(events.at(-1)).toEqual({ type: 'auth:cleared', requestId: prompt.prompt.requestId })

    let cancelled = false
    const id = ctx.presentQr('data:image/png;base64,AAA', undefined, undefined, () => (cancelled = true))
    ctx.noteAuth(id, 'scanned')
    const notes = events.filter((e): e is Extract<BridgeEvent, { type: 'auth:prompt' }> => e.type === 'auth:prompt' && e.prompt.requestId === id)
    expect(notes.at(-1)?.prompt.note).toBe('scanned')
    expect(notes.at(-1)?.prompt.qrDataUrl).toBe('data:image/png;base64,AAA')
    manager.cancelAuth(id)
    expect(cancelled).toBe(true)

    const rejected = ctx.requestAuth('password')
    const last = events.filter((e): e is Extract<BridgeEvent, { type: 'auth:prompt' }> => e.type === 'auth:prompt').at(-1)!
    manager.cancelAuth(last.prompt.requestId)
    await expect(rejected).rejects.toThrow('cancelled')
  })
})

/** Fails its first `failures` connects the way real adapters do (status error, then throw). */
class FlakyAdapter extends FakeAdapter {
  calls = 0
  failMessage = 'offline'
  constructor(
    id: string,
    private readonly ectx: AdapterContext,
    private failures: number
  ) {
    super(id, ectx)
  }
  async connect(): Promise<void> {
    this.calls++
    if (this.failures > 0) {
      this.failures--
      this.account.status = 'error'
      this.account.error = this.failMessage
      this.ectx.emit({ type: 'account:updated', account: { ...this.account } })
      throw new Error(this.failMessage)
    }
    await super.connect()
  }
}

describe('AccountManager resilience', () => {
  const stored = (id: string): StoredAccount => ({ id, platform: 'telegram', displayName: id })
  const make = (ids: string[], failures: number | ((id: string) => number), isOnline?: () => boolean) => {
    const adapters = new Map<string, FlakyAdapter>()
    const manager = new AccountManager(
      fakeStorage(ids.map(stored)),
      () => undefined,
      () => undefined,
      (s, ctx) => {
        const adapter = new FlakyAdapter(s.id, ctx, typeof failures === 'number' ? failures : failures(s.id))
        adapters.set(s.id, adapter)
        return adapter
      },
      isOnline
    )
    return { manager, adapters }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // no jitter
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries a failed connect with growing back-off and stops once it connects', async () => {
    const { manager, adapters } = make(['telegram:1'], 3)
    await manager.restore()
    await vi.advanceTimersByTimeAsync(0)
    const a = adapters.get('telegram:1')!
    expect(a.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(a.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000) // 30 s
    expect(a.calls).toBe(2)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(a.calls).toBe(2)
    await vi.advanceTimersByTimeAsync(1_000) // then 1 min
    expect(a.calls).toBe(3)
    await vi.advanceTimersByTimeAsync(119_000)
    expect(a.calls).toBe(3)
    await vi.advanceTimersByTimeAsync(1_000) // then 2 min: connects
    expect(a.calls).toBe(4)
    expect(manager.listAccounts()[0].status).toBe('connected')
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(a.calls).toBe(4)
    await manager.shutdown()
  })

  it('stops retrying an account that is removed while it waits', async () => {
    const { manager, adapters } = make(['telegram:1'], 5)
    await manager.restore()
    await vi.advanceTimersByTimeAsync(0)
    await manager.remove('telegram:1')
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(adapters.get('telegram:1')!.calls).toBe(1)
    expect(manager['retries'].size).toBe(0)
    expect(manager['onlinePoll']).toBeUndefined()
  })

  it('runs one connect when reconnect is pressed twice at once', async () => {
    const { manager, adapters } = make(['telegram:1'], 0)
    await manager.restore()
    await vi.advanceTimersByTimeAsync(1_000)
    const a = adapters.get('telegram:1')!
    expect(a.calls).toBe(1)
    await Promise.all([manager.reconnect('telegram:1'), manager.reconnect('telegram:1')])
    expect(a.calls).toBe(2)
    await manager.shutdown()
  })

  it('keeps an account whose saved sign-in cannot be read, asking to sign in again', async () => {
    const storage = fakeStorage([{ ...stored('telegram:1'), secret: 'enc:garbage' }])
    storage.readSecret = (() => {
      throw new Error('decrypt failed')
    }) as Storage['readSecret']
    const manager = new AccountManager(storage, () => undefined, () => undefined)
    await manager.restore()
    await vi.advanceTimersByTimeAsync(0)
    const [account] = manager.listAccounts()
    expect(account).toMatchObject({ id: 'telegram:1', status: 'needs_auth', error: 'secrets-unreadable' })
    await vi.advanceTimersByTimeAsync(20 * 60_000) // signed-out accounts are not retried
    expect(manager['retries'].size).toBe(0)
    await manager.remove('telegram:1')
    expect(manager.listAccounts()).toEqual([])
    expect(storage.accounts).toEqual([])
  })

  it('also keeps it when decrypting quietly returns nothing', async () => {
    const storage = fakeStorage([{ ...stored('telegram:1'), secret: 'enc:garbage' }])
    const manager = new AccountManager(storage, () => undefined, () => undefined)
    await manager.restore()
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.listAccounts()[0]).toMatchObject({ status: 'needs_auth', error: 'secrets-unreadable' })
    expect(manager['retries'].size).toBe(0)
  })

  it('leaves an account without a saved secret out, as before', async () => {
    const manager = new AccountManager(fakeStorage([stored('telegram:1')]), () => undefined, () => undefined)
    await manager.restore()
    expect(manager.listAccounts()).toEqual([])
  })

  it('does not start a second loop beside an adapter that reconnects itself', async () => {
    const { manager, adapters } = make(['telegram:1'], 0)
    await manager.restore()
    await vi.advanceTimersByTimeAsync(1_000)
    const a = adapters.get('telegram:1')!
    ;(a as { selfReconnects?: true }).selfReconnects = true
    a.account.status = 'error'
    a.account.error = 'offline'
    manager['contextFor']('telegram:1').emit({ type: 'account:updated', account: { ...a.account } })
    expect(manager['retries'].size).toBe(0)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(a.calls).toBe(1)
    await manager.shutdown()
  })

  it('does not retry a rejected sign-in by itself, but retryErrored tries it once', async () => {
    const adapters: FlakyAdapter[] = []
    const manager = new AccountManager(
      fakeStorage([stored('telegram:1')]),
      () => undefined,
      () => undefined,
      (s, ctx) => {
        const a = new FlakyAdapter(s.id, ctx, 1)
        a.failMessage = 'Gmail did not accept this email and app password'
        adapters.push(a)
        return a
      }
    )
    await manager.restore()
    await vi.advanceTimersByTimeAsync(0)
    expect(manager['retries'].size).toBe(0)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(adapters[0].calls).toBe(1)
    manager.retryErrored()
    await vi.advanceTimersByTimeAsync(0)
    expect(adapters[0].calls).toBe(2)
    expect(manager.listAccounts()[0].status).toBe('connected')
    await manager.shutdown()
  })

  it('leaves nothing behind when the account is removed while it is still connecting', async () => {
    const events: BridgeEvent[] = []
    const storage = fakeStorage([stored('telegram:1')])
    const upserts: string[] = []
    const upsert = storage.upsertAccount.bind(storage)
    storage.upsertAccount = async (account, secret) => {
      upserts.push(account.id)
      await upsert(account, secret)
    }
    let release!: () => void
    let adapter!: FakeAdapter
    const manager = new AccountManager(
      storage,
      (e) => events.push(e),
      () => undefined,
      (s, ctx) => {
        adapter = new FakeAdapter(s.id, ctx)
        const connect = adapter.connect.bind(adapter)
        adapter.connect = () => new Promise<void>((r) => (release = r)).then(connect)
        return adapter
      }
    )
    await manager.restore()
    await vi.advanceTimersByTimeAsync(0)
    await manager.remove('telegram:1')
    release()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(upserts).toEqual([])
    expect(storage.accounts).toEqual([])
    expect(events.some((e) => e.type === 'conversations:reset')).toBe(false)
    expect(events.slice(events.findIndex((e) => e.type === 'account:removed')).some((e) => e.type === 'account:updated')).toBe(false)
    expect(manager['inflight'].size).toBe(0)
    expect(adapter.account.status).toBe('disconnected')
  })

  it('retryErrored connects every errored account at once, skipping connected ones', async () => {
    const { manager, adapters } = make(['telegram:1', 'telegram:2', 'telegram:3'], (id) => (id === 'telegram:3' ? 0 : 1))
    await manager.restore()
    await vi.advanceTimersByTimeAsync(0)
    manager.retryErrored()
    await vi.advanceTimersByTimeAsync(0)
    expect([...adapters.values()].map((a) => a.calls)).toEqual([2, 2, 1])
    expect(manager.listAccounts().map((a) => a.status)).toEqual(['connected', 'connected', 'connected'])
    expect(manager['retries'].size).toBe(0)
    expect(manager['onlinePoll']).toBeUndefined()
    await manager.shutdown()
  })

  it('retries at once when the network comes back', async () => {
    let online = false
    const { manager, adapters } = make(['telegram:1'], 2, () => online)
    await manager.restore()
    await vi.advanceTimersByTimeAsync(31_000)
    const a = adapters.get('telegram:1')!
    expect(a.calls).toBe(2) // next back-off is 1 min, due at 90 s
    online = true
    await vi.advanceTimersByTimeAsync(30_000) // the 60 s poll sees the network, well before that
    expect(a.calls).toBe(3)
    await manager.shutdown()
  })
})

describe('isTransientConnectError', () => {
  it('retries what looks like the network or a server being down', () => {
    const messages = [
      'Could not reach Gmail: Connection not available',
      'Could not reach Slack: ratelimited',
      'Could not reach Slack: fetch failed',
      'connect ECONNREFUSED 1.2.3.4:993',
      'ETIMEDOUT',
      'getaddrinfo ENOTFOUND imap.gmail.com',
      'WhatsApp connection closed (503)',
      'WhatsApp connection closed (408)',
      'Request failed with status code 502',
      'socket hang up',
      'request timed out'
    ]
    for (const message of messages) expect(isTransientConnectError(new Error(message), true), message).toBe(true)
    expect(isTransientConnectError(Object.assign(new Error('Could not connect'), { code: 'ECONNRESET' }), true)).toBe(true)
    expect(isTransientConnectError(new Error('failed', { cause: new Error('read ETIMEDOUT') }), true)).toBe(true)
  })

  it('does not retry rejected credentials or a sign-in that needs the user', () => {
    const messages = [
      'Gmail did not accept this email and app password',
      'Slack did not accept this token',
      'Sign-in was declined on the phone',
      'Sign-in cancelled',
      'WhatsApp session was logged out',
      'Could not reach Slack: token_revoked',
      'Could not reach Slack: account_inactive',
      'WhatsApp connection closed (401)',
      'Gmail account 500123 rejected the login',
      'invalid password'
    ]
    for (const message of messages) expect(isTransientConnectError(new Error(message), true), message).toBe(false)
  })

  it('retries anything that failed while offline, except what needs the user', () => {
    expect(isTransientConnectError(new Error('Slack did not accept this token'), false)).toBe(true)
    expect(isTransientConnectError('Gmail did not accept this email and app password', false)).toBe(true)
    expect(isTransientConnectError(new Error('Sign-in cancelled'), false)).toBe(false)
  })
})
