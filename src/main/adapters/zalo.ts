import { readFile, writeFile } from 'fs/promises'
import { isStrangerChat } from '@shared/inbox'
import { join } from 'path'
import type { API, Credentials, Message as ZMessage, MessageContent, TMessage, GroupInfo, User, Reaction as ZReaction } from 'zca-js'
import type { Account, Attachment, Conversation, ConversationStats, Message, Peer, PeerProfile, SendOptions, SharedKind } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf, isShared, matchesQuery, previewOf, statsOf, unsentCopy } from './types'
import { tally, zaloCode, zaloEmoji } from '@shared/reactions'
import { imageMetadata } from '../media/image-size'
import { outgoingStickerGif } from '../media/sticker-gif'
import { sendPhotoSticker } from './zalo-photo-sticker'
import { nextSyncStep, type SyncCursor, type SyncWalk } from './zalo-sync'
import { VIDEO_FILE } from '@shared/media'

export interface ZaloSecret {
  credentials?: Credentials
}

type ZcaModule = typeof import('zca-js')

/** Messages kept per chat (memory and the cache on disk). */
const HISTORY_LIMIT = 1000

/** My own reactions are kept under this key (Zalo marks them isSelf; uidFrom can be "0"). */
const ME = 'me'

/**
 * Zalo personal account through the Zalo Web protocol (zca-js). Sign in by
 * scanning a QR code with the Zalo app, as on chat.zalo.me.
 */
