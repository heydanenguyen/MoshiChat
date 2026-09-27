import { SendLimiter } from '../rate-limit'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import type {
  Account,
  AddAccountInput,
  AuthPromptKind,
  BridgeEvent,
  Contact,
  Conversation,
  PageOption,
  ConversationStats,
  Message,
  PeerProfile,
  Platform,
  SearchHit,
  SendOptions,
  SharedKind
} from '@shared/types'
import type { Storage, StoredAccount } from '../storage'
import type { AdapterContext, PlatformAdapter } from './types'
import type { Peer } from '@shared/types'
import { isShared, matchesQuery, previewOf, statsOf } from './types'
import { DemoAdapter } from './demo'
import { TelegramAdapter, type TelegramSecret } from './telegram'
import { MetaAdapter, type MetaSecret } from './meta'
import { ZaloAdapter, type ZaloSecret } from './zalo'
import { WhatsAppAdapter, type WhatsAppSecret } from './whatsapp'
import { FacebookPersonalAdapter, type FacebookPersonalSecret, type WebCookie } from './facebook-personal'
import { InstagramPersonalAdapter, type InstagramPersonalSecret } from './instagram-personal'

interface PendingAuth {
  resolve(value: string): void
  reject(reason: Error): void
  /** Last QR payload so the note can be updated without a new code. */
  qrDataUrl?: string
}

const SEARCH_LIMIT = 60
const SEARCH_TIMEOUT = 4000

/** Injectable factory so tests can plug in fake adapters. */
export type AdapterFactory = (stored: StoredAccount, ctx: AdapterContext, storage: Storage) => PlatformAdapter | undefined

/**
 * Owns every adapter, keeps a unified conversation cache and fans adapter
 * events out to the renderer.
 */
export class AccountManager {
  private adapters = new Map<string, PlatformAdapter>()
  private conversations = new Map<string, Conversation>()
  private messages = new Map<string, Map<string, Message>>()
  /** Keeps every account sending at a human pace (see rate-limit.ts). */
  private limiter = new SendLimiter()
  private pendingAuth = new Map<string, PendingAuth>()
  private contactCache = new Map<string, { at: number; list: Contact[] }>()

  constructor(
    private readonly storage: Storage,
    private readonly emit: (event: BridgeEvent) => void,
    private readonly log: (...args: unknown[]) => void,
    private readonly factory: AdapterFactory = defaultFactory
  ) {}

