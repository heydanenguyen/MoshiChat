import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))

import type { Account, BridgeEvent, Conversation, Message } from '../src/shared/types'
import { ALL_FEATURES } from '../src/shared/types'
import { AccountManager } from '../src/main/adapters/manager'
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
