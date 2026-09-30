import bigInt from 'big-integer'
import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage, NewMessageEvent } from 'telegram/events'
import { LogLevel } from 'telegram/extensions/Logger'
import type { Account, Attachment, Conversation, ConversationStats, Message, Peer, PeerProfile, Reaction, SendOptions, SharedKind } from '@shared/types'
import { ALL_FEATURES } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf, matchesQuery, previewKindOf, unsentCopy } from './types'

export interface TelegramSecret {
  apiId: number
  apiHash: string
  session?: string
}

type Entity = Api.User | Api.Chat | Api.Channel

/**
 * Telegram over MTProto (gramjs). This is a full user account, exactly like
 * Telegram Desktop: dialogs, history, sending, read receipts and typing.
 */
export class TelegramAdapter implements PlatformAdapter {
  readonly account: Account
  private client?: TelegramClient
  private entities = new Map<string, Entity>()
  private readOutbox = new Map<string, number>()
  private recent = new Map<string, Message[]>()
  private senderNames = new Map<string, string>()
  private senderAvatars = new Map<string, string | undefined>()
  private meId = ''

  constructor(
    initialId: string,
    private secret: TelegramSecret,
    private readonly ctx: AdapterContext
  ) {
    this.account = { id: initialId, platform: 'telegram', displayName: 'Telegram', status: 'disconnected', features: ALL_FEATURES }
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    const client = new TelegramClient(new StringSession(this.secret.session ?? ''), this.secret.apiId, this.secret.apiHash, {
      connectionRetries: 5,
      useWSS: false
    })
    client.setLogLevel(LogLevel.ERROR)
    this.client = client
    try {
      await client.start({
        phoneNumber: () => this.prompt('phone'),
        phoneCode: () => this.prompt('code'),
        password: () => this.prompt('password'),
        onError: (err) => {
          this.ctx.log('telegram auth error', err.message)
          return Promise.resolve(false)
        }
      })
    } catch (err) {
      this.setStatus('error', (err as Error).message)
      throw err
    }

    const session = client.session.save() as unknown as string
    const me = (await client.getMe()) as Api.User
    this.meId = me.id.toString()
    this.account.id = `telegram:${this.meId}`
    this.account.displayName = fullName(me)
    this.account.handle = me.username ? `@${me.username}` : undefined
    this.secret = { ...this.secret, session }
    await this.ctx.saveSecret(this.secret)

    const photo = await this.profilePhoto(me)
    if (photo) this.account.avatarUrl = photo
    this.setStatus('connected')

    client.addEventHandler((event) => void this.onNewMessage(event), new NewMessage({}))
    client.addEventHandler((update) => this.onRawUpdate(update))
  }

  async disconnect(): Promise<void> {
    await this.client?.disconnect().catch(() => undefined)
    this.client = undefined
    this.setStatus('disconnected')
  }

  async listConversations(): Promise<Conversation[]> {
    const client = this.requireClient()
    const dialogs = await client.getDialogs({ limit: 60 })
    const result: Conversation[] = []
    for (const dialog of dialogs) {
      const entity = dialog.entity as Entity | undefined
      if (!entity || !dialog.id) continue
      const externalId = dialog.id.toString()
      this.entities.set(externalId, entity)
      const id = conversationId(this.account.id, externalId)
      const readOutboxMaxId = (dialog.dialog as Api.Dialog).readOutboxMaxId ?? 0
      this.readOutbox.set(id, readOutboxMaxId)
      const last = dialog.message ? await this.toMessage(dialog.message, id) : undefined
      const conversation: Conversation = {
        id,
        accountId: this.account.id,
        platform: 'telegram',
        title: dialog.title || dialog.name || 'Telegram',
        isGroup: dialog.isGroup || dialog.isChannel,
        participants: [
          { id: this.meId, name: this.account.displayName, isMe: true },
          ...(dialog.isUser ? [{ id: externalId, name: dialog.title || dialog.name || '', handle: usernameOf(entity), phone: phoneOf(entity) }] : [])
        ],
        unreadCount: dialog.unreadCount,
        pinned: dialog.pinned,
        muted: !!(dialog.dialog as Api.Dialog).notifySettings?.muteUntil,
        lastMessage: last && {
          id: last.id,
          text: last.text || describeAttachments(last.attachments),
          senderName: last.senderName,
          isOutgoing: last.isOutgoing,
          sentAt: last.sentAt,
          kind: previewKindOf(last)
        },
        updatedAt: (dialog.date ?? 0) * 1000
      }
      result.push(conversation)
    }
    void this.hydrateAvatars(result)
    return result
  }

