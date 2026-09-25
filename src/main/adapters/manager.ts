import { randomUUID } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import type {
  Account,
  AddAccountInput,
  AuthPromptKind,
  BridgeEvent,
  Conversation,
  Message,
  Platform,
  SearchHit,
  SendOptions
} from '@shared/types'
import type { Storage, StoredAccount } from '../storage'
import type { AdapterContext, PlatformAdapter } from './types'
import { previewOf } from './types'
import { DemoAdapter } from './demo'
import { TelegramAdapter, type TelegramSecret } from './telegram'
import { MetaAdapter, type MetaSecret } from './meta'
import { ZaloAdapter, type ZaloSecret } from './zalo'
import { WhatsAppAdapter, type WhatsAppSecret } from './whatsapp'

interface PendingAuth {
  resolve(value: string): void
  reject(reason: Error): void
  /** Last QR payload so the note can be updated without a new code. */
  qrDataUrl?: string
}

const SEARCH_LIMIT = 60

/**
 * Owns every adapter, keeps a unified conversation cache and fans adapter
 * events out to the renderer.
 */
export class AccountManager {
  private adapters = new Map<string, PlatformAdapter>()
  private conversations = new Map<string, Conversation>()
  private messages = new Map<string, Map<string, Message>>()
  private pendingAuth = new Map<string, PendingAuth>()

  constructor(
    private readonly storage: Storage,
    private readonly emit: (event: BridgeEvent) => void,
    private readonly log: (...args: unknown[]) => void
  ) {}

  /** Restore persisted accounts and connect them in the background. */
  async restore(): Promise<void> {
    for (const stored of this.storage.accounts) {
      const adapter = this.createAdapter(stored)
      if (!adapter) continue
      this.adapters.set(stored.id, adapter)
      void this.connect(adapter)
    }
  }

  listAccounts(): Account[] {
    return [...this.adapters.values()].map((a) => ({ ...a.account }))
  }

  listConversations(): Conversation[] {
    return [...this.conversations.values()]
  }

  async addDemo(): Promise<Account[]> {
    const platforms: Platform[] = ['messenger', 'instagram', 'telegram', 'zalo', 'whatsapp']
    const accounts: Account[] = []
    for (const platform of platforms) {
      const id = `demo-${platform}`
      if (this.adapters.has(id)) continue
      const adapter = new DemoAdapter(platform, this.contextFor(id))
      this.adapters.set(id, adapter)
      await this.storage.upsertAccount(adapter.account)
      accounts.push(adapter.account)
      void this.connect(adapter)
    }
    return accounts
  }

  async add(input: AddAccountInput): Promise<Account> {
    if (input.platform === 'messenger' || input.platform === 'instagram') {
      const secret: MetaSecret = { pageId: input.pageId.trim(), accessToken: input.accessToken.trim() }
      const id = `${input.platform}:${secret.pageId}`
      const existing = this.adapters.get(id)
      if (existing) await existing.disconnect().catch(() => undefined)
      const adapter = new MetaAdapter(input.platform, secret, this.contextFor(id))
      this.adapters.set(id, adapter)
      try {
        await adapter.connect()
      } catch (err) {
        this.adapters.delete(id)
        this.emit({ type: 'account:removed', accountId: id })
        throw err
      }
      await this.storage.upsertAccount(adapter.account, secret)
      await this.loadConversations(adapter)
      return adapter.account
    }

    // Platforms that only learn their account id after an interactive sign-in.
    const tempId = `${input.platform}:pending-${randomUUID().slice(0, 8)}`
    let adapter: PlatformAdapter
    const ctx = this.contextFor(tempId, () => adapter.account.id)
    if (input.platform === 'telegram') {
      adapter = new TelegramAdapter(tempId, { apiId: input.apiId, apiHash: input.apiHash }, ctx)
    } else if (input.platform === 'zalo') {
      adapter = new ZaloAdapter(tempId, {}, ctx)
    } else {
      adapter = new WhatsAppAdapter(tempId, { authDir: `wa-${randomUUID().slice(0, 8)}` }, ctx)
    }
    this.adapters.set(tempId, adapter)
    this.emit({ type: 'account:updated', account: { ...adapter.account } })
    try {
      await adapter.connect()
    } catch (err) {
      this.adapters.delete(tempId)
      this.emit({ type: 'account:removed', accountId: tempId })
      throw err
    }
    this.adapters.delete(tempId)
    this.emit({ type: 'account:removed', accountId: tempId })
    const existing = this.adapters.get(adapter.account.id)
    if (existing && existing !== adapter) await existing.disconnect().catch(() => undefined)
    this.adapters.set(adapter.account.id, adapter)
    await this.storage.upsertAccount(adapter.account)
    this.emit({ type: 'account:updated', account: { ...adapter.account } })
    await this.loadConversations(adapter)
    return adapter.account
  }

