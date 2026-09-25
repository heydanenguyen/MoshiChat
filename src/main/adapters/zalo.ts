import type { API, Credentials, Message as ZMessage, TMessage, GroupInfo, User } from 'zca-js'
import type { Account, Attachment, Conversation, ConversationStats, Message, PeerProfile, SendOptions, SharedKind } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf, isShared, matchesQuery, previewOf, statsOf } from './types'

export interface ZaloSecret {
  credentials?: Credentials
}

type ZcaModule = typeof import('zca-js')

const HISTORY_LIMIT = 300

/** Emoji shown in the UI mapped onto Zalo's reaction codes. */
const REACTION_CODES: Record<string, string> = {
  '❤️': '/-heart',
  '👍': '/-strong',
  '😂': ':>',
  '😮': ':o',
  '😢': ':-((',
  '😡': ':-h',
  '🙏': '_()_'
}
const REACTION_EMOJI = Object.fromEntries(Object.entries(REACTION_CODES).map(([e, c]) => [c, e]))

/**
 * Zalo personal account through the Zalo Web protocol (zca-js). Sign in by
 * scanning a QR code with the Zalo app, as on chat.zalo.me.
 */
export class ZaloAdapter implements PlatformAdapter {
  readonly account: Account
  private zca?: ZcaModule
  private api?: API
  private meId = ''
  private friends = new Map<string, User>()
  private groups = new Map<string, GroupInfo>()
  private names = new Map<string, string>()
  private avatars = new Map<string, string>()
  private raw = new Map<string, TMessage[]>()
  private converted = new Map<string, Message[]>()
  private threadTypes = new Map<string, 0 | 1>()
  private unread = new Map<string, number>()
  private lastActivity = new Map<string, number>()
  private qrPromptId?: string

  constructor(
    initialId: string,
    private secret: ZaloSecret,
    private readonly ctx: AdapterContext
  ) {
    this.account = {
      id: initialId,
      platform: 'zalo',
      displayName: 'Zalo',
      status: 'disconnected',
      features: { reply: true, react: true, attachments: true }
    }
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    const zca = (this.zca ??= await import('zca-js'))
    const zalo = new zca.Zalo({ selfListen: true, checkUpdate: false, logging: false })
    let api: API
    try {
      if (this.secret.credentials) {
        api = await zalo.login(this.secret.credentials)
      } else {
        api = await this.loginWithQr(zalo, zca)
      }
    } catch (err) {
      this.setStatus('error', (err as Error).message)
      throw err
    }
    this.api = api
    if (this.qrPromptId) this.ctx.dismissAuth(this.qrPromptId)
    this.qrPromptId = undefined

    this.meId = api.getOwnId()
    this.account.id = `zalo:${this.meId}`
    try {
      const { profile } = await api.fetchAccountInfo()
      this.account.displayName = profile.displayName || profile.zaloName || 'Zalo'
      this.account.avatarUrl = profile.avatar
      this.account.handle = profile.username ? `@${profile.username}` : undefined
    } catch (err) {
      this.ctx.log('zalo profile failed', (err as Error).message)
    }
    await this.ctx.saveSecret(this.secret)
    this.wireListener(api, zca)
    api.listener.start({ retryOnClose: true })
    this.setStatus('connected')
  }

  private async loginWithQr(zalo: InstanceType<ZcaModule['Zalo']>, zca: ZcaModule): Promise<API> {
    return new Promise<API>((resolve, reject) => {
      let cancelled = false
      zalo
        .loginQR({}, (event) => {
          if (event.type === zca.LoginQRCallbackEventType.QRCodeGenerated) {
            const dataUrl = event.data.image.startsWith('data:') ? event.data.image : `data:image/png;base64,${event.data.image}`
            this.setStatus('needs_auth')
            this.qrPromptId = this.ctx.presentQr(dataUrl, undefined, this.qrPromptId, () => {
              cancelled = true
              event.actions.abort()
              reject(new Error('Sign-in cancelled'))
            })
          } else if (event.type === zca.LoginQRCallbackEventType.QRCodeScanned) {
            if (this.qrPromptId) this.ctx.noteAuth(this.qrPromptId, `${event.data.display_name} - confirm on your phone`)
          } else if (event.type === zca.LoginQRCallbackEventType.QRCodeExpired) {
            if (!cancelled) event.actions.retry()
          } else if (event.type === zca.LoginQRCallbackEventType.QRCodeDeclined) {
            reject(new Error('Sign-in was declined on the phone'))
          } else if (event.type === zca.LoginQRCallbackEventType.GotLoginInfo) {
            this.secret = { credentials: { cookie: event.data.cookie, imei: event.data.imei, userAgent: event.data.userAgent } }
          }
        })
        .then(resolve, reject)
    })
  }