  private async hydrateAvatars(conversations: Conversation[]): Promise<void> {
    for (const conversation of conversations.slice(0, 40)) {
      const entity = this.entities.get(externalIdOf(conversation.id))
      if (!entity) continue
      const url = await this.profilePhoto(entity)
      if (url) this.ctx.emit({ type: 'conversation:upserted', conversation: { ...conversation, avatarUrl: url } })
    }
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    const raw = await client.getMessages(entity, { limit, offsetId: beforeId ? Number(beforeId) : 0 })
    const messages: Message[] = []
    for (const item of raw) {
      if (!(item instanceof Api.Message)) continue
      messages.push(await this.toMessage(item, id))
    }
    messages.reverse()
    this.remember(id, messages)
    return messages
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    const replyTo = options.replyToId ? Number(options.replyToId) : undefined
    const files = options.attachments ?? []
    // Stickers go as photos, which Telegram recompresses without transparency: use the copy on white.
    const pathFor = (f: (typeof files)[number]): string => (f.sticker ? (f.alternates?.find((alt) => alt.role === 'opaque')?.path ?? f.path) : f.path)
    let sent: Api.Message
    const gifMp4 = files.length === 1 && files[0].gif ? files[0].alternates?.find((alt) => alt.mime === 'video/mp4') : undefined
    if (gifMp4) {
      const gif = files[0]
      sent = await client.sendFile(entity, {
        file: gifMp4.path,
        caption: text || undefined,
        replyTo,
        attributes: [
          new Api.DocumentAttributeVideo({ duration: 0, w: gif.width ?? 0, h: gif.height ?? 0, supportsStreaming: true }),
          new Api.DocumentAttributeAnimated()
        ]
      })
    } else if (files.length) {
      const voice = files.length === 1 && files[0].voice
      const result = await client.sendFile(entity, {
        file: files.length === 1 ? pathFor(files[0]) : files.map(pathFor),
        caption: text || undefined,
        replyTo,
        voiceNote: !!voice,
        forceDocument: !voice && files.some((f) => !f.mime.startsWith('image/') && !f.mime.startsWith('video/'))
      })
      sent = Array.isArray(result) ? result[result.length - 1] : result
    } else {
      sent = await client.sendMessage(entity, { message: text, replyTo })
    }
    const message = await this.toMessage(sent, id)
    this.remember(id, [message])
    return message
  }

  async forward(fromId: string, messageId: string, toId: string): Promise<Message> {
    const client = this.requireClient()
    const fromEntity = await this.entityFor(fromId)
    const toEntity = await this.entityFor(toId)
    const result = await client.forwardMessages(toEntity, { messages: [Number(messageId)], fromPeer: fromEntity })
    const sent = result[0]
    if (!sent) throw new Error('Telegram did not return the forwarded message')
    const message = await this.toMessage(sent, toId)
    this.remember(toId, [message])
    return message
  }

  /** Server-side search across every dialog (messages.searchGlobal). */
  async searchMessages(query: string, limit: number): Promise<Message[]> {
    const client = this.requireClient()
    const result = await client.invoke(
      new Api.messages.SearchGlobal({
        q: query,
        offsetRate: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        offsetId: 0,
        limit,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0
      })
    )
    if (!('messages' in result)) return []
    for (const user of result.users) if (user instanceof Api.User) this.entities.set(user.id.toString(), user)
    for (const chat of result.chats) {
      if (chat instanceof Api.Chat) this.entities.set(`-${chat.id}`, chat)
      else if (chat instanceof Api.Channel) this.entities.set(`-100${chat.id}`, chat)
    }
    const messages: Message[] = []
    for (const raw of result.messages) {
      if (!(raw instanceof Api.Message)) continue
      const peerId = peerToId(raw.peerId)
      if (!peerId) continue
      messages.push(await this.toMessage(raw, conversationId(this.account.id, peerId)))
    }
    return messages
  }

