import { createReadStream } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { browserUserAgent } from '../user-agent'
import { mapFcaAttachment, mapFcaEvent, type FcaAttachment } from './facebook-items'
import type { Account, Attachment, Conversation, Message, Peer, PeerProfile, SendOptions } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf, matchesQuery, previewOf, statsOf } from './types'

/** Cookies captured from the in-app facebook.com login window. */
export interface WebCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expirationDate?: number
}

export interface FacebookPersonalSecret {
  cookies: WebCookie[]
}

type FcaModule = typeof import('ws3-fca')
type FcaApi = import('ws3-fca').API
type FcaThread = import('ws3-fca').ThreadInfo
type FcaMessage = import('ws3-fca').Message

interface FcaUser {
  id?: string
  name?: string
  firstName?: string
  thumbSrc?: string
  profilePicUrl?: string
  vanity?: string
}

interface FcaEvent {
  type: string
  threadID?: string
  messageID?: string
  senderID?: string
  userID?: string
  from?: string
  reaction?: string
  isTyping?: boolean
  body?: string
  timestamp?: string
  time?: string | number
  reader?: string
}

const HISTORY_LIMIT = 300

/**
 * Personal Facebook account over the Messenger web protocol (ws3-fca). The
 * user signs in on facebook.com inside an app window; we only keep the
 * resulting session cookies, never the password.
 */
export class FacebookPersonalAdapter implements PlatformAdapter {
  readonly account: Account
  private api?: FcaApi
  private meId = ''
  private threads = new Map<string, FcaThread>()
  private users = new Map<string, FcaUser>()
  private history = new Map<string, Message[]>()
  private stopListening?: () => void

  constructor(
    initialId: string,
    private secret: FacebookPersonalSecret,
    private readonly ctx: AdapterContext
  ) {
    this.account = { id: initialId, platform: 'messenger', displayName: 'Facebook', status: 'disconnected', features: { reply: true, react: true, attachments: true } }
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    pinUserAgent()
    const mod = (await import('ws3-fca')) as unknown as FcaModule & { default?: FcaModule['login'] }
    const login = (mod.login ?? mod.default) as FcaModule['login']
    const appState = this.secret.cookies.map((c) => ({ key: c.name, name: c.name, value: c.value, domain: c.domain ?? '.facebook.com', path: c.path ?? '/' }))
    const api = await new Promise<FcaApi>((resolve, reject) => {
      login({ appState } as never, { listenEvents: true, selfListen: true, updatePresence: false, autoReconnect: true, online: false, userAgent: browserUserAgent(), randomUserAgent: false } as never, (err, result) => {
        if (err || !result) reject(new Error(typeof err === 'string' ? err : (err?.error ?? err?.message ?? 'Facebook login failed')))
        else resolve(result)
      })
    }).catch((err: Error) => {
      // ws3-fca reports a dead or rejected session as "Error retrieving userID".
      if (/retrieving userID|login|checkpoint/i.test(err.message)) {
        this.setStatus('needs_auth', 'logged_out')
        throw new Error('Facebook did not accept this session. Sign in again to keep messaging.')
      }
      this.setStatus('error', err.message)
      throw err
    })
    this.api = api
    this.meId = api.getCurrentUserID()
    this.account.id = `messenger:fb-${this.meId}`
    try {
      const me = (await api.getUserInfo(this.meId)) as unknown as FcaUser
      this.account.displayName = me?.name ?? 'Facebook'
      this.account.avatarUrl = me?.thumbSrc ?? me?.profilePicUrl
      this.account.handle = me?.vanity ? `fb.com/${me.vanity}` : undefined
    } catch (err) {
      this.ctx.log('facebook profile failed', (err as Error).message)
    }
    await this.ctx.saveSecret(this.secret)
    this.listen(api)
    this.setStatus('connected')
  }

  /** New cookies from a fresh sign-in; takes effect on the next connect(). */
  replaceCookies(cookies: WebCookie[]): void {
    this.secret = { cookies }
  }