  async disconnect(): Promise<void> {
    this.api?.listener.stop()
    this.api = undefined
    this.setStatus('disconnected')
  }

  async listConversations(): Promise<Conversation[]> {
    const api = this.requireApi()
    const [friends, groupList] = await Promise.all([api.getAllFriends(), api.getAllGroups()])
    for (const friend of friends) {
      this.friends.set(friend.userId, friend)
      this.names.set(friend.userId, friend.displayName || friend.zaloName)
      if (friend.avatar) this.avatars.set(friend.userId, friend.avatar)
      this.threadTypes.set(friend.userId, 0)
    }
    const groupIds = Object.keys(groupList.gridVerMap)
    if (groupIds.length) {
      const info = await api.getGroupInfo(groupIds)
      for (const [groupId, group] of Object.entries(info.gridInfoMap)) {
        this.groups.set(groupId, group)
        this.names.set(groupId, group.name)
        this.threadTypes.set(groupId, 1)
        for (const member of group.currentMems ?? []) {
          if (member.dName) this.names.set(member.id, member.dName)
          if (member.avatar) this.avatars.set(member.id, member.avatar)
        }
      }
    }
    // Pull recent history so previews and unread state are populated.
    api.listener.requestOldMessages(0)
    api.listener.requestOldMessages(1)
    return this.buildConversations()
  }