  /** Restore persisted accounts and connect them in the background. */
  async restore(): Promise<void> {
    for (const stored of this.storage.accounts) {
      const adapter = this.factory(stored, this.contextFor(stored.id), this.storage)
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
    return this.adoptPending(tempId, adapter)
  }

  /** Personal Facebook / Instagram from cookies captured in the in-app login window. */
  async addWebSession(platform: 'messenger' | 'instagram', cookies: WebCookie[]): Promise<Account> {
    const tempId = `${platform}:pending-${randomUUID().slice(0, 8)}`
    let adapter: PlatformAdapter
    const ctx = this.contextFor(tempId, () => adapter.account.id)
    adapter = platform === 'messenger' ? new FacebookPersonalAdapter(tempId, { cookies }, ctx) : new InstagramPersonalAdapter(tempId, { cookies }, ctx)
    const account = await this.adoptPending(tempId, adapter)
    await this.storage.upsertAccount(account, { cookies })
    return account
  }

  /** Fresh cookies for an existing personal Facebook/Instagram account, then reconnect. */
  /** The cookies stored for a web-session account (the ones that stopped working). */
  storedCookies(accountId: string): WebCookie[] {
    return this.storage.readSecret<{ cookies?: WebCookie[] }>(accountId)?.cookies ?? []
  }

  async reauthWebSession(accountId: string, cookies: WebCookie[]): Promise<Account> {
    const adapter = this.adapters.get(accountId) as (PlatformAdapter & { replaceCookies?(c: WebCookie[]): void }) | undefined
    if (!adapter?.replaceCookies) throw new Error('This account does not use a web session')
    await adapter.disconnect().catch(() => undefined)
    adapter.replaceCookies(cookies)
    await adapter.connect()
    await this.storage.upsertAccount(adapter.account, { cookies })
    await this.loadConversations(adapter)
    return { ...adapter.account }
  }

  /** Pages picked in the OAuth flow become Messenger (and optionally Instagram) accounts. */
  async addPages(pages: PageOption[], includeInstagram: boolean): Promise<Account[]> {
    const accounts: Account[] = []
    for (const page of pages) {
      accounts.push(await this.add({ platform: 'messenger', pageId: page.id, accessToken: page.accessToken }))
      if (includeInstagram && page.instagram) {
        try {
          accounts.push(await this.add({ platform: 'instagram', pageId: page.id, accessToken: page.accessToken }))
        } catch (err) {
          this.log(`instagram for page ${page.id} skipped:`, (err as Error).message)
        }
      }
    }
    return accounts
  }

  /** Contacts across every connected adapter, cached for a couple of minutes. */
  async contacts(query: string): Promise<Contact[]> {
    const needle = query.trim().toLowerCase()
    const all: Contact[] = []
    await Promise.all(
      [...this.adapters.values()]
        .filter((a) => a.account.status === 'connected')
        .map(async (adapter) => {
          const cached = this.contactCache.get(adapter.account.id)
          let list = cached && Date.now() - cached.at < 120_000 ? cached.list : undefined
          if (!list) {
            const peers = adapter.listContacts ? await adapter.listContacts().catch(() => [] as Peer[]) : []
            const seen = new Set<string>()
            list = []
            for (const peer of peers) {
              if (seen.has(peer.id)) continue
              seen.add(peer.id)
              list.push({ ...peer, accountId: adapter.account.id, platform: adapter.account.platform })
            }
            // Recent 1:1 conversations count as contacts too.
            for (const c of this.conversations.values()) {
              if (c.accountId !== adapter.account.id || c.isGroup) continue
              const other = c.participants.find((p) => !p.isMe)
              if (!other || seen.has(other.id)) continue
              seen.add(other.id)
              list.push({ id: other.id, name: c.title, handle: other.handle, avatarUrl: c.avatarUrl ?? other.avatarUrl, accountId: adapter.account.id, platform: adapter.account.platform })
            }
            this.contactCache.set(adapter.account.id, { at: Date.now(), list })
          }
          all.push(...list)
        })
    )
    const filtered = needle ? all.filter((c) => c.name.toLowerCase().includes(needle) || c.handle?.toLowerCase().includes(needle)) : all
    return filtered.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80)
  }

  async openConversation(accountId: string, peerId: string): Promise<Conversation> {
    const adapter = this.adapters.get(accountId)
    if (!adapter) throw new Error('Unknown account')
    for (const c of this.conversations.values()) {
      if (c.accountId === accountId && !c.isGroup && c.participants.some((p) => !p.isMe && p.id === peerId)) return c
    }
    if (!adapter.openConversation) throw new Error('This platform cannot start new conversations from Unison')
    const conversation = await adapter.openConversation(peerId)
    const existing = this.conversations.get(conversation.id)
    if (existing) return existing
    this.conversations.set(conversation.id, conversation)
    this.emit({ type: 'conversation:upserted', conversation })
    return conversation
  }

  /** Register an adapter whose id becomes known only after connect(). */
  async adoptPending(tempId: string, adapter: PlatformAdapter): Promise<Account> {
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
    if (adapter.account.status === 'needs_auth') throw new Error('This account needs you to sign in again before sending')
    if (adapter.account.status === 'connecting') throw new Error('Still connecting, try again in a moment')
    if (!adapter.account.demo) this.limiter.take(adapter.account.id)
    const message = await adapter.sendMessage(conversationId, text, options)
    this.trackSent(message)
    return message
  }

  /**
   * Forward a message. Same-account forwards use the platform's native
   * forward when available; anything else re-sends the text, which is the
   * only part that survives a platform hop.
   */
  async forward(fromConversationId: string, messageId: string, toConversationId: string): Promise<Message> {
    const from = this.adapterFor(fromConversationId)
    const to = this.adapterFor(toConversationId)
    if (from === to && from.forward) {
      if (!from.account.demo) this.limiter.takeForward(from.account.id, messageId, toConversationId)
      const message = await from.forward(fromConversationId, messageId, toConversationId)
      this.trackSent(message)
      return message
    }
    const source = this.messages.get(fromConversationId)?.get(messageId)
    if (!source) throw new Error('Message is not available to forward')
    if (!source.text.trim()) throw new Error('Only text can be forwarded to another account')
    return this.sendMessage(toConversationId, source.text)
  }

