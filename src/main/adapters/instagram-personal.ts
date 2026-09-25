import { readFile } from 'fs/promises'
import type { Account, Attachment, Conversation, Message, Peer, PeerProfile, SendOptions } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf, matchesQuery, previewOf, statsOf } from './types'
import type { WebCookie } from './facebook-personal'

export interface InstagramPersonalSecret {
  cookies: WebCookie[]
  username?: string
}

type IgClient = import('instagram-private-api').IgApiClient
type IgThread = import('instagram-private-api').DirectInboxFeedResponseThreadsItem
type IgItem = import('instagram-private-api').DirectThreadFeedResponseItemsItem

interface IgUser {
  pk: number | string
  username: string
  full_name?: string
  profile_pic_url?: string
}

const POLL_INTERVAL = 10_000
const HISTORY_LIMIT = 300

/**
 * Personal Instagram account through the private mobile API, reusing the
 * session the user created on instagram.com inside an app window. Messages
 * are polled every few seconds; no webhooks or business account needed.
 */
export class InstagramPersonalAdapter implements PlatformAdapter {
  readonly account: Account
  private ig?: IgClient
  private mePk = ''
  private threads = new Map<string, IgThread>()
  private users = new Map<string, IgUser>()
  private history = new Map<string, Message[]>()
  private cursors = new Map<string, string | undefined>()
  private pendingPeers = new Map<string, string>()
  private timer?: NodeJS.Timeout
  private polling = false