  private buildConversations(): Conversation[] {
    const list: Conversation[] = []
    for (const friend of this.friends.values()) {
      list.push(this.toConversation(friend.userId, false))
    }
    for (const groupId of this.groups.keys()) {
      list.push(this.toConversation(groupId, true))
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private toConversation(threadId: string, isGroup: boolean): Conversation {
    const id = conversationId(this.account.id, threadId)
    const friend = this.friends.get(threadId)
    const group = this.groups.get(threadId)
    const last = this.messagesFor(id).at(-1)
    const activity = this.lastActivity.get(threadId) ?? (friend?.lastActionTime ? Number(friend.lastActionTime) : 0)
    return {
      id,
      accountId: this.account.id,
      platform: 'zalo',
      title: isGroup ? (group?.name ?? 'Group') : (friend?.displayName || friend?.zaloName || 'Zalo'),
      avatarUrl: isGroup ? group?.avt || undefined : friend?.avatar,
      isGroup,
      participants: [
        { id: this.meId, name: this.account.displayName, isMe: true },
        ...(isGroup
          ? (group?.memberIds ?? []).filter((m) => m !== this.meId).slice(0, 50).map((m) => ({ id: m, name: this.names.get(m) ?? m, avatarUrl: this.avatars.get(m) }))
          : [{ id: threadId, name: friend?.displayName ?? '', handle: friend?.username ? `@${friend.username}` : undefined, avatarUrl: friend?.avatar }])
      ],
      unreadCount: this.unread.get(threadId) ?? 0,
      lastMessage: last && previewOf(last),
      updatedAt: last?.sentAt ?? (activity > 1e12 ? activity : activity * 1000)
    }
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const threadId = externalIdOf(id)
    if (this.threadTypes.get(threadId) === 1 && !this.raw.get(threadId)?.length) {
      try {
        const history = await this.requireApi().getGroupChatHistory(threadId, Math.max(limit, 50))
        this.remember(threadId, history.groupMsgs.map((m) => m.data))
      } catch (err) {
        this.ctx.log('zalo group history failed', (err as Error).message)
      }
    }
    const all = this.messagesFor(id, true)
    const end = beforeId ? all.findIndex((m) => m.id === beforeId) : all.length
    if (end < 0) return []
    return all.slice(Math.max(0, end - limit), end)
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    const api = this.requireApi()
    const threadId = externalIdOf(id)
    const type = this.threadTypes.get(threadId) ?? 0
    const quoteRaw = options.replyToId ? this.rawMessage(threadId, options.replyToId) : undefined
    const content = {
      msg: text,
      quote: quoteRaw
        ? {
            content: quoteRaw.content,
            msgType: quoteRaw.msgType,
            propertyExt: quoteRaw.propertyExt,
            uidFrom: quoteRaw.uidFrom,
            msgId: quoteRaw.msgId,
            cliMsgId: quoteRaw.cliMsgId,
            ts: quoteRaw.ts,
            ttl: quoteRaw.ttl
          }
        : undefined,
      attachments: options.attachments?.length ? options.attachments.map((a) => a.path) : undefined
    }
    const result = await api.sendMessage(content, threadId, type)
    const msgId = String(result.message?.msgId ?? result.attachment[0]?.msgId ?? Date.now())
    const message: Message = {
      id: msgId,
      conversationId: id,
      senderId: this.meId,
      senderName: this.account.displayName,
      text,
      attachments: (options.attachments ?? []).map((a, i) => ({
        id: `${msgId}-${i}`,
        kind: a.mime.startsWith('image/') ? 'image' : a.mime.startsWith('video/') ? 'video' : 'file',
        name: a.name,
        size: a.size,
        url: a.preview
      })),
      reactions: [],
      replyTo: quoteRaw ? { id: quoteRaw.msgId, senderName: this.names.get(quoteRaw.uidFrom) ?? quoteRaw.dName, text: textOf(quoteRaw) } : undefined,
      sentAt: Date.now(),
      isOutgoing: true,
      status: 'sent'
    }
    this.cacheConverted(id, [message])
    this.lastActivity.set(threadId, message.sentAt)
    return message
  }

  async markRead(id: string): Promise<void> {
    const threadId = externalIdOf(id)
    this.unread.set(threadId, 0)
    const last = (this.raw.get(threadId) ?? []).filter((m) => m.uidFrom !== '0' && m.uidFrom !== this.meId).at(-1)
    if (!last) return
    await this.requireApi()
      .sendSeenEvent(
        { msgId: last.msgId, cliMsgId: last.cliMsgId, uidFrom: last.uidFrom, idTo: last.idTo, msgType: last.msgType, st: last.st, at: last.at, cmd: last.cmd, ts: last.ts },
        this.threadTypes.get(threadId) ?? 0
      )
      .catch(() => undefined)
  }

  async setTyping(id: string): Promise<void> {
    const threadId = externalIdOf(id)
    await this.requireApi().sendTypingEvent(threadId, this.threadTypes.get(threadId) ?? 0).catch(() => undefined)
  }

  async forward(fromId: string, messageId: string, toId: string): Promise<Message> {
    const raw = this.rawMessage(externalIdOf(fromId), messageId)
    if (!raw) throw new Error('Message not found')
    const text = textOf(raw)
    if (!text) throw new Error('Zalo can only forward text messages from Unison')
    const toThread = externalIdOf(toId)
    const type = this.threadTypes.get(toThread) ?? 0
    const result = await this.requireApi().forwardMessage({ message: text }, [toThread], type)
    const ok = result.success[0]
    if (!ok) throw new Error(`Zalo refused the forward (${result.fail[0]?.error_code ?? 'unknown'})`)
    const message: Message = {
      id: String(ok.msgId),
      conversationId: toId,
      senderId: this.meId,
      senderName: this.account.displayName,
      text,
      attachments: [],
      reactions: [],
      sentAt: Date.now(),
      isOutgoing: true,
      status: 'sent'
    }
    this.cacheConverted(toId, [message])
    return message
  }

  async searchMessages(query: string, limit: number): Promise<Message[]> {
    const needle = query.toLowerCase()
    const hits: Message[] = []
    for (const threadId of this.raw.keys()) {
      const id = conversationId(this.account.id, threadId)
      for (const message of this.messagesFor(id)) if (matchesQuery(message, needle)) hits.push(message)
    }
    return hits.sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  async getPeerProfile(id: string): Promise<PeerProfile | undefined> {
    const threadId = externalIdOf(id)
    const group = this.groups.get(threadId)
    if (group) {
      return {
        id: threadId,
        name: group.name,
        avatarUrl: group.fullAvt || group.avt || undefined,
        bio: group.desc || undefined,
        extra: [{ label: 'Members', value: String(group.totalMember ?? group.memberIds.length) }]
      }
    }
    let user = this.friends.get(threadId)
    if (!user) {
      const info = await this.requireApi().getUserInfo(threadId)
      user = info.changed_profiles[threadId]
      if (user) this.friends.set(threadId, user)
    }
    if (!user) return undefined
    const birthday = user.sdob && /^\d{2}\/\d{2}\/\d{4}$/.test(user.sdob) ? user.sdob.split('/').reverse().join('-') : user.sdob || undefined
    return {
      id: threadId,
      name: user.displayName || user.zaloName,
      handle: user.username ? `@${user.username}` : undefined,
      avatarUrl: user.avatar || undefined,
      bio: user.status || undefined,
      phone: user.phoneNumber || undefined,
      birthday,
      gender: user.gender === 0 ? 'male' : user.gender === 1 ? 'female' : undefined,
      extra: user.zaloName && user.zaloName !== user.displayName ? [{ label: 'Zalo name', value: user.zaloName }] : []
    }
  }

  async listShared(id: string, kind: SharedKind, limit: number): Promise<Message[]> {
    return this.messagesFor(id).filter((m) => isShared(m, kind)).sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  async getConversationStats(id: string): Promise<ConversationStats> {
    return statsOf(this.messagesFor(id))
  }

  async searchInConversation(id: string, query: string, limit: number): Promise<Message[]> {
    const needle = query.toLowerCase()
    return this.messagesFor(id).filter((m) => matchesQuery(m, needle)).sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  async react(id: string, messageId: string, emoji: string): Promise<void> {
    const threadId = externalIdOf(id)
    const raw = this.rawMessage(threadId, messageId)
    if (!raw) throw new Error('Message not found')
    const code = REACTION_CODES[emoji]
    if (!code) throw new Error('Zalo does not support this reaction')
    await this.requireApi().addReaction(code as never, {
      data: { msgId: raw.msgId, cliMsgId: raw.cliMsgId },
      threadId,
      type: this.threadTypes.get(threadId) ?? 0
    })
    const message = (this.converted.get(id) ?? []).find((m) => m.id === messageId)
    if (message) {
      const existing = message.reactions.find((r) => r.emoji === emoji)
      if (existing && !existing.byMe) {
        existing.count += 1
        existing.byMe = true
      } else if (!existing) message.reactions.push({ emoji, count: 1, byMe: true })
      this.ctx.emit({ type: 'message:updated', message: { ...message } })
    }
  }

  // ---- events -----------------------------------------------------------

  private wireListener(api: API, _zca: ZcaModule): void {
    api.listener.on('message', (message: ZMessage) => {
      const threadId = message.threadId
      this.threadTypes.set(threadId, message.type)
      const known = this.rawMessage(threadId, message.data.msgId)
      this.remember(threadId, [message.data])
      const id = conversationId(this.account.id, threadId)
      const converted = this.toMessage(message.data, id, message.isSelf)
      this.cacheConverted(id, [converted])
      this.lastActivity.set(threadId, converted.sentAt)
      if (!known) {
        if (!message.isSelf) this.unread.set(threadId, (this.unread.get(threadId) ?? 0) + 1)
        this.ctx.emit({ type: 'message:new', message: converted })
        if (!this.friends.has(threadId) && !this.groups.has(threadId)) {
          void this.discoverThread(threadId, message.type)
        }
      }
    })
    api.listener.on('old_messages', (messages: ZMessage[]) => {
      const touched = new Set<string>()
      for (const message of messages) {
        this.threadTypes.set(message.threadId, message.type)
        this.remember(message.threadId, [message.data])
        touched.add(message.threadId)
      }
      for (const threadId of touched) {
        const id = conversationId(this.account.id, threadId)
        this.converted.delete(id)
        const last = this.messagesFor(id).at(-1)
        if (last) this.lastActivity.set(threadId, Math.max(this.lastActivity.get(threadId) ?? 0, last.sentAt))
      }
      if (touched.size) {
        this.ctx.emit({ type: 'conversations:reset', accountId: this.account.id, conversations: this.buildConversations() })
      }
    })
    api.listener.on('typing', (typing) => {
      const id = conversationId(this.account.id, typing.threadId)
      this.ctx.emit({ type: 'typing', typing: { conversationId: id, peerName: this.names.get(typing.data.uid) ?? 'Someone', isTyping: true } })
    })
    api.listener.on('seen_messages', (seen) => {
      for (const item of seen) {
        const id = conversationId(this.account.id, item.threadId)
        for (const message of this.converted.get(id) ?? []) {
          if (message.isOutgoing && message.status !== 'read') {
            message.status = 'read'
            this.ctx.emit({ type: 'message:updated', message: { ...message } })
          }
        }
      }
    })
    api.listener.on('reaction', (reaction) => {
      const id = conversationId(this.account.id, reaction.threadId)
      const emoji = REACTION_EMOJI[reaction.data.content.rIcon] ?? reaction.data.content.rIcon
      for (const target of reaction.data.content.rMsg) {
        const message = (this.converted.get(id) ?? []).find((m) => m.id === String(target.gMsgID))
        if (!message) continue
        const existing = message.reactions.find((r) => r.emoji === emoji)
        if (existing) {
          existing.count += 1
          existing.byMe = existing.byMe || reaction.isSelf
        } else message.reactions.push({ emoji, count: 1, byMe: reaction.isSelf })
        this.ctx.emit({ type: 'message:updated', message: { ...message } })
      }
    })
    api.listener.on('error', (err) => this.ctx.log('zalo listener error', err))
    api.listener.on('closed', (code, reason) => {
      this.ctx.log('zalo listener closed', code, reason)
      if (Number(code) === 3003) this.setStatus('error', 'Signed out from another device')
    })
  }

  private async discoverThread(threadId: string, type: 0 | 1): Promise<void> {
    try {
      const api = this.requireApi()
      if (type === 1) {
        const info = await api.getGroupInfo(threadId)
        const group = info.gridInfoMap[threadId]
        if (group) {
          this.groups.set(threadId, group)
          this.names.set(threadId, group.name)
        }
      } else {
        const info = await api.getUserInfo(threadId)
        const user = info.changed_profiles[threadId]
        if (user) {
          this.friends.set(threadId, user)
          this.names.set(threadId, user.displayName || user.zaloName)
        }
      }
      this.ctx.emit({ type: 'conversation:upserted', conversation: this.toConversation(threadId, type === 1) })
    } catch (err) {
      this.ctx.log('zalo discover failed', (err as Error).message)
    }
  }

  // ---- mapping ----------------------------------------------------------

  private toMessage(raw: TMessage, id: string, isSelf?: boolean): Message {
    const outgoing = isSelf ?? (raw.uidFrom === '0' || raw.uidFrom === this.meId)
    const senderId = outgoing ? this.meId : raw.uidFrom
    if (!outgoing && raw.dName) this.names.set(raw.uidFrom, raw.dName)
    const message: Message = {
      id: raw.msgId,
      conversationId: id,
      senderId,
      senderName: outgoing ? this.account.displayName : raw.dName || this.names.get(raw.uidFrom) || 'Zalo',
      senderAvatarUrl: outgoing ? this.account.avatarUrl : this.avatars.get(raw.uidFrom),
      text: textOf(raw),
      attachments: attachmentsOf(raw),
      reactions: [],
      sentAt: Number(raw.ts),
      isOutgoing: outgoing,
      status: outgoing ? 'delivered' : 'delivered'
    }
    if (raw.quote) {
      message.replyTo = { id: String(raw.quote.globalMsgId), senderName: raw.quote.fromD, text: raw.quote.msg || (raw.quote.attach ? 'Attachment' : '') }
    }
    return message
  }

  private messagesFor(id: string, rebuild = false): Message[] {
    if (!rebuild && this.converted.has(id)) return this.converted.get(id)!
    const threadId = externalIdOf(id)
    const known = new Map((this.converted.get(id) ?? []).map((m) => [m.id, m]))
    const list = (this.raw.get(threadId) ?? []).map((raw) => known.get(raw.msgId) ?? this.toMessage(raw, id))
    for (const m of known.values()) if (!list.some((x) => x.id === m.id)) list.push(m)
    list.sort((a, b) => a.sentAt - b.sentAt)
    this.converted.set(id, list)
    return list
  }

  private cacheConverted(id: string, messages: Message[]): void {
    const list = this.messagesFor(id)
    for (const message of messages) {
      const index = list.findIndex((m) => m.id === message.id)
      if (index >= 0) list[index] = message
      else list.push(message)
    }
    list.sort((a, b) => a.sentAt - b.sentAt)
    this.converted.set(id, list.slice(-HISTORY_LIMIT))
  }

  private remember(threadId: string, messages: TMessage[]): void {
    const list = this.raw.get(threadId) ?? []
    for (const message of messages) {
      const index = list.findIndex((m) => m.msgId === message.msgId)
      if (index >= 0) list[index] = message
      else list.push(message)
    }
    list.sort((a, b) => Number(a.ts) - Number(b.ts))
    this.raw.set(threadId, list.slice(-HISTORY_LIMIT))
  }

  private rawMessage(threadId: string, messageId: string): TMessage | undefined {
    return (this.raw.get(threadId) ?? []).find((m) => m.msgId === messageId)
  }

  private requireApi(): API {
    if (!this.api) throw new Error('Zalo is not connected')
    return this.api
  }

  private setStatus(status: Account['status'], error?: string): void {
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
}

function textOf(raw: TMessage): string {
  if (typeof raw.content === 'string') return raw.content
  if (raw.content && typeof raw.content === 'object') {
    const c = raw.content as { title?: string; description?: string; text?: string }
    if (raw.msgType === 'chat.photo' || raw.msgType === 'chat.video.msg' || raw.msgType === 'chat.sticker' || raw.msgType === 'chat.voice') return ''
    return c.text ?? c.title ?? ''
  }
  return ''
}

function attachmentsOf(raw: TMessage): Attachment[] {
  if (typeof raw.content !== 'object' || !raw.content) return []
  const c = raw.content as { href?: string; thumb?: string; title?: string; description?: string; params?: string; type?: string }
  const id = `${raw.msgId}-a`
  switch (raw.msgType) {
    case 'chat.photo':
      return [{ id, kind: 'image', url: c.href, thumbnailUrl: c.thumb }]
    case 'chat.video.msg':
      return [{ id, kind: 'video', url: c.href, thumbnailUrl: c.thumb }]
    case 'chat.voice':
      return [{ id, kind: 'audio', url: c.href, name: 'Voice message' }]
    case 'chat.sticker':
      return [{ id, kind: 'sticker', name: '' }]
    case 'chat.gif':
      return [{ id, kind: 'image', url: c.href, thumbnailUrl: c.thumb }]
    case 'share.file':
    case 'chat.file':
      return [{ id, kind: 'file', url: c.href, name: c.title ?? 'File', size: sizeFrom(c.params) }]
    case 'chat.recommended':
      return [{ id, kind: 'link', url: c.href, name: c.title ?? c.href }]
    default:
      return c.href ? [{ id, kind: 'link', url: c.href, name: c.title ?? c.href }] : []
  }
}

function sizeFrom(params?: string): number | undefined {
  if (!params) return undefined
  try {
    const parsed = JSON.parse(params) as { fileSize?: string | number }
    return parsed.fileSize ? Number(parsed.fileSize) : undefined
  } catch {
    return undefined
  }
}
