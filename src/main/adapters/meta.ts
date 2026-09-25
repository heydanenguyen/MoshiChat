import { readFile } from 'fs/promises'
import type { Account, Attachment, Conversation, Message, Peer, Platform, SendOptions } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf } from './types'

export interface MetaSecret {
  pageId: string
  accessToken: string
}

const GRAPH = 'https://graph.facebook.com/v21.0'
const POLL_INTERVAL = 8_000
const MESSAGE_FIELDS = 'id,message,from,to,created_time,attachments{mime_type,name,image_data,file_url,video_data}'

interface GraphParticipant {
  id: string
  name?: string
  username?: string
}

interface GraphMessage {
  id: string
  message?: string
  from: GraphParticipant
  created_time: string
  attachments?: { data: GraphAttachment[] }
}

interface GraphAttachment {
  id?: string
  mime_type?: string
  name?: string
  file_url?: string
  image_data?: { url: string; preview_url?: string; width?: number; height?: number }
  video_data?: { url: string; preview_url?: string; width?: number; height?: number }
}

interface GraphConversation {
  id: string
  updated_time: string
  unread_count?: number
  participants: { data: GraphParticipant[] }
  messages?: { data: GraphMessage[] }
}

interface Paged<T> {
  data: T[]
  paging?: { cursors?: { before?: string; after?: string }; next?: string }
}

/**
 * Messenger and Instagram through the Meta Graph API (Messenger Platform and
 * Instagram Messaging API). Works with a Facebook Page and its Page access
 * token; Instagram requires the Page to be linked to a professional account.
 * Real-time delivery uses polling so no public webhook URL is needed.
 */
export class MetaAdapter implements PlatformAdapter {
  readonly account: Account
  private ownIds = new Set<string>()
  private conversations = new Map<string, Conversation>()
  private recipients = new Map<string, string>()
  private seen = new Map<string, Set<string>>()
  private cursors = new Map<string, string | undefined>()
  private updatedAt = new Map<string, string>()
  private timer?: NodeJS.Timeout
  private polling = false

  constructor(
    private readonly platform: Extract<Platform, 'messenger' | 'instagram'>,
    private readonly secret: MetaSecret,
    private readonly ctx: AdapterContext
  ) {
    this.account = {
      id: `${platform}:${secret.pageId}`,
      platform,
      displayName: platform === 'messenger' ? 'Messenger' : 'Instagram',
      status: 'disconnected',
      features: { reply: false, react: false, attachments: true }
    }
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    try {
      const page = await this.get<{
        id: string
        name: string
        picture?: { data: { url: string } }
        instagram_business_account?: { id: string; username: string; profile_picture_url?: string }
      }>(`/${this.secret.pageId}`, {
        fields: 'id,name,picture{url},instagram_business_account{id,username,profile_picture_url}'
      })
      this.ownIds.add(page.id)
      if (this.platform === 'instagram') {
        const ig = page.instagram_business_account
        if (!ig) throw new Error('This Page has no linked Instagram professional account')
        this.ownIds.add(ig.id)
        this.account.displayName = ig.username
        this.account.handle = `@${ig.username}`
        this.account.avatarUrl = ig.profile_picture_url
      } else {
        this.account.displayName = page.name
        this.account.avatarUrl = page.picture?.data.url
      }
      this.setStatus('connected')
      this.timer = setInterval(() => void this.poll(), POLL_INTERVAL)
    } catch (err) {
      this.setStatus('error', (err as Error).message)
      throw err
    }
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.setStatus('disconnected')
  }

