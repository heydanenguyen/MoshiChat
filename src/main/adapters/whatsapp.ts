import { randomUUID } from 'crypto'
import { join } from 'path'
import { mkdirSync } from 'fs'
import type { proto, WAMessage, Chat, Contact, WASocket } from '@whiskeysockets/baileys'
import type { Account, Attachment, Conversation, ConversationStats, Message, Peer, PeerProfile, Reaction, SendOptions, SharedKind } from '@shared/types'
import { ALL_FEATURES } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf, isShared, matchesQuery, previewOf, statsOf } from './types'

export interface WhatsAppSecret {
  /** Folder name (under the adapter data dir) that holds the signal keys. */
  authDir: string
}

type Baileys = typeof import('@whiskeysockets/baileys')

const HISTORY_LIMIT = 300

/**
 * WhatsApp through the multi-device web protocol (Baileys). Pair by scanning a
 * QR code with the phone, exactly like WhatsApp Desktop. History arrives via
 * the phone's history sync, so the inbox fills in over the first minute.
 */
export class WhatsAppAdapter implements PlatformAdapter {
  readonly account: Account
  private lib?: Baileys
  private sock?: WASocket
  private chats = new Map<string, Chat>()
  private contacts = new Map<string, Contact>()
  private groupNames = new Map<string, string>()
  private history = new Map<string, WAMessage[]>()
  private converted = new Map<string, Message[]>()
  private avatars = new Map<string, string | undefined>()
  private meJid = ''
  private mePhone = ''
  private qrPromptId?: string
  private closing = false
  private resetTimer?: NodeJS.Timeout
  private historyWaiters = new Map<string, () => void>()

  constructor(
    initialId: string,
    private secret: WhatsAppSecret,
    private readonly ctx: AdapterContext
  ) {
    this.account = { id: initialId, platform: 'whatsapp', displayName: 'WhatsApp', status: 'disconnected', features: ALL_FEATURES }
  }