  async react(conversationId: string, messageId: string, emoji: string): Promise<void> {
    const adapter = this.adapterFor(conversationId)
    if (!adapter.react) throw new Error('This platform does not support reactions')
    await adapter.react(conversationId, messageId, emoji)
  }

  /** Local cache first, then every adapter's own search, merged and de-duplicated. */
  async search(query: string): Promise<SearchHit[]> {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    const seen = new Set<string>()
    const hits: SearchHit[] = []
    const add = (message: Message): void => {
      const key = `${message.conversationId}#${message.id}`
      const conversation = this.conversations.get(message.conversationId)
      if (!conversation || seen.has(key)) return
      seen.add(key)
      hits.push({ message, conversation })
    }
    for (const bucket of this.messages.values()) {
      for (const message of bucket.values()) if (matchesQuery(message, needle)) add(message)
    }
    const remote = [...this.adapters.values()]
      .filter((a) => a.searchMessages && a.account.status === 'connected')
      .map((a) =>
        Promise.race([
          a.searchMessages!(query.trim(), SEARCH_LIMIT),
          new Promise<Message[]>((resolve) => setTimeout(() => resolve([]), SEARCH_TIMEOUT))
        ]).catch((err: Error) => {
          this.log(`search failed for ${a.account.id}:`, err.message)
          return [] as Message[]
        })
      )
    for (const messages of await Promise.all(remote)) {
      this.cache(messages)
      for (const message of messages) add(message)
    }
    return hits.sort((a, b) => b.message.sentAt - a.message.sentAt).slice(0, SEARCH_LIMIT)
  }

  async loadAttachment(conversationId: string, messageId: string, attachmentId: string): Promise<string | undefined> {
    const adapter = this.adapterFor(conversationId)
    if (!adapter.downloadAttachment) return undefined
    const url = await adapter.downloadAttachment(conversationId, messageId, attachmentId)
    const cached = this.messages.get(conversationId)?.get(messageId)
    const attachment = cached?.attachments.find((a) => a.id === attachmentId)
    if (url && attachment) attachment.url = url
    return url
  }

  async profile(conversationId: string): Promise<PeerProfile | undefined> {
    const adapter = this.adapterFor(conversationId)
    const conversation = this.conversations.get(conversationId)
    let profile: PeerProfile | undefined
    try {
      profile = await adapter.getPeerProfile?.(conversationId)
    } catch (err) {
      this.log(`profile failed for ${conversationId}:`, (err as Error).message)
    }
    if (profile) return profile
    if (!conversation) return undefined
    const peer = conversation.participants.find((p) => !p.isMe)
    return {
      id: peer?.id ?? conversationId,
      name: conversation.title,
      handle: peer?.handle,
      avatarUrl: conversation.avatarUrl ?? peer?.avatarUrl
    }
  }

  /** Shared content: the adapter's own listing when it has one, otherwise whatever is cached. */
  async shared(conversationId: string, kind: SharedKind): Promise<Message[]> {
    const adapter = this.adapterFor(conversationId)
    if (adapter.listShared) {
      try {
        const messages = await adapter.listShared(conversationId, kind, 60)
        this.cache(messages)
        return messages.sort((a, b) => b.sentAt - a.sentAt)
      } catch (err) {
        this.log(`listShared failed for ${conversationId}:`, (err as Error).message)
      }
    }
    if (!this.messages.has(conversationId)) await this.fetchMessages(conversationId).catch(() => undefined)
    return [...(this.messages.get(conversationId)?.values() ?? [])].filter((m) => isShared(m, kind)).sort((a, b) => b.sentAt - a.sentAt)
  }

  async searchIn(conversationId: string, query: string): Promise<Message[]> {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    const adapter = this.adapterFor(conversationId)
    const seen = new Set<string>()
    const hits: Message[] = []
    const add = (m: Message): void => {
      if (m.conversationId !== conversationId || seen.has(m.id)) return
      seen.add(m.id)
      hits.push(m)
    }
    for (const m of this.messages.get(conversationId)?.values() ?? []) if (matchesQuery(m, needle)) add(m)
    try {
      if (adapter.searchInConversation) {
        const remote = await adapter.searchInConversation(conversationId, query.trim(), SEARCH_LIMIT)
        this.cache(remote)
        remote.forEach(add)
      } else if (adapter.searchMessages) {
        ;(await adapter.searchMessages(query.trim(), SEARCH_LIMIT)).forEach(add)
      }
    } catch (err) {
      this.log(`searchIn failed for ${conversationId}:`, (err as Error).message)
    }
    return hits.sort((a, b) => b.sentAt - a.sentAt).slice(0, SEARCH_LIMIT)
  }