  async listConversations(): Promise<Conversation[]> {
    const page = await this.get<Paged<GraphConversation>>(`/${this.secret.pageId}/conversations`, {
      platform: this.platform,
      fields: `id,updated_time,unread_count,participants,messages.limit(1){${MESSAGE_FIELDS}}`,
      limit: '50'
    })
    const list = page.data.map((raw) => this.toConversation(raw))
    for (const conversation of list) this.conversations.set(conversation.id, conversation)
    return list
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const params: Record<string, string> = { fields: MESSAGE_FIELDS, limit: String(limit) }
    if (beforeId) {
      const cursor = this.cursors.get(id)
      if (!cursor) return []
      params.after = cursor
    }
    const page = await this.get<Paged<GraphMessage>>(`/${externalIdOf(id)}/messages`, params)
    this.cursors.set(id, page.paging?.cursors?.after)
    const messages = page.data.map((raw) => this.toMessage(raw, id)).reverse()
    const seen = this.seen.get(id) ?? new Set<string>()
    for (const message of messages) seen.add(message.id)
    this.seen.set(id, seen)
    return messages
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    const recipient = this.recipients.get(id)
    if (!recipient) throw new Error('Unknown recipient for this conversation')
    const files = options.attachments ?? []
    const uploaded: Attachment[] = []
    let response: { message_id: string } | undefined
    for (const file of files) {
      const kind = file.mime.startsWith('image/') ? 'image' : file.mime.startsWith('video/') ? 'video' : file.mime.startsWith('audio/') ? 'audio' : 'file'
      const form = new FormData()
      form.set('recipient', JSON.stringify({ id: recipient }))
      form.set('messaging_type', 'RESPONSE')
      form.set('message', JSON.stringify({ attachment: { type: kind, payload: { is_reusable: false } } }))
      form.set('filedata', new Blob([await readFile(file.path)], { type: file.mime }), file.name)
      response = await this.postForm<{ message_id: string }>(`/${this.secret.pageId}/messages`, form)
      uploaded.push({ id: response.message_id, kind, name: file.name, size: file.size, url: file.preview })
    }
    if (text.trim() || !files.length) {
      response = await this.post<{ message_id: string }>(`/${this.secret.pageId}/messages`, {
        recipient: { id: recipient },
        messaging_type: 'RESPONSE',
        message: { text }
      })
    }
    if (!response) throw new Error('Nothing was sent')
    const message: Message = {
      id: response.message_id,
      conversationId: id,
      senderId: this.secret.pageId,
      senderName: this.account.displayName,
      text,
      attachments: uploaded,
      reactions: [],
      sentAt: Date.now(),
      isOutgoing: true,
      status: 'sent'
    }
    this.seen.get(id)?.add(message.id)
    const conversation = this.conversations.get(id)
    if (conversation) {
      conversation.lastMessage = { id: message.id, text, senderName: message.senderName, isOutgoing: true, sentAt: message.sentAt }
      conversation.updatedAt = message.sentAt
      this.ctx.emit({ type: 'conversation:upserted', conversation: { ...conversation } })
    }
    return message
  }

  async markRead(id: string): Promise<void> {
    const recipient = this.recipients.get(id)
    const conversation = this.conversations.get(id)
    if (conversation && conversation.unreadCount) {
      conversation.unreadCount = 0
      this.ctx.emit({ type: 'conversation:upserted', conversation: { ...conversation } })
    }
    if (recipient && this.platform === 'messenger') {
      await this.post(`/${this.secret.pageId}/messages`, { recipient: { id: recipient }, sender_action: 'mark_seen' }).catch(
        () => undefined
      )
    }
  }

  async setTyping(id: string): Promise<void> {
    const recipient = this.recipients.get(id)
    if (!recipient) return
    await this.post(`/${this.secret.pageId}/messages`, { recipient: { id: recipient }, sender_action: 'typing_on' }).catch(
      () => undefined
    )
  }