  async connect(): Promise<void> {
    this.closing = false
    this.setStatus('connecting')
    const lib = (this.lib ??= await import('@whiskeysockets/baileys'))
    const dir = join(this.ctx.dataDir(), this.secret.authDir)
    mkdirSync(dir, { recursive: true })
    const { state, saveCreds } = await lib.useMultiFileAuthState(dir)
    const pino = (await import('pino')).default
    const logger = pino({ level: 'silent' })
    const sock = lib.makeWASocket({
      auth: { creds: state.creds, keys: lib.makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      browser: lib.Browsers.macOS('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    })
    this.sock = sock
    sock.ev.on('creds.update', saveCreds)
    this.wireEvents(sock, lib)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const done = (err?: Error): void => {
        if (settled) return
        settled = true
        err ? reject(err) : resolve()
      }
      sock.ev.on('connection.update', (update) => {
        if (update.qr) void this.showQr(update.qr, () => done(new Error('Sign-in cancelled')))
        if (update.connection === 'open') {
          if (this.qrPromptId) this.ctx.dismissAuth(this.qrPromptId)
          this.qrPromptId = undefined
          done()
        }
        if (update.connection === 'close') {
          const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
          if (!settled) {
            if (code === lib.DisconnectReason.restartRequired) {
              // Pairing finished; Baileys asks for a fresh socket.
              settled = true
              void this.connect().then(resolve, reject)
            } else if (code === lib.DisconnectReason.loggedOut) {
              done(new Error('WhatsApp session was logged out'))
            } else {
              done(new Error(`WhatsApp connection closed (${code ?? 'unknown'})`))
            }
          } else if (!this.closing) {
            if (code === lib.DisconnectReason.loggedOut) this.setStatus('error', 'Logged out on the phone')
            else setTimeout(() => void this.connect().catch(() => undefined), 3000)
          }
        }
      })
    })

    const me = sock.user
    if (me) {
      this.meJid = lib.jidNormalizedUser(me.id)
      this.mePhone = this.meJid.split('@')[0]
      this.account.id = `whatsapp:${this.mePhone}`
      this.account.displayName = me.name || `+${this.mePhone}`
      this.account.handle = `+${this.mePhone}`
      await this.ctx.saveSecret(this.secret)
      void sock.profilePictureUrl(this.meJid, 'image').then((url) => {
        if (url) {
          this.account.avatarUrl = url
          this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
        }
      }).catch(() => undefined)
    }
    this.setStatus('connected')
  }

  async disconnect(): Promise<void> {
    this.closing = true
    this.sock?.end(undefined)
    this.sock = undefined
    this.setStatus('disconnected')
  }

  async listConversations(): Promise<Conversation[]> {
    const list = [...this.chats.values()]
      .filter((c) => c.id && !c.id.endsWith('@broadcast') && !c.id.endsWith('@newsletter'))
      .map((c) => this.toConversation(c))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    void this.hydrateAvatars(list.slice(0, 30))
    return list
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const jid = externalIdOf(id)
    let all = this.messagesFor(id)
    if (beforeId) {
      const index = all.findIndex((m) => m.id === beforeId)
      if (index <= 0 || index < limit) {
        // Ask the phone for older history and wait briefly for it to arrive.
        const oldest = (this.history.get(jid) ?? [])[0]
        if (oldest?.key && this.sock) {
          try {
            const waited = new Promise<void>((resolve) => {
              this.historyWaiters.set(jid, resolve)
              setTimeout(resolve, 6000)
            })
            await this.sock.fetchMessageHistory(limit, oldest.key, Number(oldest.messageTimestamp ?? 0))
            await waited
          } catch {
            /* history unavailable */
          } finally {
            this.historyWaiters.delete(jid)
          }
          all = this.messagesFor(id, true)
        }
      }
      const end = all.findIndex((m) => m.id === beforeId)
      if (end < 0) return []
      return all.slice(Math.max(0, end - limit), end)
    }
    return all.slice(-limit)
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    const sock = this.requireSock()
    const jid = externalIdOf(id)
    const quoted = options.replyToId ? this.rawMessage(jid, options.replyToId) : undefined
    const misc = quoted ? { quoted } : undefined
    let sent: WAMessage | undefined
    const files = options.attachments ?? []
    for (const [index, file] of files.entries()) {
      const caption = index === files.length - 1 ? text : undefined
      if (file.voice) sent = await sock.sendMessage(jid, { audio: { url: file.path }, ptt: true, mimetype: 'audio/ogg; codecs=opus', seconds: file.duration }, misc)
      else if (file.gif && file.alternates?.some((alt) => alt.mime === 'video/mp4')) {
        const mp4 = file.alternates.find((alt) => alt.mime === 'video/mp4')!
        sent = await sock.sendMessage(jid, { video: { url: mp4.path }, gifPlayback: true, caption }, misc)
      } else if (file.mime.startsWith('image/')) sent = await sock.sendMessage(jid, { image: { url: file.path }, caption }, misc)
      else if (file.mime.startsWith('video/')) sent = await sock.sendMessage(jid, { video: { url: file.path }, caption }, misc)
      else sent = await sock.sendMessage(jid, { document: { url: file.path }, mimetype: file.mime, fileName: file.name, caption }, misc)
    }
    if (!files.length) sent = await sock.sendMessage(jid, { text }, misc)
    if (!sent) throw new Error('WhatsApp did not return the sent message')
    this.remember(jid, [sent])
    const message = await this.toMessage(sent, id)
    this.cacheConverted(id, [message])
    return message
  }

  async markRead(id: string): Promise<void> {
    const sock = this.requireSock()
    const jid = externalIdOf(id)
    const unread = (this.history.get(jid) ?? []).filter((m) => !m.key.fromMe).slice(-20).map((m) => m.key)
    if (unread.length) await sock.readMessages(unread).catch(() => undefined)
    const chat = this.chats.get(jid)
    if (chat) chat.unreadCount = 0
  }

  async setTyping(id: string): Promise<void> {
    await this.requireSock().sendPresenceUpdate('composing', externalIdOf(id)).catch(() => undefined)
  }

  async forward(fromId: string, messageId: string, toId: string): Promise<Message> {
    const raw = this.rawMessage(externalIdOf(fromId), messageId)
    if (!raw) throw new Error('Message not found')
    const toJid = externalIdOf(toId)
    const sent = await this.requireSock().sendMessage(toJid, { forward: raw })
    if (!sent) throw new Error('WhatsApp did not return the forwarded message')
    this.remember(toJid, [sent])
    const message = await this.toMessage(sent, toId)
    this.cacheConverted(toId, [message])
    return message
  }

  async searchMessages(query: string, limit: number): Promise<Message[]> {
    const needle = query.toLowerCase()
    const hits: Message[] = []
    for (const jid of this.history.keys()) {
      const id = conversationId(this.account.id, jid)
      for (const message of this.messagesFor(id)) if (matchesQuery(message, needle)) hits.push(message)
    }
    return hits.sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  async downloadAttachment(id: string, messageId: string): Promise<string | undefined> {
    const raw = this.rawMessage(externalIdOf(id), messageId)
    if (!raw || !this.lib) return undefined
    const content = this.lib.normalizeMessageContent(raw.message)
    const media = content?.imageMessage ?? content?.videoMessage ?? content?.audioMessage ?? content?.documentMessage ?? content?.stickerMessage
    if (!media) return undefined
    if (Number(media.fileLength ?? 0) > 25_000_000) return undefined
    try {
      const buffer = await this.lib.downloadMediaMessage(raw, 'buffer', {})
      return `data:${media.mimetype ?? 'application/octet-stream'};base64,${buffer.toString('base64')}`
    } catch {
      return undefined
    }
  }

  async getPeerProfile(id: string): Promise<PeerProfile | undefined> {
    const sock = this.requireSock()
    const jid = externalIdOf(id)
    const isGroup = jid.endsWith('@g.us')
    let avatarUrl: string | undefined
    try {
      avatarUrl = await sock.profilePictureUrl(jid, 'image', 6000)
    } catch {
      /* private or none */
    }
    let bio: string | undefined
    if (!isGroup) {
      try {
        const status = await sock.fetchStatus(jid)
        const first = status?.[0] as { status?: { status?: string | null } } | undefined
        bio = first?.status?.status ?? undefined
      } catch {
        /* status hidden */
      }
    }
    const extra: PeerProfile['extra'] = []
    if (isGroup) {
      try {
        const meta = await sock.groupMetadata(jid)
        extra.push({ label: 'Members', value: String(meta.participants.length) })
        if (meta.desc) bio = meta.desc
        this.groupNames.set(jid, meta.subject)
      } catch {
        /* not a member any more */
      }
    }
    return {
      id: jid,
      name: this.chats.get(jid)?.name || this.groupNames.get(jid) || this.nameOf(jid),
      handle: isGroup ? undefined : `+${jid.split('@')[0]}`,
      avatarUrl,
      bio,
      phone: isGroup ? undefined : `+${jid.split('@')[0]}`,
      extra
    }
  }

  async listShared(id: string, kind: SharedKind, limit: number): Promise<Message[]> {
    return this.messagesFor(id).filter((m) => isShared(m, kind)).sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  async listContacts(): Promise<Peer[]> {
    const peers: Peer[] = []
    for (const contact of this.contacts.values()) {
      if (!contact.id.endsWith('@s.whatsapp.net') || this.lib?.areJidsSameUser(contact.id, this.meJid)) continue
      const name = contact.name ?? contact.verifiedName ?? contact.notify
      if (!name) continue
      peers.push({ id: contact.id, name, handle: `+${contact.id.split('@')[0]}`, avatarUrl: this.avatars.get(contact.id) })
    }
    return peers
  }

  async openConversation(peerId: string): Promise<Conversation> {
    const chat = this.chats.get(peerId)
    if (chat) return this.toConversation(chat)
    const id = conversationId(this.account.id, peerId)
    const name = this.nameOf(peerId)
    return {
      id,
      accountId: this.account.id,
      platform: 'whatsapp',
      title: name,
      avatarUrl: this.avatars.get(peerId),
      isGroup: false,
      participants: [
        { id: this.meJid, name: this.account.displayName, isMe: true },
        { id: peerId, name, handle: `+${peerId.split('@')[0]}` }
      ],
      unreadCount: 0,
      updatedAt: Date.now()
    }
  }

  async getConversationStats(id: string): Promise<ConversationStats> {
    return statsOf(this.messagesFor(id))
  }

  async searchInConversation(id: string, query: string, limit: number): Promise<Message[]> {
    const needle = query.toLowerCase()
    return this.messagesFor(id).filter((m) => matchesQuery(m, needle)).sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  async react(id: string, messageId: string, emoji: string): Promise<void> {
    const jid = externalIdOf(id)
    const raw = this.rawMessage(jid, messageId)
    if (!raw) throw new Error('Message not found')
    const mine = (this.converted.get(id) ?? []).find((m) => m.id === messageId)?.reactions.find((r) => r.emoji === emoji && r.byMe)
    await this.requireSock().sendMessage(jid, { react: { text: mine ? '' : emoji, key: raw.key } })
  }

  // ---- events -----------------------------------------------------------

  private wireEvents(sock: WASocket, lib: Baileys): void {
    sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
      for (const contact of contacts) this.contacts.set(contact.id, { ...this.contacts.get(contact.id), ...contact })
      for (const chat of chats) if (chat.id) this.chats.set(chat.id, { ...this.chats.get(chat.id), ...chat })
      const touched = new Set<string>()
      for (const message of messages) {
        const jid = message.key.remoteJid
        if (!jid) continue
        this.remember(jid, [message])
        touched.add(jid)
      }
      for (const jid of touched) {
        this.converted.delete(conversationId(this.account.id, jid))
        this.historyWaiters.get(jid)?.()
      }
      this.scheduleReset()
    })
    sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) if (chat.id) this.chats.set(chat.id, { ...this.chats.get(chat.id), ...chat })
      this.scheduleReset()
    })
    sock.ev.on('chats.update', (updates) => {
      for (const update of updates) {
        if (!update.id) continue
        const chat = this.chats.get(update.id)
        if (chat) Object.assign(chat, update)
      }
      this.scheduleReset()
    })
    sock.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) this.contacts.set(contact.id, { ...this.contacts.get(contact.id), ...contact })
    })
    sock.ev.on('contacts.update', (contacts) => {
      for (const contact of contacts) if (contact.id) this.contacts.set(contact.id, { ...this.contacts.get(contact.id), ...contact } as Contact)
    })
    sock.ev.on('groups.upsert', (groups) => {
      for (const g of groups) this.groupNames.set(g.id, g.subject)
    })
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      void (async () => {
        for (const raw of messages) {
          const jid = raw.key.remoteJid
          if (!jid || jid === 'status@broadcast') continue
          if (raw.message?.reactionMessage) {
            this.applyReaction(jid, raw.message.reactionMessage, !!raw.key.fromMe)
            continue
          }
          if (raw.message?.protocolMessage) continue
          this.remember(jid, [raw])
          if (!this.chats.has(jid)) this.chats.set(jid, { id: jid, conversationTimestamp: Number(raw.messageTimestamp) } as Chat)
          const chat = this.chats.get(jid)!
          chat.conversationTimestamp = Number(raw.messageTimestamp ?? 0)
          if (type === 'notify') {
            const id = conversationId(this.account.id, jid)
            const message = await this.toMessage(raw, id)
            this.cacheConverted(id, [message])
            this.ctx.emit({ type: 'message:new', message })
          }
        }
        if (type !== 'notify') this.scheduleReset()
      })()
    })
    sock.ev.on('messages.update', (updates) => {
      for (const { key, update } of updates) {
        const jid = key.remoteJid
        if (!jid || !key.id || update.status === undefined) continue
        const id = conversationId(this.account.id, jid)
        const raw = this.rawMessage(jid, key.id)
        if (raw) raw.status = update.status ?? raw.status
        const message = (this.converted.get(id) ?? []).find((m) => m.id === key.id)
        if (message) {
          message.status = statusOf(update.status ?? undefined, true)
          this.ctx.emit({ type: 'message:updated', message: { ...message } })
        }
      }
    })
    sock.ev.on('messages.reaction', (reactions) => {
      for (const { key, reaction } of reactions) {
        if (key.remoteJid) this.applyReaction(key.remoteJid, { key, text: reaction.text }, lib.areJidsSameUser(reaction.key?.participant ?? reaction.key?.remoteJid ?? '', this.meJid) || !!reaction.key?.fromMe)
      }
    })
    sock.ev.on('presence.update', ({ id, presences }) => {
      for (const [participant, data] of Object.entries(presences)) {
        if (lib.areJidsSameUser(participant, this.meJid)) continue
        const isTyping = data.lastKnownPresence === 'composing' || data.lastKnownPresence === 'recording'
        this.ctx.emit({
          type: 'typing',
          typing: { conversationId: conversationId(this.account.id, id), peerName: this.nameOf(participant), isTyping }
        })
      }
    })
  }

  private scheduleReset(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer)
    this.resetTimer = setTimeout(() => {
      this.resetTimer = undefined
      void this.listConversations().then((list) =>
        this.ctx.emit({ type: 'conversations:reset', accountId: this.account.id, conversations: list })
      )
    }, 800)
  }

  private applyReaction(jid: string, reaction: proto.Message.IReactionMessage, byMe: boolean): void {
    const targetId = reaction.key?.id
    if (!targetId) return
    const id = conversationId(this.account.id, jid)
    const message = (this.converted.get(id) ?? []).find((m) => m.id === targetId)
    if (!message) return
    const emoji = reaction.text ?? ''
    let reactions = message.reactions.slice()
    if (byMe) reactions = reactions.map((r) => (r.byMe ? { ...r, count: r.count - 1, byMe: false } : r)).filter((r) => r.count > 0)
    if (emoji) {
      const existing = reactions.find((r) => r.emoji === emoji)
      if (existing) {
        existing.count += 1
        existing.byMe = existing.byMe || byMe
      } else reactions.push({ emoji, count: 1, byMe })
    }
    message.reactions = reactions
    this.ctx.emit({ type: 'message:updated', message: { ...message } })
  }

  // ---- mapping ----------------------------------------------------------

  private toConversation(chat: Chat): Conversation {
    const jid = chat.id as string
    const id = conversationId(this.account.id, jid)
    const isGroup = jid.endsWith('@g.us')
    const raw = (this.history.get(jid) ?? []).at(-1)
    const last = raw ? this.toMessageSync(raw, id) : undefined
    const title = chat.name || this.groupNames.get(jid) || this.nameOf(jid)
    return {
      id,
      accountId: this.account.id,
      platform: 'whatsapp',
      title,
      avatarUrl: this.avatars.get(jid),
      isGroup,
      participants: [
        { id: this.meJid, name: this.account.displayName, isMe: true },
        ...(isGroup ? [] : [{ id: jid, name: title, handle: `+${jid.split('@')[0]}` }])
      ],
      unreadCount: Math.max(0, chat.unreadCount ?? 0),
      pinned: !!chat.pinned,
      muted: !!chat.muteEndTime && Number(chat.muteEndTime) * 1000 > Date.now(),
      lastMessage: last && previewOf(last),
      updatedAt: Number(chat.conversationTimestamp ?? raw?.messageTimestamp ?? 0) * 1000
    }
  }

  private async toMessage(raw: WAMessage, id: string): Promise<Message> {
    const message = this.toMessageSync(raw, id)
    const content = raw.message
    const sticker = content?.stickerMessage
    if (sticker && this.lib && !message.attachments[0]?.url) {
      try {
        const buffer = await this.lib.downloadMediaMessage(raw, 'buffer', {})
        if (buffer.length < 512_000) message.attachments[0].url = `data:image/webp;base64,${buffer.toString('base64')}`
      } catch {
        /* keep placeholder */
      }
    }
    return message
  }

  private toMessageSync(raw: WAMessage, id: string): Message {
    const content = this.lib?.normalizeMessageContent(raw.message) ?? raw.message ?? undefined
    const jid = externalIdOf(id)
    const isOutgoing = !!raw.key.fromMe
    const senderJid = isOutgoing ? this.meJid : (raw.key.participant ?? jid)
    const senderName = isOutgoing ? this.account.displayName : raw.pushName || this.nameOf(senderJid)
    const attachments: Attachment[] = []
    let text = ''
    let contextInfo: proto.IContextInfo | null | undefined
    if (content?.conversation) text = content.conversation
    else if (content?.extendedTextMessage) {
      text = content.extendedTextMessage.text ?? ''
      contextInfo = content.extendedTextMessage.contextInfo
    } else if (content?.imageMessage) {
      const m = content.imageMessage
      text = m.caption ?? ''
      contextInfo = m.contextInfo
      attachments.push({ id: `${raw.key.id}-img`, kind: 'image', url: thumb(m.jpegThumbnail), width: m.width ?? undefined, height: m.height ?? undefined })
    } else if (content?.videoMessage) {
      const m = content.videoMessage
      text = m.caption ?? ''
      contextInfo = m.contextInfo
      attachments.push({ id: `${raw.key.id}-vid`, kind: 'video', thumbnailUrl: thumb(m.jpegThumbnail), width: m.width ?? undefined, height: m.height ?? undefined, gif: m.gifPlayback || undefined })
    } else if (content?.documentMessage) {
      const m = content.documentMessage
      text = m.caption ?? ''
      contextInfo = m.contextInfo
      attachments.push({ id: `${raw.key.id}-doc`, kind: 'file', name: m.fileName ?? 'File', size: Number(m.fileLength ?? 0) })
    } else if (content?.audioMessage) {
      const m = content.audioMessage
      contextInfo = m.contextInfo
      attachments.push({ id: `${raw.key.id}-aud`, kind: 'audio', name: m.ptt ? 'Voice message' : 'Audio', size: Number(m.fileLength ?? 0), duration: m.seconds ?? undefined })
    } else if (content?.stickerMessage) {
      contextInfo = content.stickerMessage.contextInfo
      attachments.push({ id: `${raw.key.id}-stk`, kind: 'sticker', name: '' })
    } else if (content?.locationMessage) {
      const m = content.locationMessage
      attachments.push({ id: `${raw.key.id}-loc`, kind: 'link', name: m.name ?? 'Location', url: `https://maps.google.com/?q=${m.degreesLatitude},${m.degreesLongitude}` })
    } else if (content?.contactMessage) {
      text = `Contact: ${content.contactMessage.displayName ?? ''}`
    }
    const message: Message = {
      id: raw.key.id ?? randomUUID(),
      conversationId: id,
      senderId: senderJid,
      senderName,
      senderAvatarUrl: isOutgoing ? this.account.avatarUrl : this.avatars.get(senderJid),
      text,
      attachments,
      reactions: this.knownReactions(id, raw.key.id ?? ''),
      sentAt: Number(raw.messageTimestamp ?? 0) * 1000,
      isOutgoing,
      status: statusOf(raw.status ?? undefined, isOutgoing)
    }
    if (contextInfo?.stanzaId) {
      const quoted = contextInfo.quotedMessage
      message.replyTo = {
        id: contextInfo.stanzaId,
        senderName: contextInfo.participant ? this.nameOf(contextInfo.participant) : '',
        text: quoted?.conversation ?? quoted?.extendedTextMessage?.text ?? quoted?.imageMessage?.caption ?? (quoted?.imageMessage ? 'Photo' : '')
      }
    }
    return message
  }

  private knownReactions(id: string, messageId: string): Reaction[] {
    return (this.converted.get(id) ?? []).find((m) => m.id === messageId)?.reactions ?? []
  }

  private nameOf(jid: string): string {
    const contact = this.contacts.get(jid) ?? [...this.contacts.values()].find((c) => c.lid === jid || c.phoneNumber === jid)
    if (contact?.name || contact?.notify || contact?.verifiedName) return (contact.name ?? contact.verifiedName ?? contact.notify) as string
    const user = jid.split('@')[0].split(':')[0]
    return jid.endsWith('@g.us') ? 'Group' : `+${user}`
  }

  private messagesFor(id: string, rebuild = false): Message[] {
    if (!rebuild && this.converted.has(id)) return this.converted.get(id)!
    const jid = externalIdOf(id)
    const known = new Map((this.converted.get(id) ?? []).map((m) => [m.id, m]))
    const list = (this.history.get(jid) ?? []).map((raw) => {
      const existing = known.get(raw.key.id ?? '')
      return existing ?? this.toMessageSync(raw, id)
    })
    this.converted.set(id, list)
    return list
  }

  private cacheConverted(id: string, messages: Message[]): void {
    const list = this.converted.get(id) ?? this.messagesFor(id)
    for (const message of messages) {
      const index = list.findIndex((m) => m.id === message.id)
      if (index >= 0) list[index] = message
      else list.push(message)
    }
    list.sort((a, b) => a.sentAt - b.sentAt)
    this.converted.set(id, list)
  }

  private remember(jid: string, messages: WAMessage[]): void {
    const list = this.history.get(jid) ?? []
    for (const message of messages) {
      if (!message.message) continue
      const index = list.findIndex((m) => m.key.id === message.key.id)
      if (index >= 0) list[index] = message
      else list.push(message)
    }
    list.sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0))
    this.history.set(jid, list.slice(-HISTORY_LIMIT))
  }

  private rawMessage(jid: string, messageId: string): WAMessage | undefined {
    return (this.history.get(jid) ?? []).find((m) => m.key.id === messageId)
  }

  private async hydrateAvatars(conversations: Conversation[]): Promise<void> {
    const sock = this.sock
    if (!sock) return
    for (const conversation of conversations) {
      const jid = externalIdOf(conversation.id)
      if (this.avatars.has(jid)) continue
      this.avatars.set(jid, undefined)
      try {
        const url = await sock.profilePictureUrl(jid, 'preview', 5000)
        if (url) {
          this.avatars.set(jid, url)
          this.ctx.emit({ type: 'conversation:upserted', conversation: { ...conversation, avatarUrl: url } })
        }
      } catch {
        /* no photo or privacy setting */
      }
    }
  }

  private async showQr(code: string, onCancel: () => void): Promise<void> {
    const QRCode = (await import('qrcode')).default
    const dataUrl = await QRCode.toDataURL(code, { margin: 1, width: 280, errorCorrectionLevel: 'M' })
    this.setStatus('needs_auth')
    this.qrPromptId = this.ctx.presentQr(dataUrl, undefined, this.qrPromptId, () => {
      this.qrPromptId = undefined
      this.closing = true
      this.sock?.end(undefined)
      onCancel()
    })
  }

  private requireSock(): WASocket {
    if (!this.sock) throw new Error('WhatsApp is not connected')
    return this.sock
  }

  private setStatus(status: Account['status'], error?: string): void {
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
}

function thumb(bytes?: Uint8Array | null): string | undefined {
  return bytes?.length ? `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}` : undefined
}

function statusOf(status: number | undefined, isOutgoing: boolean): Message['status'] {
  if (!isOutgoing) return 'delivered'
  switch (status) {
    case 0:
      return 'failed'
    case 1:
      return 'sending'
    case 2:
      return 'sent'
    case 3:
      return 'delivered'
    case 4:
    case 5:
      return 'read'
    default:
      return 'sent'
  }
}