  constructor(
    initialId: string,
    private secret: InstagramPersonalSecret,
    private readonly ctx: AdapterContext
  ) {
    this.account = { id: initialId, platform: 'instagram', displayName: 'Instagram', status: 'disconnected', features: { reply: false, react: false, attachments: true } }
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    const { IgApiClient } = await import('instagram-private-api')
    const ig = new IgApiClient()
    const seed = this.secret.username ?? this.secret.cookies.find((c) => c.name === 'ds_user_id')?.value ?? 'unison'
    ig.state.generateDevice(seed)
    const jar = ig.state.cookieJar as unknown as { setCookie(cookie: string, uri: string): unknown }
    for (const cookie of this.secret.cookies) {
      const domain = cookie.domain?.replace(/^\./, '') ?? 'instagram.com'
      jar.setCookie(`${cookie.name}=${cookie.value}; Domain=.${domain}; Path=${cookie.path ?? '/'}; Secure`, `https://www.${domain.replace(/^www\./, '')}/`)
    }
    this.ig = ig
    try {
      const me = await ig.account.currentUser()
      this.mePk = String(me.pk)
      this.account.id = `instagram:ig-${this.mePk}`
      this.account.displayName = me.full_name || me.username
      this.account.handle = `@${me.username}`
      this.account.avatarUrl = me.profile_pic_url
      this.secret = { ...this.secret, username: me.username }
    } catch (err) {
      this.setStatus('error', `Instagram session rejected: ${(err as Error).message}`)
      throw err
    }
    await this.ctx.saveSecret(this.secret)
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL)
    this.setStatus('connected')
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.ig = undefined
    this.setStatus('disconnected')
  }

  async listConversations(): Promise<Conversation[]> {
    const ig = this.requireIg()
    const threads = await ig.feed.directInbox().items()
    const list: Conversation[] = []
    for (const thread of threads) {
      this.threads.set(thread.thread_id, thread)
      for (const user of thread.users ?? []) this.users.set(String(user.pk), user as IgUser)
      list.push(this.toConversation(thread))
    }
    return list
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const ig = this.requireIg()
    const threadId = this.threadIdFor(id)
    if (!threadId) return []
    const feed = ig.feed.directThread({ thread_id: threadId, oldest_cursor: beforeId ? this.cursors.get(id) : undefined } as never)
    const items = await feed.items()
    this.cursors.set(id, (feed as unknown as { cursor?: string }).cursor)
    const messages = items.slice(0, limit).map((item) => this.toMessage(item, id))
    this.remember(id, messages)
    return messages.sort((a, b) => a.sentAt - b.sentAt)
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    const ig = this.requireIg()
    const external = externalIdOf(id)
    const pendingPeer = this.pendingPeers.get(external)
    const target = pendingPeer ? ig.entity.directThread([pendingPeer]) : ig.entity.directThread(external)
    let itemId: string | undefined
    let threadId: string | undefined
    const files = options.attachments ?? []
    for (const file of files) {
      if (!file.mime.startsWith('image/')) throw new Error('Instagram direct messages accept photos only from Unison')
      const response = await target.broadcastPhoto({ file: await readFile(file.path) })
      const payload = unwrap(response)
      itemId = payload.item_id ?? itemId
      threadId = payload.thread_id ?? threadId
    }
    if (text.trim() || !files.length) {
      const response = await target.broadcastText(text)
      const payload = unwrap(response)
      itemId = payload.item_id ?? itemId
      threadId = payload.thread_id ?? threadId
    }
    if (pendingPeer && threadId) {
      this.pendingPeers.delete(external)
      this.pendingPeers.set(external, pendingPeer)
      this.aliasThread(external, threadId)
    }
    const message: Message = {
      id: itemId ?? `local-${Date.now()}`,
      conversationId: id,
      senderId: this.mePk,
      senderName: this.account.displayName,
      senderAvatarUrl: this.account.avatarUrl,
      text,
      attachments: files.map((a, i) => ({ id: `${itemId ?? Date.now()}-${i}`, kind: 'image', url: a.preview, name: a.name, size: a.size })),
      reactions: [],
      sentAt: Date.now(),
      isOutgoing: true,
      status: 'sent'
    }
    this.remember(id, [message])
    return message
  }

  async markRead(id: string): Promise<void> {
    const threadId = this.threadIdFor(id)
    const last = (this.history.get(id) ?? []).filter((m) => !m.isOutgoing).at(-1)
    if (!threadId || !last) return
    await this.requireIg().entity.directThread(threadId).markItemSeen(last.id).catch(() => undefined)
  }

  async getPeerProfile(id: string): Promise<PeerProfile | undefined> {
    const thread = this.threads.get(this.threadIdFor(id) ?? '')
    const other = thread?.users?.find((u) => String(u.pk) !== this.mePk) ?? (this.pendingPeers.get(externalIdOf(id)) ? this.users.get(this.pendingPeers.get(externalIdOf(id))!) : undefined)
    if (!other) return undefined
    const extra: PeerProfile['extra'] = []
    try {
      const info = await this.requireIg().user.info(String(other.pk))
      extra.push({ label: 'Followers', value: Number(info.follower_count ?? 0).toLocaleString() })
      if (info.is_verified) extra.push({ label: 'Verified', value: '✓' })
      return {
        id: String(other.pk),
        name: info.full_name || info.username,
        handle: `@${info.username}`,
        avatarUrl: info.hd_profile_pic_url_info?.url ?? info.profile_pic_url,
        bio: info.biography || undefined,
        extra
      }
    } catch {
      return { id: String(other.pk), name: other.full_name || other.username, handle: `@${other.username}`, avatarUrl: other.profile_pic_url, extra }
    }
  }

  async listContacts(): Promise<Peer[]> {
    const peers = new Map<string, Peer>()
    for (const user of this.users.values()) {
      if (String(user.pk) === this.mePk) continue
      peers.set(String(user.pk), { id: String(user.pk), name: user.full_name || user.username, handle: `@${user.username}`, avatarUrl: user.profile_pic_url })
    }
    try {
      const following = await this.requireIg().feed.accountFollowing(this.mePk).items()
      for (const user of following.slice(0, 200) as IgUser[]) {
        this.users.set(String(user.pk), user)
        peers.set(String(user.pk), { id: String(user.pk), name: user.full_name || user.username, handle: `@${user.username}`, avatarUrl: user.profile_pic_url })
      }
    } catch (err) {
      this.ctx.log('instagram following failed', (err as Error).message)
    }
    return [...peers.values()]
  }

  async openConversation(peerId: string): Promise<Conversation> {
    for (const thread of this.threads.values()) {
      if (!thread.is_group && thread.users?.length === 1 && String(thread.users[0].pk) === peerId) return this.toConversation(thread)
    }
    const user = this.users.get(peerId)
    const external = `u${peerId}`
    this.pendingPeers.set(external, peerId)
    return {
      id: conversationId(this.account.id, external),
      accountId: this.account.id,
      platform: 'instagram',
      title: user?.full_name || user?.username || 'Instagram',
      avatarUrl: user?.profile_pic_url,
      isGroup: false,
      participants: [
        { id: this.mePk, name: this.account.displayName, isMe: true },
        { id: peerId, name: user?.full_name || user?.username || '', handle: user ? `@${user.username}` : undefined, avatarUrl: user?.profile_pic_url }
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
    return statsOf(this.history.get(id) ?? [])
  }

  // ---- polling ----------------------------------------------------------

  private async poll(): Promise<void> {
    if (this.polling || !this.ig) return
    this.polling = true
    try {
      const threads = await this.ig.feed.directInbox().items()
      for (const thread of threads) {
        const previous = this.threads.get(thread.thread_id)
        this.threads.set(thread.thread_id, thread)
        for (const user of thread.users ?? []) this.users.set(String(user.pk), user as IgUser)
        const id = conversationId(this.account.id, thread.thread_id)
        const lastId = thread.last_permanent_item?.item_id
        const known = this.history.get(id)
        if (!previous || previous.last_permanent_item?.item_id !== lastId) {
          const conversation = this.toConversation(thread)
          this.ctx.emit({ type: 'conversation:upserted', conversation })
          if (previous && known && lastId && !known.some((m) => m.id === lastId)) {
            const items = await this.ig.feed.directThread({ thread_id: thread.thread_id } as never).items()
            const fresh = items.filter((item) => !known.some((m) => m.id === item.item_id)).map((item) => this.toMessage(item, id)).sort((a, b) => a.sentAt - b.sentAt)
            this.remember(id, fresh)
            for (const message of fresh) if (!message.isOutgoing) this.ctx.emit({ type: 'message:new', message })
          }
        }
      }
    } catch (err) {
      this.ctx.log('instagram poll failed', (err as Error).message)
    } finally {
      this.polling = false
    }
  }

  // ---- mapping ----------------------------------------------------------

  private aliasThread(external: string, threadId: string): void {
    // Messages sent to a brand-new peer live under the virtual id until the thread shows up in the inbox.
    this.pendingPeers.set(external, this.pendingPeers.get(external)!)
    this.cursors.set(conversationId(this.account.id, external), undefined)
    this.threadAliases.set(external, threadId)
  }

  private threadAliases = new Map<string, string>()

  private threadIdFor(id: string): string | undefined {
    const external = externalIdOf(id)
    if (external.startsWith('u')) return this.threadAliases.get(external)
    return external
  }

  private toConversation(thread: IgThread): Conversation {
    const id = conversationId(this.account.id, thread.thread_id)
    const others = (thread.users ?? []).filter((u) => String(u.pk) !== this.mePk)
    const last = thread.last_permanent_item
    const lastText = last ? itemText(last as unknown as IgItem) : ''
    const lastAt = last ? Number(last.timestamp) / 1000 : Date.now()
    const lastMine = last ? String(last.user_id) === this.mePk : false
    return {
      id,
      accountId: this.account.id,
      platform: 'instagram',
      title: thread.thread_title || others.map((u) => u.full_name || u.username).join(', ') || 'Instagram',
      avatarUrl: others[0]?.profile_pic_url,
      isGroup: !!thread.is_group,
      participants: [
        { id: this.mePk, name: this.account.displayName, isMe: true },
        ...others.map((u) => ({ id: String(u.pk), name: u.full_name || u.username, handle: `@${u.username}`, avatarUrl: u.profile_pic_url }))
      ],
      unreadCount: (thread as unknown as { read_state?: number }).read_state ? 1 : 0,
      muted: !!(thread as unknown as { muted?: boolean }).muted,
      lastMessage: last
        ? { id: last.item_id, text: lastText, senderName: lastMine ? this.account.displayName : (others[0]?.full_name || others[0]?.username || ''), isOutgoing: lastMine, sentAt: lastAt }
        : undefined,
      updatedAt: lastAt
    }
  }

  private toMessage(item: IgItem, id: string): Message {
    const isOutgoing = String(item.user_id) === this.mePk
    const sender = this.users.get(String(item.user_id))
    const attachments: Attachment[] = []
    const raw = item as unknown as Record<string, any>
    const media = raw.media ?? raw.raven_media
    if (media?.image_versions2?.candidates?.[0]) {
      const candidate = media.image_versions2.candidates[0]
      attachments.push({ id: `${item.item_id}-m`, kind: media.video_versions ? 'video' : 'image', url: media.video_versions?.[0]?.url ?? candidate.url, thumbnailUrl: candidate.url, width: candidate.width, height: candidate.height })
    }
    if (raw.animated_media?.images?.fixed_height?.url) attachments.push({ id: `${item.item_id}-g`, kind: 'image', url: raw.animated_media.images.fixed_height.url })
    if (raw.voice_media?.media?.audio?.audio_src) attachments.push({ id: `${item.item_id}-v`, kind: 'audio', url: raw.voice_media.media.audio.audio_src, name: 'Voice message', duration: raw.voice_media.media.audio.duration ? raw.voice_media.media.audio.duration / 1000 : undefined })
    if (raw.link?.link_context?.link_url) attachments.push({ id: `${item.item_id}-l`, kind: 'link', url: raw.link.link_context.link_url, name: raw.link.link_context.link_title })
    if (raw.media_share?.image_versions2?.candidates?.[0]) attachments.push({ id: `${item.item_id}-s`, kind: 'link', url: `https://www.instagram.com/p/${raw.media_share.code}/`, name: raw.media_share.caption?.text?.slice(0, 80) ?? 'Instagram post', thumbnailUrl: raw.media_share.image_versions2.candidates[0].url })
    return {
      id: item.item_id,
      conversationId: id,
      senderId: String(item.user_id),
      senderName: isOutgoing ? this.account.displayName : (sender?.full_name || sender?.username || 'Instagram'),
      senderAvatarUrl: isOutgoing ? this.account.avatarUrl : sender?.profile_pic_url,
      text: itemText(item),
      attachments,
      reactions: [],
      sentAt: Number(item.timestamp) / 1000,
      isOutgoing,
      status: 'delivered'
    }
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

  private requireIg(): IgClient {
    if (!this.ig) throw new Error('Instagram is not connected')
    return this.ig
  }

  private setStatus(status: Account['status'], error?: string): void {
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
}

function itemText(item: IgItem): string {
  const raw = item as unknown as Record<string, any>
  if (raw.text) return String(raw.text)
  if (raw.link?.text) return String(raw.link.text)
  if (item.item_type === 'like') return '❤️'
  if (item.item_type === 'media_share') return raw.media_share?.caption?.text ? '' : 'Shared a post'
  if (item.item_type === 'story_share') return 'Shared a story'
  if (item.item_type === 'reel_share') return raw.reel_share?.text ?? 'Replied to a story'
  return ''
}

function unwrap(response: unknown): { item_id?: string; thread_id?: string } {
  const r = response as { payload?: { item_id?: string; thread_id?: string }; item_id?: string; thread_id?: string }
  return r.payload ?? r
}