  // ---- polling ----------------------------------------------------------

  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const page = await this.get<Paged<GraphConversation>>(`/${this.secret.pageId}/conversations`, {
        platform: this.platform,
        fields: 'id,updated_time,unread_count,participants',
        limit: '25'
      })
      for (const raw of page.data) {
        const id = conversationId(this.account.id, raw.id)
        const previous = this.updatedAt.get(id)
        if (previous === raw.updated_time) continue
        const known = this.seen.has(id)
        this.updatedAt.set(id, raw.updated_time)
        const latest = await this.get<Paged<GraphMessage>>(`/${raw.id}/messages`, { fields: MESSAGE_FIELDS, limit: '10' })
        const seen = this.seen.get(id) ?? new Set<string>()
        const fresh = latest.data.filter((m) => !seen.has(m.id)).reverse()
        for (const m of fresh) seen.add(m.id)
        this.seen.set(id, seen)
        const conversation = this.toConversation({ ...raw, messages: { data: latest.data.slice(0, 1) } })
        this.conversations.set(id, conversation)
        this.ctx.emit({ type: 'conversation:upserted', conversation })
        if (known) for (const m of fresh) this.ctx.emit({ type: 'message:new', message: this.toMessage(m, id) })
      }
    } catch (err) {
      this.ctx.log('meta poll failed', (err as Error).message)
    } finally {
      this.polling = false
    }
  }

  // ---- mapping ----------------------------------------------------------

  private toConversation(raw: GraphConversation): Conversation {
    const id = conversationId(this.account.id, raw.id)
    const participants: Peer[] = raw.participants.data.map((p) => ({
      id: p.id,
      name: p.name ?? p.username ?? 'User',
      handle: p.username ? `@${p.username}` : undefined,
      isMe: this.ownIds.has(p.id)
    }))
    const other = participants.find((p) => !p.isMe)
    if (other) this.recipients.set(id, other.id)
    const last = raw.messages?.data[0]
    const lastMessage = last ? this.toMessage(last, id) : undefined
    this.updatedAt.set(id, raw.updated_time)
    return {
      id,
      accountId: this.account.id,
      platform: this.platform,
      title: other?.name ?? 'Conversation',
      isGroup: participants.filter((p) => !p.isMe).length > 1,
      participants,
      unreadCount: raw.unread_count ?? 0,
      lastMessage: lastMessage && {
        id: lastMessage.id,
        text: lastMessage.text || (lastMessage.attachments[0]?.kind === 'image' ? 'Photo' : 'Attachment'),
        senderName: lastMessage.senderName,
        isOutgoing: lastMessage.isOutgoing,
        sentAt: lastMessage.sentAt
      },
      updatedAt: Date.parse(raw.updated_time)
    }
  }

  private toMessage(raw: GraphMessage, id: string): Message {
    const isOutgoing = this.ownIds.has(raw.from.id)
    return {
      id: raw.id,
      conversationId: id,
      senderId: raw.from.id,
      senderName: isOutgoing ? this.account.displayName : (raw.from.name ?? raw.from.username ?? 'User'),
      text: raw.message ?? '',
      attachments: (raw.attachments?.data ?? []).map(toAttachment),
      reactions: [],
      sentAt: Date.parse(raw.created_time),
      isOutgoing,
      status: isOutgoing ? 'sent' : 'delivered'
    }
  }

  // ---- http -------------------------------------------------------------

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(GRAPH + path)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    url.searchParams.set('access_token', this.secret.accessToken)
    const response = await fetch(url)
    return this.parse<T>(response)
  }

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = new URL(GRAPH + path)
    url.searchParams.set('access_token', this.secret.accessToken)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    return this.parse<T>(response)
  }

  private async postForm<T = unknown>(path: string, form: FormData): Promise<T> {
    const url = new URL(GRAPH + path)
    url.searchParams.set('access_token', this.secret.accessToken)
    const response = await fetch(url, { method: 'POST', body: form })
    return this.parse<T>(response)
  }

  private async parse<T>(response: Response): Promise<T> {
    const json = (await response.json()) as T & { error?: { message: string; code: number } }
    if (json.error) throw new Error(`Graph API: ${json.error.message} (code ${json.error.code})`)
    if (!response.ok) throw new Error(`Graph API: HTTP ${response.status}`)
    return json
  }

  private setStatus(status: Account['status'], error?: string): void {
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
}

function toAttachment(raw: GraphAttachment, index: number): Attachment {
  const id = raw.id ?? String(index)
  if (raw.image_data) {
    return {
      id,
      kind: raw.mime_type === 'image/gif' ? 'image' : 'image',
      url: raw.image_data.url,
      thumbnailUrl: raw.image_data.preview_url,
      width: raw.image_data.width,
      height: raw.image_data.height
    }
  }
  if (raw.video_data) {
    return { id, kind: 'video', url: raw.video_data.url, thumbnailUrl: raw.video_data.preview_url }
  }
  if (raw.mime_type?.startsWith('audio/')) return { id, kind: 'audio', url: raw.file_url, name: raw.name }
  return { id, kind: 'file', url: raw.file_url, name: raw.name }
}