  async downloadAttachment(id: string, messageId: string): Promise<string | undefined> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    const [raw] = await client.getMessages(entity, { ids: [Number(messageId)] })
    if (!(raw instanceof Api.Message) || !raw.media) return undefined
    const doc = raw.media instanceof Api.MessageMediaDocument ? raw.media.document : undefined
    const size = doc instanceof Api.Document ? Number(doc.size) : 0
    if (size > 25_000_000) return undefined
    const buffer = (await client.downloadMedia(raw, {})) as Buffer | undefined
    if (!buffer?.length) return undefined
    const mime = doc instanceof Api.Document ? doc.mimeType : 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
  }

  async getPeerProfile(id: string): Promise<PeerProfile | undefined> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    if (!(entity instanceof Api.User)) {
      const title = entity.title
      const avatarUrl = await this.profilePhoto(entity, true)
      return { id: externalIdOf(id), name: title, avatarUrl, extra: [] }
    }
    const full = await client.invoke(new Api.users.GetFullUser({ id: entity }))
    const info = full.fullUser
    const user = full.users.find((u): u is Api.User => u instanceof Api.User) ?? entity
    let birthday: string | undefined
    if (info.birthday instanceof Api.Birthday) {
      const mm = String(info.birthday.month).padStart(2, '0')
      const dd = String(info.birthday.day).padStart(2, '0')
      birthday = info.birthday.year ? `${info.birthday.year}-${mm}-${dd}` : `--${mm}-${dd}`
    }
    return {
      id: user.id.toString(),
      name: fullName(user),
      handle: user.username ? `@${user.username}` : undefined,
      avatarUrl: (await this.profilePhoto(user, true)) ?? undefined,
      bio: info.about ?? undefined,
      phone: user.phone ? `+${user.phone}` : undefined,
      birthday,
      extra: [
        ...(user.premium ? [{ label: 'Telegram', value: 'Premium' }] : []),
        ...(info.commonChatsCount ? [{ label: 'Common groups', value: String(info.commonChatsCount) }] : [])
      ]
    }
  }

  async listShared(id: string, kind: SharedKind, limit: number): Promise<Message[]> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    const filter =
      kind === 'media' ? new Api.InputMessagesFilterPhotoVideo() : kind === 'links' ? new Api.InputMessagesFilterUrl() : new Api.InputMessagesFilterDocument()
    const raw = await client.getMessages(entity, { limit, filter })
    const messages: Message[] = []
    for (const item of raw) if (item instanceof Api.Message) messages.push(await this.toMessage(item, id))
    this.remember(id, messages)
    return messages
  }

  async listContacts(): Promise<Peer[]> {
    const client = this.requireClient()
    const result = await client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) }))
    if (!('users' in result)) return []
    const peers: Peer[] = []
    for (const user of result.users) {
      if (!(user instanceof Api.User) || user.self || user.bot) continue
      const id = user.id.toString()
      this.entities.set(id, user)
      peers.push({ id, name: fullName(user), handle: user.username ? `@${user.username}` : user.phone ? `+${user.phone}` : undefined, avatarUrl: this.senderAvatars.get(id) })
    }
    return peers
  }

  async openConversation(peerId: string): Promise<Conversation> {
    const id = conversationId(this.account.id, peerId)
    const entity = await this.entityFor(id)
    const name = entity instanceof Api.User ? fullName(entity) : entity.title
    const avatarUrl = await this.profilePhoto(entity)
    return {
      id,
      accountId: this.account.id,
      platform: 'telegram',
      title: name,
      avatarUrl,
      isGroup: !(entity instanceof Api.User),
      participants: [
        { id: this.meId, name: this.account.displayName, isMe: true },
        { id: peerId, name, handle: usernameOf(entity), avatarUrl, phone: phoneOf(entity) }
      ],
      unreadCount: 0,
      updatedAt: Date.now()
    }
  }

  async getConversationStats(id: string): Promise<ConversationStats> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    const oldest = await client.getMessages(entity, { limit: 1, reverse: true })
    const newest = await client.getMessages(entity, { limit: 1 })
    const first = oldest[0]
    const last = newest[0]
    return {
      firstMessageAt: first ? first.date * 1000 : undefined,
      lastMessageAt: last ? last.date * 1000 : undefined,
      messageCount: typeof newest.total === 'number' ? newest.total : undefined,
      approximate: false
    }
  }

  async searchInConversation(id: string, query: string, limit: number): Promise<Message[]> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    const raw = await client.getMessages(entity, { limit, search: query })
    const messages: Message[] = []
    for (const item of raw) if (item instanceof Api.Message) messages.push(await this.toMessage(item, id))
    this.remember(id, messages)
    return messages
  }

  async react(id: string, messageId: string, emoji: string): Promise<void> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    const current = (this.recent.get(id) ?? []).find((m) => m.id === messageId)
    const alreadyMine = current?.reactions.some((r) => r.emoji === emoji && r.byMe)
    await client.invoke(
      new Api.messages.SendReaction({
        peer: entity,
        msgId: Number(messageId),
        reaction: alreadyMine ? [] : [new Api.ReactionEmoji({ emoticon: emoji })]
      })
    )
    if (current) {
      let reactions = current.reactions.map((r) => (r.byMe ? { ...r, count: r.count - 1, byMe: false } : r)).filter((r) => r.count > 0)
      if (!alreadyMine) {
        const existing = reactions.find((r) => r.emoji === emoji)
        if (existing) reactions = reactions.map((r) => (r === existing ? { ...r, count: r.count + 1, byMe: true } : r))
        else reactions.push({ emoji, count: 1, byMe: true })
      }
      current.reactions = reactions
      this.ctx.emit({ type: 'message:updated', message: { ...current } })
    }
  }

  async markRead(id: string): Promise<void> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    await client.markAsRead(entity).catch(() => undefined)
  }

  async setTyping(id: string): Promise<void> {
    const client = this.requireClient()
    const entity = await this.entityFor(id)
    await client
      .invoke(new Api.messages.SetTyping({ peer: entity, action: new Api.SendMessageTypingAction() }))
      .catch(() => undefined)
  }

  // ---- events -----------------------------------------------------------

  private async onNewMessage(event: NewMessageEvent): Promise<void> {
    const chatId = event.chatId?.toString()
    if (!chatId) return
    const id = conversationId(this.account.id, chatId)
    const message = await this.toMessage(event.message, id)
    this.remember(id, [message])
    this.ctx.emit({ type: 'message:new', message })
  }

  async unsend(id: string, messageId: string): Promise<void> {
    await this.requireClient().deleteMessages(await this.entityFor(id), [Number(messageId)], { revoke: true })
    this.markUnsent(id, [messageId])
  }

  /** Messages deleted for everyone (by me or the other side) stay in the chat as "unsent". */
  private markUnsent(id: string, messageIds: string[]): void {
    const list = this.recent.get(id)
    if (!list) return
    for (const messageId of messageIds) {
      const index = list.findIndex((m) => m.id === messageId)
      if (index < 0 || list[index].unsent) continue
      list[index] = unsentCopy(list[index])
      this.ctx.emit({ type: 'message:updated', message: { ...list[index] } })
    }
  }

  private onRawUpdate(update: Api.TypeUpdate): void {
    if (update instanceof Api.UpdateDeleteMessages) {
      // Private chats and basic groups: the ids are unique across them, and the update does not name the chat.
      const ids = update.messages.map(String)
      for (const id of this.recent.keys()) if (!externalIdOf(id).startsWith('-100')) this.markUnsent(id, ids)
    } else if (update instanceof Api.UpdateDeleteChannelMessages) {
      this.markUnsent(conversationId(this.account.id, `-100${update.channelId}`), update.messages.map(String))
    } else if (update instanceof Api.UpdateReadHistoryOutbox) {
      const peerId = peerToId(update.peer)
      if (!peerId) return
      const id = conversationId(this.account.id, peerId)
      this.readOutbox.set(id, update.maxId)
      for (const message of this.recent.get(id) ?? []) {
        if (message.isOutgoing && Number(message.id) <= update.maxId && message.status !== 'read') {
          message.status = 'read'
          this.ctx.emit({ type: 'message:updated', message: { ...message } })
        }
      }
    } else if (update instanceof Api.UpdateUserTyping) {
      const userId = update.userId.toString()
      this.emitTyping(conversationId(this.account.id, userId), userId, update.action)
    } else if (update instanceof Api.UpdateChatUserTyping) {
      const fromId = peerToId(update.fromId)
      if (fromId) this.emitTyping(conversationId(this.account.id, `-${update.chatId}`), fromId, update.action)
    } else if (update instanceof Api.UpdateChannelUserTyping) {
      const fromId = peerToId(update.fromId)
      if (fromId) this.emitTyping(conversationId(this.account.id, `-100${update.channelId}`), fromId, update.action)
    }
  }

  private emitTyping(id: string, userId: string, action: Api.TypeSendMessageAction): void {
    const isTyping = !(action instanceof Api.SendMessageCancelAction)
    const peerName = this.senderNames.get(userId) ?? 'Someone'
    this.ctx.emit({ type: 'typing', typing: { conversationId: id, peerName, isTyping } })
  }

  // ---- mapping ----------------------------------------------------------

  private async toMessage(raw: Api.Message, id: string): Promise<Message> {
    const senderId = raw.senderId?.toString() ?? (raw.out ? this.meId : externalIdOf(id))
    const senderName = raw.out ? this.account.displayName : await this.senderName(senderId, raw)
    const readMax = this.readOutbox.get(id) ?? 0
    const attachments = await this.attachmentsOf(raw)
    const message: Message = {
      id: String(raw.id),
      conversationId: id,
      senderId,
      senderName,
      senderAvatarUrl: raw.out ? this.account.avatarUrl : this.senderAvatars.get(senderId),
      text: raw.message ?? '',
      attachments,
      reactions: reactionsOf(raw),
      sentAt: raw.date * 1000,
      isOutgoing: !!raw.out,
      status: raw.out ? (raw.id <= readMax ? 'read' : 'delivered') : 'delivered',
      edited: !!raw.editDate
    }
    const replyId = raw.replyTo instanceof Api.MessageReplyHeader ? raw.replyTo.replyToMsgId : undefined
    if (replyId) {
      const original = (this.recent.get(id) ?? []).find((m) => m.id === String(replyId))
      message.replyTo = { id: String(replyId), senderName: original?.senderName ?? '', text: original?.text ?? '' }
    }
    return message
  }

  private async senderName(senderId: string, raw: Api.Message): Promise<string> {
    const cached = this.senderNames.get(senderId)
    if (cached) return cached
    let name = ''
    try {
      const sender = (await raw.getSender()) as Entity | undefined
      if (sender) {
        name = sender instanceof Api.User ? fullName(sender) : sender.title
        if (!this.senderAvatars.has(senderId) && this.senderAvatars.size < 200) {
          this.senderAvatars.set(senderId, undefined)
          void this.profilePhoto(sender).then((url) => url && this.senderAvatars.set(senderId, url))
        }
      }
    } catch {
      /* sender not in cache */
    }
    if (!name) {
      const entity = this.entities.get(senderId)
      name = entity ? (entity instanceof Api.User ? fullName(entity) : entity.title) : 'Unknown'
    }
    this.senderNames.set(senderId, name)
    return name
  }

  private async attachmentsOf(raw: Api.Message): Promise<Attachment[]> {
    const attachments: Attachment[] = []
    const media = raw.media
    if (!media) return attachments
    if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
      const size = largestSize(media.photo)
      const attachment: Attachment = { id: media.photo.id.toString(), kind: 'image', width: size?.w, height: size?.h }
      attachment.url = await this.downloadThumb(raw)
      attachments.push(attachment)
    } else if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
      const doc = media.document
      const attrs = doc.attributes
      const sticker = attrs.find((a): a is Api.DocumentAttributeSticker => a instanceof Api.DocumentAttributeSticker)
      const video = attrs.find((a): a is Api.DocumentAttributeVideo => a instanceof Api.DocumentAttributeVideo)
      const audio = attrs.find((a): a is Api.DocumentAttributeAudio => a instanceof Api.DocumentAttributeAudio)
      const filename = attrs.find((a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename)
      const kind: Attachment['kind'] = sticker ? 'sticker' : video ? 'video' : audio ? 'audio' : 'file'
      const attachment: Attachment = {
        id: doc.id.toString(),
        kind,
        name: sticker ? sticker.alt : (filename?.fileName ?? (audio ? 'Voice message' : 'File')),
        size: Number(doc.size),
        width: video?.w,
        height: video?.h,
        duration: audio?.duration ?? video?.duration,
        gif: attrs.some((a) => a instanceof Api.DocumentAttributeAnimated) || undefined
      }
      if (sticker && doc.mimeType === 'image/webp') attachment.url = await this.downloadThumb(raw)
      if (video && !video.roundMessage) attachment.thumbnailUrl = await this.downloadThumb(raw)
      attachments.push(attachment)
    } else if (media instanceof Api.MessageMediaWebPage && media.webpage instanceof Api.WebPage) {
      attachments.push({ id: media.webpage.id.toString(), kind: 'link', url: media.webpage.url, name: media.webpage.title })
    }
    return attachments
  }

  private async downloadThumb(raw: Api.Message): Promise<string | undefined> {
    try {
      const buffer = (await this.requireClient().downloadMedia(raw, { thumb: 1 })) as Buffer | undefined
      return buffer?.length ? `data:image/jpeg;base64,${buffer.toString('base64')}` : undefined
    } catch {
      return undefined
    }
  }

  private async profilePhoto(entity: Entity, big = false): Promise<string | undefined> {
    try {
      const buffer = (await this.requireClient().downloadProfilePhoto(entity, { isBig: big })) as Buffer | undefined
      return buffer?.length ? `data:image/jpeg;base64,${buffer.toString('base64')}` : undefined
    } catch {
      return undefined
    }
  }

  private remember(id: string, messages: Message[]): void {
    const list = this.recent.get(id) ?? []
    for (const message of messages) {
      const index = list.findIndex((m) => m.id === message.id)
      if (index >= 0) list[index] = message
      else list.push(message)
      if (!message.isOutgoing) this.senderNames.set(message.senderId, message.senderName)
    }
    list.sort((a, b) => Number(a.id) - Number(b.id))
    this.recent.set(id, list.slice(-200))
  }

  private async entityFor(id: string): Promise<Entity> {
    const externalId = externalIdOf(id)
    const cached = this.entities.get(externalId)
    if (cached) return cached
    const entity = (await this.requireClient().getEntity(externalId)) as Entity
    this.entities.set(externalId, entity)
    return entity
  }

  private prompt(kind: 'phone' | 'code' | 'password'): Promise<string> {
    this.setStatus('needs_auth')
    return this.ctx.requestAuth(kind)
  }

  private requireClient(): TelegramClient {
    if (!this.client) throw new Error('Telegram is not connected')
    return this.client
  }

  private setStatus(status: Account['status'], error?: string): void {
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
}