  async remove(accountId: string): Promise<void> {
    const adapter = this.adapters.get(accountId)
    if (adapter) {
      await adapter.disconnect().catch(() => undefined)
      this.adapters.delete(accountId)
    }
    for (const [id, conversation] of this.conversations) {
      if (conversation.accountId === accountId) {
        this.conversations.delete(id)
        this.messages.delete(id)
      }
    }
    await this.storage.removeAccount(accountId)
    this.emit({ type: 'account:removed', accountId })
  }

  async reconnect(accountId: string): Promise<void> {
    const adapter = this.adapters.get(accountId)
    if (!adapter) throw new Error('Unknown account')
    await adapter.disconnect().catch(() => undefined)
    await this.connect(adapter)
  }

  async fetchMessages(conversationId: string, beforeId?: string): Promise<Message[]> {
    const adapter = this.adapterFor(conversationId)
    const messages = await adapter.fetchMessages(conversationId, { limit: 50, beforeId })
    this.cache(messages)
    return messages
  }

  async sendMessage(conversationId: string, text: string, options: SendOptions = {}): Promise<Message> {
    const adapter = this.adapterFor(conversationId)
    const message = await adapter.sendMessage(conversationId, text, options)
    this.cache([message])
    const conversation = this.conversations.get(conversationId)
    if (conversation) {
      conversation.lastMessage = previewOf(message)
      conversation.updatedAt = message.sentAt
      this.emit({ type: 'conversation:upserted', conversation: { ...conversation } })
    }
    return message
  }

  async react(conversationId: string, messageId: string, emoji: string): Promise<void> {
    const adapter = this.adapterFor(conversationId)
    if (!adapter.react) throw new Error('This platform does not support reactions')
    await adapter.react(conversationId, messageId, emoji)
  }

  search(query: string): SearchHit[] {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    const hits: SearchHit[] = []
    for (const [conversationId, messages] of this.messages) {
      const conversation = this.conversations.get(conversationId)
      if (!conversation) continue
      for (const message of messages.values()) {
        if (message.text.toLowerCase().includes(needle) || message.attachments.some((a) => a.name?.toLowerCase().includes(needle))) {
          hits.push({ message, conversation })
        }
      }
    }
    return hits.sort((a, b) => b.message.sentAt - a.message.sentAt).slice(0, SEARCH_LIMIT)
  }

  async markRead(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (conversation && conversation.unreadCount) {
      conversation.unreadCount = 0
      this.emit({ type: 'conversation:upserted', conversation: { ...conversation } })
    }
    await this.adapterFor(conversationId).markRead(conversationId)
  }

  async setTyping(conversationId: string): Promise<void> {
    await this.adapterFor(conversationId).setTyping?.(conversationId)
  }

  respondAuth(requestId: string, value: string): void {
    const pending = this.pendingAuth.get(requestId)
    if (!pending) return
    this.pendingAuth.delete(requestId)
    this.emit({ type: 'auth:cleared', requestId })
    pending.resolve(value)
  }