  async disconnect(): Promise<void> {
    this.stopListening?.()
    this.stopListening = undefined
    this.api = undefined
    this.setStatus('disconnected')
  }

  async listConversations(): Promise<Conversation[]> {
    const api = this.requireApi()
    const threads = (await api.getThreadList(60, null, ['INBOX'])) ?? []
    const list: Conversation[] = []
    for (const thread of threads) {
      this.threads.set(thread.threadID, thread)
      for (const user of (thread.userInfo ?? []) as FcaUser[]) if (user.id) this.users.set(user.id, user)
      list.push(this.toConversation(thread))
    }
    return list
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const api = this.requireApi()
    const threadId = externalIdOf(id)
    const known = this.history.get(id) ?? []
    const before = beforeId ? known.find((m) => m.id === beforeId) : undefined
    const raw = (await api.getThreadHistory(threadId, limit, before ? before.sentAt - 1 : null)) ?? []
    const messages = raw.map((m) => this.toMessage(m, id)).filter((m) => !beforeId || m.id !== beforeId)
    this.remember(id, messages)
    return messages.sort((a, b) => a.sentAt - b.sentAt)
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    const api = this.requireApi()
    const threadId = externalIdOf(id)
    // Messenger plays AAC voice notes natively; recordings carry an .m4a copy.
    const attachment = (options.attachments ?? []).map((f) => createReadStream(f.alternates?.find((alt) => alt.mime === 'audio/mp4')?.path ?? f.path))
    const payload = attachment.length ? { body: text, attachment } : { body: text }
    const result = (await new Promise<{ messageID?: string; timestamp?: number | string }>((resolve, reject) => {
      const cb = (err: unknown, info?: { messageID?: string; timestamp?: number | string }): void => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(info ?? {}))
      const send = api.sendMessage as unknown as (m: unknown, t: string, c: typeof cb, r?: string) => void
      send(payload, threadId, cb, options.replyToId)
    })) ?? {}
    const message: Message = {
      id: result.messageID ?? `local-${Date.now()}`,
      conversationId: id,
      senderId: this.meId,
      senderName: this.account.displayName,
      senderAvatarUrl: this.account.avatarUrl,
      text,
      attachments: (options.attachments ?? []).map((a, i) => ({
        id: `${result.messageID ?? Date.now()}-${i}`,
        kind: a.mime.startsWith('image/') ? 'image' : a.mime.startsWith('video/') ? 'video' : a.mime.startsWith('audio/') ? 'audio' : 'file',
        url: a.preview,
        name: a.name,
        size: a.size
      })),
      reactions: [],
      replyTo: options.replyToId ? this.quoteOf(id, options.replyToId) : undefined,
      sentAt: Number(result.timestamp) || Date.now(),
      isOutgoing: true,
      status: 'sent'
    }
    this.remember(id, [message])
    return message
  }

  async markRead(id: string): Promise<void> {
    await this.requireApi().markAsRead(externalIdOf(id), true).catch(() => undefined)
  }

  async setTyping(id: string): Promise<void> {
    await this.requireApi().sendTypingIndicator(true, externalIdOf(id)).catch(() => undefined)
  }

  async react(id: string, messageId: string, emoji: string): Promise<void> {
    const api = this.requireApi() as unknown as { setMessageReaction(reaction: string, messageID: string): Promise<unknown> }
    const current = (this.history.get(id) ?? []).find((m) => m.id === messageId)
    const mine = current?.reactions.find((r) => r.byMe)
    await api.setMessageReaction(mine?.emoji === emoji ? '' : emoji, messageId)
    if (current) {
      let reactions = current.reactions.map((r) => (r.byMe ? { ...r, count: r.count - 1, byMe: false } : r)).filter((r) => r.count > 0)
      if (mine?.emoji !== emoji) {
        const existing = reactions.find((r) => r.emoji === emoji)
        if (existing) reactions = reactions.map((r) => (r === existing ? { ...r, count: r.count + 1, byMe: true } : r))
        else reactions.push({ emoji, count: 1, byMe: true })
      }
      current.reactions = reactions
      this.ctx.emit({ type: 'message:updated', message: { ...current } })
    }
  }

  async getPeerProfile(id: string): Promise<PeerProfile | undefined> {
    const thread = this.threads.get(externalIdOf(id))
    if (!thread) return undefined
    if (thread.isGroup) {
      return { id: thread.threadID, name: thread.threadName ?? 'Group', avatarUrl: thread.imageSrc, extra: [{ label: 'Members', value: String(thread.participantIDs?.length ?? 0) }] }
    }
    const otherId = thread.participantIDs?.find((p) => p !== this.meId) ?? thread.threadID
    let user = this.users.get(otherId)
    try {
      user = ((await this.requireApi().getUserInfo(otherId)) as unknown as FcaUser) ?? user
      if (user) this.users.set(otherId, user)
    } catch {
      /* keep cached */
    }
    return {
      id: otherId,
      name: user?.name ?? thread.threadName ?? 'Facebook',
      handle: user?.vanity ? `fb.com/${user.vanity}` : undefined,
      avatarUrl: user?.profilePicUrl ?? user?.thumbSrc,
      bio: (user as { bio?: string } | undefined)?.bio
    }
  }

  async listContacts(): Promise<Peer[]> {
    const peers: Peer[] = []
    for (const user of this.users.values()) {
      if (!user.id || user.id === this.meId || !user.name) continue
      peers.push({ id: user.id, name: user.name, avatarUrl: user.thumbSrc ?? user.profilePicUrl, handle: user.vanity ? `fb.com/${user.vanity}` : undefined })
    }
    return peers
  }

  async openConversation(peerId: string): Promise<Conversation> {
    const existing = this.threads.get(peerId)
    if (existing) return this.toConversation(existing)
    const user = this.users.get(peerId)
    const id = conversationId(this.account.id, peerId)
    return {
      id,
      accountId: this.account.id,
      platform: 'messenger',
      title: user?.name ?? 'Facebook',
      avatarUrl: user?.thumbSrc ?? user?.profilePicUrl,
      isGroup: false,
      participants: [
        { id: this.meId, name: this.account.displayName, isMe: true },
        { id: peerId, name: user?.name ?? '', avatarUrl: user?.thumbSrc }
      ],
      unreadCount: 0,
      updatedAt: Date.now()
    }
  }

  async searchInConversation(id: string, query: string, limit: number): Promise<Message[]> {
    const needle = query.toLowerCase()
    return (this.history.get(id) ?? []).filter((m) => matchesQuery(m, needle)).sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  async getConversationStats(id: string) {
    const thread = this.threads.get(externalIdOf(id))
    const local = statsOf(this.history.get(id) ?? [])
    return { ...local, messageCount: thread?.messageCount ?? local.messageCount, approximate: thread?.messageCount === undefined }
  }

  // ---- events -----------------------------------------------------------

  private listen(api: FcaApi): void {
    const stop = (api as unknown as { listenMqtt(cb: (err: unknown, event: FcaEvent) => void): () => void }).listenMqtt((err, event) => {
      if (err || !event) return
      try {
        this.onEvent(event)
      } catch (e) {
        this.ctx.log('facebook event failed', (e as Error).message)
      }
    })
    this.stopListening = typeof stop === 'function' ? stop : undefined
  }

  private onEvent(event: FcaEvent): void {
    if (!event.threadID) return
    const id = conversationId(this.account.id, event.threadID)
    switch (event.type) {
      case 'message':
      case 'message_reply': {
        const message = this.toMessage(event as unknown as FcaMessage, id)
        this.remember(id, [message])
        if (!this.threads.has(event.threadID)) void this.discoverThread(event.threadID)
        this.ctx.emit({ type: 'message:new', message })
        break
      }
      case 'typ': {
        const from = event.from ?? event.senderID ?? ''
        if (from === this.meId) break
        this.ctx.emit({ type: 'typing', typing: { conversationId: id, peerName: this.users.get(from)?.name ?? 'Someone', isTyping: !!event.isTyping } })
        break
      }
      case 'read_receipt': {
        for (const message of this.history.get(id) ?? []) {
          if (message.isOutgoing && message.status !== 'read') {
            message.status = 'read'
            this.ctx.emit({ type: 'message:updated', message: { ...message } })
          }
        }
        break
      }
      case 'message_reaction': {
        const message = (this.history.get(id) ?? []).find((m) => m.id === event.messageID)
        if (!message) break
        const byMe = (event.userID ?? event.senderID) === this.meId
        let reactions = message.reactions.slice()
        if (byMe) reactions = reactions.map((r) => (r.byMe ? { ...r, count: r.count - 1, byMe: false } : r)).filter((r) => r.count > 0)
        if (event.reaction) {
          const existing = reactions.find((r) => r.emoji === event.reaction)
          if (existing) {
            existing.count += 1
            existing.byMe = existing.byMe || byMe
          } else reactions.push({ emoji: event.reaction, count: 1, byMe })
        }
        message.reactions = reactions
        this.ctx.emit({ type: 'message:updated', message: { ...message } })
        break
      }
    }
  }

  private async discoverThread(threadId: string): Promise<void> {
    try {
      const info = (await this.requireApi().getThreadInfo(threadId)) as FcaThread
      this.threads.set(threadId, info)
      for (const user of (info.userInfo ?? []) as FcaUser[]) if (user.id) this.users.set(user.id, user)
      this.ctx.emit({ type: 'conversation:upserted', conversation: this.toConversation(info) })
    } catch (err) {
      this.ctx.log('facebook thread info failed', (err as Error).message)
    }
  }

  // ---- mapping ----------------------------------------------------------

  private toConversation(thread: FcaThread): Conversation {
    const id = conversationId(this.account.id, thread.threadID)
    const others = (thread.participantIDs ?? []).filter((p) => p !== this.meId)
    const otherUser = others.length === 1 ? this.users.get(others[0]) : undefined
    const last = (this.history.get(id) ?? []).at(-1)
    return {
      id,
      accountId: this.account.id,
      platform: 'messenger',
      title: thread.threadName || otherUser?.name || others.map((p) => this.users.get(p)?.name ?? p).join(', ') || 'Messenger',
      avatarUrl: thread.imageSrc || otherUser?.thumbSrc || otherUser?.profilePicUrl,
      isGroup: !!thread.isGroup,
      participants: [
        { id: this.meId, name: this.account.displayName, isMe: true },
        ...others.map((p) => ({ id: p, name: this.users.get(p)?.name ?? p, avatarUrl: this.users.get(p)?.thumbSrc }))
      ],
      unreadCount: thread.unreadCount ?? 0,
      muted: !!thread.muteUntil && (thread.muteUntil === -1 || thread.muteUntil * 1000 > Date.now()),
      lastMessage: last && previewOf(last),
      updatedAt: Number(thread.timestamp) || last?.sentAt || 0
    }
  }

  private toMessage(raw: FcaMessage, id: string): Message {
    const extra = raw as unknown as {
      type?: string
      snippet?: string
      logMessageType?: string
      logMessageData?: unknown
      messageReactions?: Array<{ reaction: string; userID: string }>
      raw?: { message_id?: string; snippet?: string }
    }
    // History returns "unknown" rows without an id; keep them addressable and show what Facebook says.
    if (!raw.messageID && extra.raw?.message_id) (raw as { messageID: string }).messageID = extra.raw.message_id
    const isOutgoing = raw.senderID === this.meId
    const sender = this.users.get(raw.senderID)
    const message: Message = {
      id: raw.messageID,
      conversationId: id,
      senderId: raw.senderID,
      senderName: isOutgoing ? this.account.displayName : (sender?.name ?? 'Facebook'),
      senderAvatarUrl: isOutgoing ? this.account.avatarUrl : sender?.thumbSrc,
      text: raw.body ?? '',
      attachments: (raw.attachments ?? []).map((a, i) => mapFcaAttachment(a as unknown as FcaAttachment, `${raw.messageID}-${i}`)),
      reactions: summarizeReactions(((raw.reactions as unknown as Array<{ reaction: string; userID: string }>) ?? extra.messageReactions ?? []), this.meId),
      sentAt: Number(raw.timestamp) || Date.now(),
      isOutgoing,
      status: isOutgoing ? 'delivered' : 'delivered'
    }
    if (extra.type === 'event') {
      const event = mapFcaEvent(extra)
      message.text = event.text
      message.system = event.system
    } else if (extra.type === 'unknown' && !message.text && !message.attachments.length) {
      message.text = extra.raw?.snippet ?? ''
      message.system = message.text ? { kind: 'event' } : { kind: 'unavailable' }
    }
    if (raw.messageReply) {
      message.replyTo = { id: raw.messageReply.messageID, senderName: this.users.get(raw.messageReply.senderID)?.name ?? '', text: raw.messageReply.body ?? '' }
    }
    return message
  }

  private quoteOf(id: string, messageId: string): Message['replyTo'] {
    const original = (this.history.get(id) ?? []).find((m) => m.id === messageId)
    return original ? { id: original.id, senderName: original.senderName, text: original.text } : undefined
  }

  private remember(id: string, messages: Message[]): void {
    const list = this.history.get(id) ?? []
    for (const message of messages) {
      const index = list.findIndex((m) => m.id === message.id)
      if (index >= 0) list[index] = message
      else list.push(message)
    }
    list.sort((a, b) => a.sentAt - b.sentAt)
    this.history.set(id, list.slice(-HISTORY_LIMIT))
  }

  private requireApi(): FcaApi {
    if (!this.api) throw new Error('Facebook is not connected')
    return this.api
  }

  private setStatus(status: Account['status'], error?: string): void {
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
}

/**
 * ws3-fca picks a random user agent (Windows or Mac, Chrome 124-126) for every
 * request, so one session appears to hop between devices and Facebook logs it
 * out. Pin it to the same browser identity used in the login window.
 */
let uaPinned = false
function pinUserAgent(): void {
  if (uaPinned) return
  const req = createRequire(__filename)
  const entry = req.resolve('ws3-fca')
  const uaModule = req(join(dirname(entry), '..', 'src', 'utils', 'user-agents.js')) as { randomUserAgent: () => unknown; defaultUserAgent: string }
  const ua = browserUserAgent()
  const major = /Chrome\/(\d+)/.exec(ua)?.[1] ?? '130'
  const platform = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
  const brands = `"Chromium";v="${major}", "Not?A_Brand";v="99"`
  uaModule.randomUserAgent = () => ({
    userAgent: ua,
    secChUa: brands,
    secChUaFullVersionList: `"Chromium";v="${major}.0.0.0", "Not?A_Brand";v="99.0.0.0"`,
    secChUaPlatform: `"${platform}"`,
    secChUaPlatformVersion: process.platform === 'win32' ? '"15.0.0"' : '"14.0.0"'
  })
  uaModule.defaultUserAgent = ua
  uaPinned = true
}

function summarizeReactions(list: Array<{ reaction: string; userID: string }>, meId: string): Message['reactions'] {
  const map = new Map<string, { emoji: string; count: number; byMe: boolean }>()
  for (const r of list) {
    const entry = map.get(r.reaction) ?? { emoji: r.reaction, count: 0, byMe: false }
    entry.count += 1
    if (r.userID === meId) entry.byMe = true
    map.set(r.reaction, entry)
  }
  return [...map.values()]
}