function fullName(user: Api.User): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Telegram user'
}

function usernameOf(entity: Entity): string | undefined {
  return 'username' in entity && entity.username ? `@${entity.username}` : undefined
}

/** A user's phone, which Telegram shares for your contacts (without the "+"). */
function phoneOf(entity: Entity): string | undefined {
  return 'phone' in entity && entity.phone ? `+${entity.phone}` : undefined
}

function peerToId(peer: Api.TypePeer | undefined): string | undefined {
  if (!peer) return undefined
  if (peer instanceof Api.PeerUser) return peer.userId.toString()
  if (peer instanceof Api.PeerChat) return `-${peer.chatId}`
  if (peer instanceof Api.PeerChannel) return `-100${peer.channelId}`
  return undefined
}

function largestSize(photo: Api.Photo): { w: number; h: number } | undefined {
  let best: { w: number; h: number } | undefined
  for (const size of photo.sizes) {
    if ('w' in size && 'h' in size) {
      if (!best || size.w > best.w) best = { w: size.w, h: size.h }
    }
  }
  return best
}

function reactionsOf(raw: Api.Message): Reaction[] {
  const results = raw.reactions?.results ?? []
  return results
    .map((r) => ({
      emoji: r.reaction instanceof Api.ReactionEmoji ? r.reaction.emoticon : '',
      count: r.count,
      byMe: r.chosenOrder !== undefined && r.chosenOrder !== null
    }))
    .filter((r) => r.emoji)
}

function describeAttachments(attachments: Attachment[]): string {
  // kept local: Telegram previews add the sticker emoji
  const first = attachments[0]
  if (!first) return ''
  switch (first.kind) {
    case 'image':
      return 'Photo'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Voice message'
    case 'sticker':
      return `${first.name ?? ''} Sticker`.trim()
    case 'link':
      return first.name ?? first.url ?? 'Link'
    default:
      return first.name ?? 'File'
  }
}