  async stats(conversationId: string): Promise<ConversationStats> {
    const adapter = this.adapterFor(conversationId)
    const local = statsOf([...(this.messages.get(conversationId)?.values() ?? [])])
    if (!adapter.getConversationStats) return local
    try {
      const remote = await adapter.getConversationStats(conversationId)
      const first = [remote.firstMessageAt, local.firstMessageAt].filter((v): v is number => typeof v === 'number')
      return {
        firstMessageAt: first.length ? Math.min(...first) : undefined,
        lastMessageAt: Math.max(remote.lastMessageAt ?? 0, local.lastMessageAt ?? 0) || undefined,
        messageCount: remote.messageCount ?? local.messageCount,
        approximate: remote.approximate ?? false,
        pending: remote.pending ?? false
      }
    } catch (err) {
      this.log(`stats failed for ${conversationId}:`, (err as Error).message)
      return local
    }
  }

  cachedAttachment(conversationId: string, messageId: string, attachmentId: string): { message: Message; attachment: Message['attachments'][number] } | undefined {
    const message = this.messages.get(conversationId)?.get(messageId)
    const attachment = message?.attachments.find((a) => a.id === attachmentId)
    return message && attachment ? { message, attachment } : undefined
  }

  async markRead(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (conversation && conversation.unreadCount) {
      conversation.unreadCount = 0
      this.emit({ type: 'conversation:upserted', conversation: { ...conversation } })
    }
    // Private reading: clear the badge in Unison only, the platform is not told.
    if (this.storage.settings.sendReadReceipts === false) return
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

  private trackSent(message: Message): void {
    this.cache([message])
    const conversation = this.conversations.get(message.conversationId)
    if (conversation) {
      conversation.lastMessage = previewOf(message)
      conversation.updatedAt = message.sentAt
      this.emit({ type: 'conversation:upserted', conversation: { ...conversation } })
    }
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
        } else if (event.type === 'message:reactions') {
          const cached = this.messages.get(event.conversationId)?.get(event.messageId)
          if (cached) cached.reactions = event.reactions
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

function defaultFactory(stored: StoredAccount, ctx: AdapterContext, storage: Storage): PlatformAdapter | undefined {
  if (stored.demo) return new DemoAdapter(stored.platform, ctx)
  let adapter: PlatformAdapter | undefined
  if (stored.platform === 'telegram') {
    const secret = storage.readSecret<TelegramSecret>(stored.id)
    if (secret) adapter = new TelegramAdapter(stored.id, secret, ctx)
  } else if (stored.platform === 'zalo') {
    const secret = storage.readSecret<ZaloSecret>(stored.id)
    if (secret) adapter = new ZaloAdapter(stored.id, secret, ctx)
  } else if (stored.platform === 'whatsapp') {
    const secret = storage.readSecret<WhatsAppSecret>(stored.id)
    if (secret) adapter = new WhatsAppAdapter(stored.id, secret, ctx)
  } else if (stored.id.startsWith('messenger:fb-')) {
    const secret = storage.readSecret<FacebookPersonalSecret>(stored.id)
    if (secret) adapter = new FacebookPersonalAdapter(stored.id, secret, ctx)
  } else if (stored.id.startsWith('instagram:ig-')) {
    const secret = storage.readSecret<InstagramPersonalSecret>(stored.id)
    if (secret) adapter = new InstagramPersonalAdapter(stored.id, secret, ctx)
  } else {
    const secret = storage.readSecret<MetaSecret>(stored.id)
    if (secret) adapter = new MetaAdapter(stored.platform, secret, ctx)
  }
  if (!adapter) return undefined
  adapter.account.displayName = stored.displayName
  adapter.account.handle = stored.handle
  adapter.account.avatarUrl = stored.avatarUrl
  return adapter
}