export class ZaloAdapter implements PlatformAdapter {
  readonly account: Account
  private zca?: ZcaModule
  private api?: API
  private meId = ''
  /** Profiles of everyone met: friends, group members, strangers who wrote. */
  private friends = new Map<string, User>()
  /** Actual Zalo friends (from the friend list), which `friends` above is not limited to. */
  private friendIds = new Set<string>()
  private friendsKnown = false
  /** One-to-one chats you opened yourself from the contact list: never a message request. */
  private startedByMe = new Set<string>()
  private groups = new Map<string, GroupInfo>()
  private names = new Map<string, string>()
  /**
   * Reactions as Zalo keeps them: one per person per message (thread id -> message id -> person -> code). Kept
   * apart from the converted messages, which are rebuilt whenever history pages arrive, and saved with the cache.
   */
  private reacts = new Map<string, Map<string, Record<string, string>>>()
  private avatars = new Map<string, string>()
  private raw = new Map<string, TMessage[]>()
  private converted = new Map<string, Message[]>()
  private threadTypes = new Map<string, 0 | 1>()
  private unread = new Map<string, number>()
  private lastActivity = new Map<string, number>()
  private qrPromptId?: string
  /** Zalo Web has no per-chat history API for 1:1 chats; messages come page by page over the socket (see zalo-sync). */
  private syncWalks: Record<0 | 1, SyncWalk> = { 0: { rounds: 0, jumped: false }, 1: { rounds: 0, jumped: false } }
  private syncCursors: Record<0 | 1, SyncCursor> = { 0: {}, 1: {} }
  private cacheFile = ''
  private groupHistoryGone = false
  private saveTimer?: NodeJS.Timeout
  /** Sticker id -> picture. Zalo only sends the id with a sticker message; the picture is looked up once. */
  private stickerUrls = new Map<number, StickerPicture>()
  private stickerLookups = new Set<number>()
  /** Zalo ended this session (signed out elsewhere or the cookie stopped working); the next sign-in needs a fresh QR. */
  private sessionEnded = false

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
      features: { reply: true, react: true, attachments: true, unsend: true }
    }
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    const zca = (this.zca ??= await import('zca-js'))
    const zalo = new zca.Zalo({ selfListen: true, checkUpdate: false, logging: false, imageMetadataGetter: imageMetadata })
    let api: API
    // A session Zalo ended cannot be revived with the same cookie: signing in again means a new QR.
    if (this.sessionEnded) this.secret = {}
    try {
      if (this.secret.credentials) {
        api = await zalo.login(this.secret.credentials)
      } else {
        api = await this.loginWithQr(zalo, zca)
      }
    } catch (err) {
      if (this.secret.credentials && isRejectedSession(err)) {
        // The saved cookie no longer works (signed out, or signed in elsewhere). Ask for a new QR instead of retrying it.
        this.sessionEnded = true
        this.setStatus('needs_auth', 'Zalo signed this session out')
        throw new Error('Zalo signed this session out. Sign in again with a new QR code.', { cause: err })
      }
      if (this.qrPromptId) this.ctx.dismissAuth(this.qrPromptId)
      this.qrPromptId = undefined
      this.setStatus(this.sessionEnded ? 'needs_auth' : 'error', (err as Error).message)
      throw err
    }
    if (this.qrPromptId) this.ctx.dismissAuth(this.qrPromptId)
    this.qrPromptId = undefined

    const ownId = api.getOwnId()
    if (this.meId && ownId !== this.meId) {
      // Moshi keeps this account's chats under its id; another Zalo account belongs in "Add account".
      this.secret = {}
      this.setStatus('needs_auth', 'Zalo signed this session out')
      throw new Error('That QR was scanned by a different Zalo account. Scan it with the account shown here, or add the other one as a new account.')
    }
    this.api = api
    this.sessionEnded = false
    this.meId = ownId
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
    // Messages synced earlier, so chats are not empty after a restart.
    this.cacheFile = join(this.ctx.dataDir(), `zalo-cache-${this.meId}.json`)
    await this.loadCache()
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
    // Whatever was waiting to be saved goes now (quitting, removing the account).
    if (this.saveTimer) this.saveCache()
  }

  async listConversations(): Promise<Conversation[]> {
    const api = this.requireApi()
    const [friends, groupList] = await Promise.all([api.getAllFriends(), api.getAllGroups()])
    this.friendIds = new Set(friends.map((f) => f.userId))
    this.friendsKnown = true
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
    await this.discoverStrangers(api)
    return this.buildConversations()
  }

  /**
   * One-to-one chats with people who are not friends (message requests, shops, a buyer who found you in a group)
   * only have history in the cache: look up who they are, the most recent first, so they show up at start.
   */
  private async discoverStrangers(api: API): Promise<void> {
    const unknown = [...this.raw.keys()]
      .filter((threadId) => this.threadTypes.get(threadId) === 0 && !this.friends.has(threadId) && !this.groups.has(threadId))
      .sort((a, b) => (this.lastActivity.get(b) ?? 0) - (this.lastActivity.get(a) ?? 0))
      .slice(0, 30)
    if (!unknown.length) return
    try {
      const info = await api.getUserInfo(unknown)
      for (const [userId, user] of Object.entries(info.changed_profiles)) {
        this.friends.set(userId, user)
        this.names.set(userId, user.displayName || user.zaloName)
        if (user.avatar) this.avatars.set(userId, user.avatar)
      }
    } catch (err) {
      this.ctx.log('zalo stranger lookup failed', (err as Error).message)
    }
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
    const history = this.messagesFor(id)
    const last = history.at(-1)
    // Only real message times: a friend's lastActionTime is when they were last online, not when you talked.
    const activity = this.lastActivity.get(threadId) ?? 0
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
          : [{ id: threadId, name: friend?.displayName ?? '', handle: friend?.username ? `@${friend.username}` : undefined, avatarUrl: friend?.avatar, phone: friend?.phoneNumber || undefined }])
      ],
      unreadCount: this.unread.get(threadId) ?? 0,
      request: isStrangerChat({
        isGroup,
        friendsKnown: this.friendsKnown,
        isFriend: this.friendIds.has(threadId),
        startedByMe: this.startedByMe.has(threadId),
        youWrote: history.some((m) => m.isOutgoing)
      }),
      lastMessage: last && previewOf(last),
      updatedAt: last?.sentAt ?? (activity > 1e12 ? activity : activity * 1000)
    }
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const threadId = externalIdOf(id)
    if (this.threadTypes.get(threadId) === 1 && !this.raw.get(threadId)?.length && !this.groupHistoryGone) {
      try {
        const history = await this.requireApi().getGroupChatHistory(threadId, Math.max(limit, 50))
        this.remember(threadId, history.groupMsgs.map((m) => m.data))
      } catch (err) {
        // Zalo retired this endpoint for web sessions (404); stop asking until the next start.
        if (/404/.test((err as Error).message)) this.groupHistoryGone = true
        this.ctx.log('zalo group history failed', (err as Error).message)
      }
    }
    const all = this.messagesFor(id, true)
    const end = beforeId ? all.findIndex((m) => m.id === beforeId) : all.length
    if (end < 0) return []
    return all.slice(Math.max(0, end - limit), end)
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    this.requireApi()
    const threadId = externalIdOf(id)
    const type = this.threadTypes.get(threadId) ?? 0
    const quoteRaw = options.replyToId ? this.rawMessage(threadId, options.replyToId) : undefined
    const content = async (): Promise<MessageContent> => ({
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
      attachments: options.attachments?.length ? await Promise.all(options.attachments.map((a) => this.uploadPath(a))) : undefined
    })
    const msgId = (await this.trySendPhotoSticker(threadId, text, options, !!quoteRaw)) ?? (await this.sendContent(content(), threadId, type))
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

  private async sendContent(content: Promise<MessageContent>, threadId: string, type: 0 | 1): Promise<string> {
    const result = await this.requireApi().sendMessage(await content, threadId, type)
    return String(result.message?.msgId ?? result.attachment[0]?.msgId ?? Date.now())
  }

  /**
   * Unless switched off, a sticker sent on its own goes out as a Zalo photo sticker (no white square on
   * the other side). Undefined when it does not apply or Zalo said no; the caller then sends it the usual way.
   */
  private async trySendPhotoSticker(threadId: string, text: string, options: SendOptions, quoting: boolean): Promise<string | undefined> {
    const [sticker, ...rest] = options.attachments ?? []
    if (this.ctx.settings?.().zaloPhotoStickers === false || !sticker?.sticker || rest.length || text.trim() || quoting) return undefined
    try {
      return await sendPhotoSticker(this.requireApi(), sticker, threadId, this.threadTypes.get(threadId) === 1, this.ctx.log)
    } catch (err) {
      this.ctx.log('zalo photo sticker failed, sending the gif', (err as Error).message)
      return undefined
    }
  }

  /** Stickers go out as a small transparent GIF (see stickerAsGif); everything else as the file itself. */
  private async uploadPath(a: NonNullable<SendOptions['attachments']>[number]): Promise<string> {
    if (!a.sticker) return a.path
    try {
      // Pack stickers go out moving, the same loop Moshi plays; the user's own stickers as they are.
      return await outgoingStickerGif(a)
    } catch (err) {
      this.ctx.log('zalo sticker gif failed, sending the png', (err as Error).message)
      return a.path
    }
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
    if (!text) throw new Error('Zalo can only forward text messages from Moshi')
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

  async listContacts(): Promise<Peer[]> {
    // Friends only: the profile cache also holds strangers who wrote (message requests), not contacts.
    const friends = this.friendsKnown ? [...this.friends.values()].filter((f) => this.friendIds.has(f.userId)) : [...this.friends.values()]
    return friends.map((f) => ({ id: f.userId, name: f.displayName || f.zaloName, handle: f.username ? `@${f.username}` : f.phoneNumber || undefined, avatarUrl: f.avatar || undefined }))
  }

  async openConversation(peerId: string): Promise<Conversation> {
    if (!this.startedByMe.has(peerId)) {
      this.startedByMe.add(peerId)
      this.scheduleSave()
    }
    if (!this.friends.has(peerId)) await this.discoverThread(peerId, 0)
    this.threadTypes.set(peerId, 0)
    return this.toConversation(peerId, false)
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
    // One reaction of mine per message: the same one again takes it off (Zalo's empty reaction removes mine).
    const mine = this.reacts.get(threadId)?.get(messageId)?.[ME]
    const code = zaloCode(emoji)
    if (code === undefined) throw new Error('Zalo does not have this reaction')
    const removing = mine === code
    await this.requireApi().addReaction((removing ? '' : code) as never, {
      data: { msgId: raw.msgId, cliMsgId: raw.cliMsgId },
      threadId,
      type: this.threadTypes.get(threadId) ?? 0
    })
    this.setReaction(threadId, messageId, ME, removing ? '' : code)
    this.refreshReactions(id, [messageId])
    this.scheduleSave()
  }

  /** Who reacted with what on one message, tallied for its bubble. */
  private reactionsOf(threadId: string, msgId: string): Message['reactions'] {
    const byPerson = this.reacts.get(threadId)?.get(msgId)
    if (!byPerson) return []
    const emoji = Object.fromEntries(Object.entries(byPerson).map(([person, code]) => [person, zaloEmoji(code)]))
    return tally(emoji, ME, (person) => this.names.get(person))
  }

  /** One person's reaction on a message (an empty code takes it off). */
  private setReaction(threadId: string, msgId: string, person: string, code: string): void {
    const thread = this.reacts.get(threadId) ?? new Map<string, Record<string, string>>()
    const byPerson = { ...thread.get(msgId) }
    if (code) byPerson[person] = code
    else delete byPerson[person]
    if (Object.keys(byPerson).length) thread.set(msgId, byPerson)
    else thread.delete(msgId)
    this.reacts.set(threadId, thread)
  }

  /** A reaction event (live or from history): returns the messages it touched. */
  private applyReaction(reaction: ZReaction): string[] {
    const person = reaction.isSelf ? ME : String(reaction.data.uidFrom)
    if (!reaction.isSelf && reaction.data.dName) this.names.set(person, reaction.data.dName)
    const code = reaction.data.content.rIcon ?? ''
    return reaction.data.content.rMsg.map((target) => {
      const msgId = String(target.gMsgID)
      this.setReaction(reaction.threadId, msgId, person, code)
      return msgId
    })
  }

  /** Loaded messages whose reactions changed get them again, and the window hears of it. */
  private refreshReactions(id: string, msgIds: string[]): void {
    const threadId = externalIdOf(id)
    const loaded = this.converted.get(id) ?? []
    for (const msgId of new Set(msgIds)) {
      const message = loaded.find((m) => m.id === msgId)
      if (!message) continue
      message.reactions = this.reactionsOf(threadId, msgId)
      this.ctx.emit({ type: 'message:updated', message: { ...message } })
    }
  }

  async unsend(id: string, messageId: string): Promise<void> {
    const threadId = externalIdOf(id)
    const raw = this.rawMessage(threadId, messageId)
    if (!raw) throw new Error('Message not found')
    await this.requireApi().undo({ msgId: raw.msgId, cliMsgId: raw.cliMsgId }, threadId, this.threadTypes.get(threadId) ?? 0)
    this.markUnsent(id, messageId)
  }

  /** A recalled message (by me, or by them) stays in the chat as "unsent". */
  private markUnsent(id: string, messageId: string): void {
    const list = this.converted.get(id)
    const index = list?.findIndex((m) => m.id === messageId) ?? -1
    if (!list || index < 0 || list[index].unsent) return
    list[index] = unsentCopy(list[index])
    this.ctx.emit({ type: 'message:updated', message: { ...list[index] } })
  }

  // ---- events -----------------------------------------------------------

  private wireListener(api: API, _zca: ZcaModule): void {
    // History can only be requested once the socket has its cipher key (replies are encrypted with it).
    api.listener.on('cipher_key', () => this.startSync(api))
    api.listener.on('message', (message: ZMessage) => {
      const threadId = message.threadId
      this.threadTypes.set(threadId, message.type)
      const known = this.rawMessage(threadId, message.data.msgId)
      this.remember(threadId, [message.data])
      const id = conversationId(this.account.id, threadId)
      const converted = this.toMessage(message.data, id, message.isSelf)
      this.cacheConverted(id, [converted])
      this.lastActivity.set(threadId, converted.sentAt)
      this.scheduleSave()
      if (!known) {
        if (!message.isSelf) this.unread.set(threadId, (this.unread.get(threadId) ?? 0) + 1)
        this.ctx.emit({ type: 'message:new', message: converted })
        if (!this.friends.has(threadId) && !this.groups.has(threadId)) {
          void this.discoverThread(threadId, message.type)
        }
      }
    })
    api.listener.on('old_messages', (messages: ZMessage[], threadType: 0 | 1) => {
      const fresh = messages.filter((m) => !this.rawMessage(m.threadId, m.data.msgId)).length
      this.continueSync(api, messages, fresh, threadType)
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
        this.scheduleSave()
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
      // Kept even when the message is not loaded yet: it shows once it is.
      this.refreshReactions(conversationId(this.account.id, reaction.threadId), this.applyReaction(reaction))
      this.scheduleSave()
    })
    // Reactions from before this session (asked for with the history): oldest first, so the latest one wins.
    api.listener.on('old_reactions', (reactions: ZReaction[]) => {
      const touched = new Map<string, string[]>()
      for (const reaction of [...reactions].sort((a, b) => Number(a.data.ts) - Number(b.data.ts))) {
        const id = conversationId(this.account.id, reaction.threadId)
        touched.set(id, [...(touched.get(id) ?? []), ...this.applyReaction(reaction)])
      }
      for (const [id, msgIds] of touched) this.refreshReactions(id, msgIds)
      if (touched.size) this.scheduleSave()
    })
    api.listener.on('undo', (undo) => {
      this.markUnsent(conversationId(this.account.id, undo.threadId), String(undo.data.content.globalMsgId))
    })
    api.listener.on('error', (err) => this.ctx.log('zalo listener error', err))
    api.listener.on('closed', (code, reason) => {
      this.ctx.log('zalo listener closed', code, reason)
      if (this.api !== api) return
      // 3000: the same session was opened somewhere else; 3003: Zalo kicked it (signed in on another computer).
      if (Number(code) === 3000 || Number(code) === 3003) {
        this.sessionEnded = true
        this.setStatus('needs_auth', 'Signed out from another device')
      }
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
      attachments: attachmentsOf(raw, this.stickerUrlFor(raw)),
      reactions: this.reactionsOf(externalIdOf(id), raw.msgId),
      sentAt: Number(raw.ts),
      isOutgoing: outgoing,
      status: outgoing ? 'delivered' : 'delivered'
    }
    if (raw.quote) {
      message.replyTo = { id: String(raw.quote.globalMsgId), senderName: raw.quote.fromD, text: raw.quote.msg || (raw.quote.attach ? 'Attachment' : '') }
    }
    return message
  }

  /**
   * The picture for a sticker message; undefined while it is still being looked up (the message is updated then).
   * One remembered before sprite sheets were kept (no `frames`) is shown as it is and looked up again once.
   */
  private stickerUrlFor(raw: TMessage): StickerPicture | undefined {
    if (raw.msgType !== 'chat.sticker') return undefined
    const stickerId = stickerIdOf(raw)
    if (!stickerId) return undefined
    const known = this.stickerUrls.get(stickerId)
    if (known?.frames && known.v === STICKER_PICTURE_VERSION) return known
    if (this.api && !this.stickerLookups.has(stickerId)) {
      this.stickerLookups.add(stickerId)
      void this.lookupSticker(stickerId)
    }
    return known
  }

  private async lookupSticker(stickerId: number): Promise<void> {
    try {
      const [detail] = await this.requireApi().getStickersDetail(stickerId)
      const still = detail?.stickerWebpUrl || detail?.stickerUrl
      if (!still) throw new Error('no picture')
      // A moving sticker comes as a sprite sheet (a strip of frames) played over its duration, as Zalo itself does.
      const frames = Number(detail.totalFrames)
      const picture: StickerPicture =
        detail.stickerSpriteUrl && frames > 1
          ? { url: detail.stickerSpriteUrl, frames, duration: loopSeconds(detail.duration, frames), v: STICKER_PICTURE_VERSION }
          : { url: still, frames: 1, v: STICKER_PICTURE_VERSION }
      this.stickerUrls.set(stickerId, picture)
      this.scheduleSave()
      // Every message with this sticker that is already on screen gets its picture.
      for (const [id, list] of this.converted) {
        for (const raw of this.raw.get(externalIdOf(id)) ?? []) {
          if (raw.msgType !== 'chat.sticker' || stickerIdOf(raw) !== stickerId) continue
          const index = list.findIndex((m) => m.id === raw.msgId)
          if (index < 0) continue
          list[index] = { ...list[index], attachments: attachmentsOf(raw, picture) }
          this.ctx.emit({ type: 'message:updated', message: { ...list[index] } })
        }
      }
    } catch (err) {
      this.stickerLookups.delete(stickerId)
      this.ctx.log('zalo sticker lookup failed', String(stickerId), (err as Error).message)
    }
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

  private startSync(api: API): void {
    this.syncWalks = { 0: { rounds: 0, jumped: false }, 1: { rounds: 0, jumped: false } }
    this.ctx.log('zalo: syncing messages', JSON.stringify(this.syncCursors))
    api.listener.requestOldMessages(0)
    api.listener.requestOldMessages(1)
    try {
      api.listener.requestOldReactions(0)
      api.listener.requestOldReactions(1)
    } catch (err) {
      this.ctx.log('zalo: old reactions request failed', (err as Error).message)
    }
  }

  /** After each page: continue below it, skip down to where the last walk stopped, or stop. */
  private continueSync(api: API, messages: ZMessage[], fresh: number, threadType: 0 | 1): void {
    const type = threadType === 1 ? 1 : 0
    const walk = this.syncWalks[type]
    walk.rounds += 1
    const oldest = messages.length ? messages.reduce((a, b) => (Number(a.data.ts) <= Number(b.data.ts) ? a : b)) : undefined
    const { step, cursor } = nextSyncStep(walk, { size: messages.length, fresh, oldestId: oldest?.data.msgId, oldestTs: oldest ? Number(oldest.data.ts) : undefined }, this.syncCursors[type])
    this.syncCursors[type] = cursor
    this.scheduleSave()
    if (step.kind === 'stop') {
      this.ctx.log(`zalo: ${type ? 'group' : 'direct'} sync stopped (${step.reason}) after ${walk.rounds} pages`)
      return
    }
    if (step.below !== oldest?.data.msgId) walk.jumped = true
    walk.askedBelow = step.below
    setTimeout(() => {
      if (this.api !== api) return
      try {
        api.listener.requestOldMessages(type, step.below)
      } catch (err) {
        this.ctx.log('zalo sync request failed', (err as Error).message)
      }
    }, 600)
  }

  private async loadCache(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.cacheFile, 'utf8')) as {
        threads?: Array<[string, 0 | 1, TMessage[]]>
        /** Sticker id -> picture (a bare URL in caches from before sprite sheets were kept). */
        stickers?: Array<[number, string | StickerPicture]>
        sync?: Partial<Record<0 | 1, SyncCursor>>
        /** Chats with non-friends you opened yourself (never message requests). */
        started?: string[]
        /** Thread id -> [message id, person -> reaction code]. */
        reactions?: Array<[string, Array<[string, Record<string, string>]>]>
      }
      for (const [threadId, byMsg] of data.reactions ?? []) this.reacts.set(threadId, new Map(byMsg))
      for (const threadId of data.started ?? []) this.startedByMe.add(threadId)
      for (const [stickerId, picture] of data.stickers ?? []) this.stickerUrls.set(stickerId, typeof picture === 'string' ? { url: picture } : picture)
      this.syncCursors = { 0: data.sync?.[0] ?? {}, 1: data.sync?.[1] ?? {} }
      for (const [threadId, type, list] of data.threads ?? []) {
        this.threadTypes.set(threadId, type)
        this.raw.set(threadId, list)
        const last = list.at(-1)
        if (last) this.lastActivity.set(threadId, Math.max(this.lastActivity.get(threadId) ?? 0, Number(last.ts)))
      }
    } catch {
      /* first run */
    }
  }

  /**
   * Saved at most every 15 s (and on disconnect): the whole cache is rewritten each time, and every message or
   * reaction used to trigger it 2 s later.
   */
  private scheduleSave(): void {
    if (!this.cacheFile || this.saveTimer) return
    this.saveTimer = setTimeout(() => this.saveCache(), 15_000)
  }

  private saveCache(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    if (!this.cacheFile) return
    const threads = [...this.raw.entries()].map(([threadId, list]) => [threadId, this.threadTypes.get(threadId) ?? 0, list])
    // Reactions only for messages still kept (the rest would never show again).
    const reactions = [...this.reacts.entries()].map(([threadId, byMsg]) => {
      const kept = new Set((this.raw.get(threadId) ?? []).map((m) => m.msgId))
      return [threadId, [...byMsg.entries()].filter(([msgId]) => kept.has(msgId))] as const
    })
    void writeFile(this.cacheFile, JSON.stringify({ version: 1, threads, stickers: [...this.stickerUrls], sync: this.syncCursors, started: [...this.startedByMe], reactions })).catch((err) =>
      this.ctx.log('zalo cache save failed', (err as Error).message)
    )
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

/** zca-js rejects a dead cookie with its own login errors; anything else (offline, timeouts) is worth retrying as is. */
function isRejectedSession(err: unknown): boolean {
  const message = (err as Error)?.message ?? ''
  return (err as Error)?.name === 'ZcaApiError' || /Đăng nhập thất bại|Khởi tạo ngữ cảnh/i.test(message)
}

function textOf(raw: TMessage): string {
  if (typeof raw.content === 'string') return raw.content
  if (raw.content && typeof raw.content === 'object') {
    const c = raw.content as { title?: string; description?: string; text?: string }
    // Media and files say what they are in their own card; their title is the file name, not words to show twice.
    if (['chat.photo', 'chat.video.msg', 'chat.sticker', 'chat.voice', 'chat.gif', 'share.file', 'chat.file'].includes(raw.msgType)) return ''
    return c.text ?? c.title ?? ''
  }
  return ''
}

function stickerIdOf(raw: TMessage): number | undefined {
  if (typeof raw.content !== 'object' || !raw.content) return undefined
  const c = raw.content as { id?: number | string; stickerId?: number | string }
  const n = Number(c.id ?? c.stickerId)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** A Zalo sticker's picture: a still image, or a sprite sheet of `frames` frames over `duration` seconds. */
interface StickerPicture {
  url: string
  /** Absent: remembered before sprite sheets were kept, so worth looking up again. */
  frames?: number
  duration?: number
  /** Pictures from an older way of reading Zalo's answer (or none) are looked up again. */
  v?: number
}
const STICKER_PICTURE_VERSION = 2

/** Seconds one loop of a sprite sticker takes. Zalo's duration is per frame (milliseconds), 250 when it has none. */
export function loopSeconds(duration: unknown, frames: number): number {
  const perFrame = Number(duration) > 0 ? Number(duration) : 250
  return (perFrame * frames) / 1000
}

/** A photo sticker (made from a picture, an AI sticker, one from Zalo's photo sticker search): drawn borderless. */
function isPhotoSticker(raw: TMessage): boolean {
  const ext = typeof raw.propertyExt === 'string' ? paramsOf(raw.propertyExt) : (raw.propertyExt as Record<string, unknown> | undefined)
  return raw.msgType === 'chat.photo' && Number(ext?.type) === 3
}

function attachmentsOf(raw: TMessage, sticker?: StickerPicture): Attachment[] {
  if (typeof raw.content !== 'object' || !raw.content) return []
  const c = raw.content as { href?: string; thumb?: string; title?: string; description?: string; params?: string; type?: string }
  const id = `${raw.msgId}-a`
  const p = paramsOf(c.params)
  // Width and height let the bubble keep its place while the picture loads.
  const box = Number(p.width) > 0 && Number(p.height) > 0 ? { width: Number(p.width), height: Number(p.height) } : {}
  switch (raw.msgType) {
    case 'chat.photo': {
      // A photo sticker moves in its WebP; the photo itself is the still (and is all an older sticker has).
      const webp = (p.webp as { url?: string } | undefined)?.url
      if (isPhotoSticker(raw)) return [{ id, kind: 'sticker', name: '', url: webp || c.href, ...box }]
      return [{ id, kind: 'image', url: c.href, thumbnailUrl: c.thumb, ...box }]
    }
    case 'chat.video.msg':
      return [{ id, kind: 'video', url: c.href, thumbnailUrl: c.thumb, ...box, ...(Number(p.duration) > 0 ? { duration: Number(p.duration) / 1000 } : {}) }]
    case 'chat.voice':
      return [{ id, kind: 'audio', url: c.href, name: 'Voice message' }]
    case 'chat.sticker':
      return [{ id, kind: 'sticker', name: '', url: sticker?.url, ...(sticker?.frames && sticker.frames > 1 ? { frames: sticker.frames, duration: sticker.duration } : {}) }]
    case 'chat.gif':
      return [{ id, kind: 'image', url: c.href, thumbnailUrl: c.thumb, ...box }]
    case 'share.file':
    case 'chat.file': {
      const name = c.title ?? 'File'
      // A video sent as a file (from a computer, or "send as file" on the phone) still gets a player.
      if (VIDEO_FILE.test(name) || /^(mp4|m4v|mov|webm)$/i.test(String(p.fileExt ?? ''))) return [{ id, kind: 'video', url: c.href, thumbnailUrl: c.thumb || undefined, name, size: sizeFrom(c.params) }]
      return [{ id, kind: 'file', url: c.href, name, size: sizeFrom(c.params) }]
    }
    case 'chat.recommended':
      return [{ id, kind: 'link', url: c.href, name: c.title ?? c.href }]
    default:
      return c.href ? [{ id, kind: 'link', url: c.href, name: c.title ?? c.href }] : []
  }
}

/** Zalo's attachment params (a JSON string), or nothing. */
function paramsOf(params?: string): Record<string, unknown> {
  if (!params || params[0] !== '{') return {}
  try {
    return JSON.parse(params) as Record<string, unknown>
  } catch {
    return {}
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