  cancelAuth(requestId: string): void {
    const pending = this.pendingAuth.get(requestId)
    if (!pending) return
    this.pendingAuth.delete(requestId)
    this.emit({ type: 'auth:cleared', requestId })
    pending.reject(new Error('Sign-in cancelled'))
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((a) => a.disconnect().catch(() => undefined)))
  }

  // ---- internals --------------------------------------------------------

  private createAdapter(stored: StoredAccount): PlatformAdapter | undefined {
    if (stored.demo) return new DemoAdapter(stored.platform, this.contextFor(stored.id))
    const ctx = this.contextFor(stored.id)
    let adapter: PlatformAdapter | undefined
    if (stored.platform === 'telegram') {
      const secret = this.storage.readSecret<TelegramSecret>(stored.id)
      if (secret) adapter = new TelegramAdapter(stored.id, secret, ctx)
    } else if (stored.platform === 'zalo') {
      const secret = this.storage.readSecret<ZaloSecret>(stored.id)
      if (secret) adapter = new ZaloAdapter(stored.id, secret, ctx)
    } else if (stored.platform === 'whatsapp') {
      const secret = this.storage.readSecret<WhatsAppSecret>(stored.id)
      if (secret) adapter = new WhatsAppAdapter(stored.id, secret, ctx)
    } else {
      const secret = this.storage.readSecret<MetaSecret>(stored.id)
      if (secret) adapter = new MetaAdapter(stored.platform, secret, ctx)
    }
    if (!adapter) return undefined
    adapter.account.displayName = stored.displayName
    adapter.account.handle = stored.handle
    adapter.account.avatarUrl = stored.avatarUrl
    return adapter
  }

  private async connect(adapter: PlatformAdapter): Promise<void> {
    try {
      await adapter.connect()
      await this.storage.upsertAccount(adapter.account)
      await this.loadConversations(adapter)
    } catch (err) {
      this.log(`connect failed for ${adapter.account.id}:`, (err as Error).message)
    }
  }

  private async loadConversations(adapter: PlatformAdapter): Promise<void> {
    try {
      const list = await adapter.listConversations()
      for (const conversation of list) this.conversations.set(conversation.id, conversation)
      this.emit({ type: 'conversations:reset', accountId: adapter.account.id, conversations: list })
      void this.warmCache(adapter, list)
    } catch (err) {
      this.log(`listConversations failed for ${adapter.account.id}:`, (err as Error).message)
    }
  }

  /**
   * Pull recent history for the most active threads in the background so
   * message search works before the user opens them. Sequential and paced to
   * stay friendly with platform rate limits.
   */
  private async warmCache(adapter: PlatformAdapter, conversations: Conversation[]): Promise<void> {
    const limit = adapter.account.platform === 'messenger' || adapter.account.platform === 'instagram' ? 15 : 40
    const targets = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
    for (const conversation of targets) {
      if (!this.adapters.has(adapter.account.id) || this.messages.has(conversation.id)) continue
      try {
        this.cache(await adapter.fetchMessages(conversation.id, { limit: 30 }))
      } catch {
        /* offline or unsupported; search just won't cover this thread */
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  private cache(messages: Message[]): void {
    for (const message of messages) {
      let bucket = this.messages.get(message.conversationId)
      if (!bucket) {
        bucket = new Map()
        this.messages.set(message.conversationId, bucket)
      }
      bucket.set(message.id, message)
      if (bucket.size > 500) {
        const oldest = [...bucket.values()].sort((a, b) => a.sentAt - b.sentAt).slice(0, bucket.size - 500)
        for (const m of oldest) bucket.delete(m.id)
      }
    }
  }

  private adapterFor(conversationId: string): PlatformAdapter {
    const accountId = conversationId.slice(0, conversationId.indexOf('/'))
    const adapter = this.adapters.get(accountId)
    if (!adapter) throw new Error(`No adapter for ${accountId}`)
    return adapter
  }

  private contextFor(accountId: string, currentId: () => string = () => accountId): AdapterContext {
    const adapterOf = (): PlatformAdapter | undefined =>
      this.adapters.get(currentId()) ?? [...this.adapters.values()].find((a) => a.account.id === currentId())
    return {
      emit: (event) => {
        if (event.type === 'conversation:upserted') {
          this.conversations.set(event.conversation.id, event.conversation)
        } else if (event.type === 'conversations:reset') {
          for (const [id, c] of this.conversations) if (c.accountId === event.accountId) this.conversations.delete(id)
          for (const c of event.conversations) this.conversations.set(c.id, c)
        } else if (event.type === 'message:updated') {
          this.cache([event.message])
        } else if (event.type === 'message:new') {
          this.cache([event.message])
          const conversation = this.conversations.get(event.message.conversationId)
          if (conversation) {
            conversation.lastMessage = previewOf(event.message)
            conversation.updatedAt = Math.max(conversation.updatedAt, event.message.sentAt)
            if (!event.message.isOutgoing) conversation.unreadCount += 1
            this.emit(event)
            this.emit({ type: 'conversation:upserted', conversation: { ...conversation } })
            return
          }
        }
        this.emit(event)
      },
      requestAuth: (kind: AuthPromptKind, message?: string) =>
        new Promise<string>((resolve, reject) => {
          const requestId = randomUUID()
          this.pendingAuth.set(requestId, { resolve, reject })
          this.emit({
            type: 'auth:prompt',
            prompt: { requestId, accountId: currentId(), platform: adapterOf()?.account.platform ?? 'telegram', kind, message }
          })
        }),
      presentQr: (dataUrl, note, requestId, onCancel) => {
        const id = requestId ?? randomUUID()
        const existing = this.pendingAuth.get(id)
        this.pendingAuth.set(id, {
          resolve: () => undefined,
          reject: existing?.reject ?? (() => onCancel?.()),
          qrDataUrl: dataUrl
        })
        this.emit({
          type: 'auth:prompt',
          prompt: { requestId: id, accountId: currentId(), platform: adapterOf()?.account.platform ?? 'whatsapp', kind: 'qr', qrDataUrl: dataUrl, note }
        })
        return id
      },
      noteAuth: (requestId, note) => {
        const pending = this.pendingAuth.get(requestId)
        if (!pending) return
        this.emit({
          type: 'auth:prompt',
          prompt: { requestId, accountId: currentId(), platform: adapterOf()?.account.platform ?? 'whatsapp', kind: 'qr', qrDataUrl: pending.qrDataUrl, note }
        })
      },
      dismissAuth: (requestId) => {
        if (!this.pendingAuth.delete(requestId)) return
        this.emit({ type: 'auth:cleared', requestId })
      },
      saveSecret: async (secret) => {
        const adapter = adapterOf()
        if (adapter) await this.storage.upsertAccount(adapter.account, secret)
      },
      dataDir: () => {
        const dir = join(app.getPath('userData'), 'adapters', adapterOf()?.account.platform ?? 'misc')
        mkdirSync(dir, { recursive: true })
        return dir
      },
      log: (...args) => this.log(`[${currentId()}]`, ...args)
    }
  }
}
