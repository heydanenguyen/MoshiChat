import { randomUUID } from 'crypto'
import type { Account, Attachment, Conversation, Message, Peer, PeerProfile, SendOptions } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf, matchesQuery, statsOf } from './types'
import type { WebCookie } from './facebook-personal'
import { SessionExpiredError, WebClient } from '../web-client'
import { DirectComposer } from '../direct-composer'

export interface InstagramPersonalSecret {
  cookies: WebCookie[]
  username?: string
}

interface IgUser {
  pk: number | string
  pk_id?: string
  username: string
  full_name?: string
  profile_pic_url?: string
  is_verified?: boolean
}

interface IgItem {
  item_id: string
  user_id: number | string
  timestamp: string | number
  item_type: string
  text?: string
  link?: { text?: string; link_context?: { link_url?: string; link_title?: string } }
  media?: { image_versions2?: { candidates?: Array<{ url: string; width?: number; height?: number }> }; video_versions?: Array<{ url: string }> }
  visual_media?: { media?: IgItem['media'] }
  animated_media?: { images?: { fixed_height?: { url?: string } } }
  voice_media?: { media?: { audio?: { audio_src?: string; duration?: number } } }
  media_share?: { code?: string; caption?: { text?: string }; image_versions2?: { candidates?: Array<{ url: string }> } }
  clip?: { clip?: { code?: string; image_versions2?: { candidates?: Array<{ url: string }> } } }
  reel_share?: { text?: string }
  reactions?: { emojis?: Array<{ emoji: string; sender_id: number | string }> }
  replied_to_message?: { item_id?: string; text?: string; user_id?: number | string }
}

interface IgThread {
  thread_id: string
  thread_title?: string
  is_group?: boolean
  users: IgUser[]
  items?: IgItem[]
  last_permanent_item?: IgItem
  last_activity_at?: number | string
  read_state?: number
  muted?: boolean
  oldest_cursor?: string
  has_older?: boolean
  last_seen_at?: Record<string, { item_id?: string; timestamp?: string }>
}

interface InboxResponse {
  inbox: { threads: IgThread[]; has_older?: boolean; oldest_cursor?: string }
  viewer?: IgUser
}

const POLL_INTERVAL = 20_000
const MAX_BACKOFF = 8
const HISTORY_LIMIT = 300
const APP_HEADERS = { 'X-IG-App-ID': '936619743392459', 'X-ASBD-ID': '129477' }

/**
 * Personal Instagram through the same web endpoints instagram.com uses,
 * executed inside the session the user created in the in-app login window.
 * Messages are polled every few seconds.
 */
export class InstagramPersonalAdapter implements PlatformAdapter {
  readonly account: Account
  private web = new WebClient('persist:login-instagram', 'https://www.instagram.com')
  private composer = new DirectComposer('persist:login-instagram')
  private mePk = ''
  private threads = new Map<string, IgThread>()
  private users = new Map<string, IgUser>()
  private history = new Map<string, Message[]>()
  private cursors = new Map<string, string | undefined>()
  private pendingPeers = new Map<string, string>()
  private aliases = new Map<string, string>()
  private timer?: NodeJS.Timeout
  private polling = false
  /** Polls to skip after Instagram answers 429; doubles on each hit. */
  private skip = 0
  private backoff = 1

  constructor(
    initialId: string,
    private secret: InstagramPersonalSecret,
    private readonly ctx: AdapterContext
  ) {
    this.account = { id: initialId, platform: 'instagram', displayName: 'Instagram', status: 'disconnected', features: { reply: false, react: false, attachments: false } }
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    this.skip = 0
    this.backoff = 1
    try {
      await this.web.restoreCookies(this.secret.cookies)
      const pk = this.secret.cookies.find((c) => c.name === 'ds_user_id')?.value
      if (!pk) throw new Error('Instagram session is missing the user id; please sign in again')
      this.mePk = pk
      // The settings form is the cheapest self lookup and is not rate limited like /users/{id}/info/.
      const form = await this.web.json<{ form_data: { username: string; first_name?: string } }>('/api/v1/accounts/edit/web_form_data/', { headers: APP_HEADERS })
      const me: IgUser = { pk, username: form.form_data.username, full_name: form.form_data.first_name }
      this.account.id = `instagram:ig-${pk}`
      this.account.displayName = me?.full_name || me?.username || this.secret.username || 'Instagram'
      this.account.handle = me?.username ? `@${me.username}` : undefined
      this.account.avatarUrl = me?.profile_pic_url
      this.secret = { cookies: await this.web.cookies(), username: me?.username ?? this.secret.username }
    } catch (err) {
      this.web.close()
      if (err instanceof SessionExpiredError) {
        this.expire(err)
        throw new Error(sessionMessage(err))
      }
      this.setStatus('error', `Instagram: ${(err as Error).message}`)
      throw err
    }
    await this.ctx.saveSecret(this.secret)
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL)
    this.setStatus('connected')
  }

  /** New cookies from a fresh sign-in; takes effect on the next connect(). */
  replaceCookies(cookies: WebCookie[]): void {
    this.secret = { ...this.secret, cookies }
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.web.close()
    this.composer.close()
    this.setStatus('disconnected')
  }

  async listConversations(): Promise<Conversation[]> {
    const inbox = await this.inbox()
    return inbox.map((thread) => this.toConversation(thread))
  }

  async fetchMessages(id: string, options: FetchMessagesOptions): Promise<Message[]> {
    return this.guard(() => this.fetchPage(id, options))
  }

  private async fetchPage(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const threadId = this.threadIdFor(id)
    if (!threadId) return this.history.get(id) ?? []
    const params = new URLSearchParams({ limit: String(Math.min(limit, 40)) })
    if (beforeId) {
      const cursor = this.cursors.get(id)
      if (!cursor) return []
      params.set('cursor', cursor)
    }
    const res = await this.web.json<{ thread: IgThread }>(`/api/v1/direct_v2/threads/${threadId}/?${params}`, { headers: APP_HEADERS })
    const thread = res.thread
    this.absorbUsers(thread.users)
    this.cursors.set(id, thread.has_older ? thread.oldest_cursor : undefined)
    const messages = (thread.items ?? []).map((item) => this.toMessage(item, id))
    this.remember(id, messages)
    return messages.sort((a, b) => a.sentAt - b.sentAt)
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    return this.guard(() => this.send(id, text, options))
  }

  private async send(id: string, text: string, options: SendOptions): Promise<Message> {
    if (options.attachments?.length) throw new Error('Personal Instagram supports text messages only for now')
    if (!text.trim()) throw new Error('Message is empty')
    const external = externalIdOf(id)
    const threadId = this.threadIdFor(id)
    let url: string
    if (threadId) url = `https://www.instagram.com/direct/t/${threadId}/`
    else {
      const peer = this.users.get(this.pendingPeers.get(external) ?? '')
      if (!peer?.username) throw new Error('Unknown Instagram recipient')
      url = `https://ig.me/m/${peer.username}`
    }
    const sentAt = Date.now()
    await this.composer.send(url, text)

    // Pick up the real item id (reads are safe on the web API); fall back to a local id.
    let itemId: string | undefined
    const resolvedThread = threadId ?? (await this.findThreadFor(external))
    if (resolvedThread) {
      if (!threadId) this.aliases.set(external, resolvedThread)
      try {
        const res = await this.web.json<{ thread: IgThread }>(`/api/v1/direct_v2/threads/${resolvedThread}/?limit=5`, { headers: APP_HEADERS })
        const mine = (res.thread.items ?? []).find((item) => String(item.user_id) === this.mePk && (item.text ?? '') === text)
        itemId = mine?.item_id
      } catch {
        /* the next poll will reconcile */
      }
    }
    const message: Message = {
      id: itemId ?? `local-${randomUUID()}`,
      conversationId: id,
      senderId: this.mePk,
      senderName: this.account.displayName,
      senderAvatarUrl: this.account.avatarUrl,
      text,
      attachments: [],
      reactions: [],
      sentAt,
      isOutgoing: true,
      status: 'sent'
    }
    this.remember(id, [message])
    return message
  }

  /** After messaging a brand-new peer, find the thread Instagram created. */
  private async findThreadFor(external: string): Promise<string | undefined> {
    const peerPk = this.pendingPeers.get(external)
    if (!peerPk) return undefined
    const threads = await this.inbox().catch(() => [] as IgThread[])
    return threads.find((t) => !t.is_group && t.users.length === 1 && String(t.users[0].pk) === peerPk)?.thread_id
  }

  async markRead(id: string): Promise<void> {
    const threadId = this.threadIdFor(id)
    const last = (this.history.get(id) ?? []).filter((m) => !m.isOutgoing).at(-1)
    if (!threadId || !last) return
    await this.web
      .json(`/api/v1/direct_v2/threads/${threadId}/items/${last.id}/seen/`, { method: 'POST', form: { action: 'mark_seen', thread_id: threadId, item_id: last.id }, headers: APP_HEADERS })
      .catch(() => undefined)
  }

  async getPeerProfile(id: string): Promise<PeerProfile | undefined> {
    const thread = this.threads.get(this.threadIdFor(id) ?? '')
    const otherPk = thread?.users.find((u) => String(u.pk) !== this.mePk)?.pk ?? this.pendingPeers.get(externalIdOf(id))
    if (!otherPk) return undefined
    // /users/{id}/info/ is rate limited on the web; fall back to what the inbox already told us.
    const info = await this.userInfo(String(otherPk)).catch(() => undefined)
    const cached = this.users.get(String(otherPk))
    const user = info ?? cached
    if (!user) return undefined
    const full = info as (IgUser & { biography?: string; follower_count?: number; hd_profile_pic_url_info?: { url?: string } }) | undefined
    const extra: PeerProfile['extra'] = []
    if (full?.follower_count !== undefined) extra.push({ label: 'Followers', value: full.follower_count.toLocaleString() })
    if (user.is_verified) extra.push({ label: 'Verified', value: '✓' })
    return {
      id: String(user.pk),
      name: user.full_name || user.username,
      handle: `@${user.username}`,
      avatarUrl: full?.hd_profile_pic_url_info?.url ?? user.profile_pic_url,
      bio: full?.biography || undefined,
      extra
    }
  }

  async listContacts(): Promise<Peer[]> {
    const peers = new Map<string, Peer>()
    for (const user of this.users.values()) {
      if (String(user.pk) === this.mePk) continue
      peers.set(String(user.pk), this.toPeer(user))
    }
    try {
      const res = await this.web.json<{ users: IgUser[] }>(`/api/v1/friendships/${this.mePk}/following/?count=100`, { headers: APP_HEADERS })
      this.absorbUsers(res.users)
      for (const user of res.users) peers.set(String(user.pk), this.toPeer(user))
    } catch (err) {
      this.ctx.log('instagram following failed', (err as Error).message)
    }
    return [...peers.values()]
  }

  async openConversation(peerId: string): Promise<Conversation> {
    for (const thread of this.threads.values()) {
      const others = thread.users.filter((u) => String(u.pk) !== this.mePk)
      if (!thread.is_group && others.length === 1 && String(others[0].pk) === peerId) return this.toConversation(thread)
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
      participants: [{ id: this.mePk, name: this.account.displayName, isMe: true }, ...(user ? [this.toPeer(user)] : [])],
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

  // ---- requests ---------------------------------------------------------

  private async userInfo(pk: string): Promise<IgUser | undefined> {
    try {
      const res = await this.web.json<{ user: IgUser }>(`/api/v1/users/${pk}/info/`, { headers: APP_HEADERS })
      if (res.user) this.users.set(String(res.user.pk), res.user)
      return res.user
    } catch (err) {
      if (pk !== this.mePk) throw err
      // Fallback for the signed-in account: the settings form always works on the web.
      const form = await this.web.json<{ form_data: { username: string; first_name?: string } }>('/api/v1/accounts/edit/web_form_data/', { headers: APP_HEADERS })
      return { pk, username: form.form_data.username, full_name: form.form_data.first_name }
    }
  }

  private async inbox(): Promise<IgThread[]> {
    const res = await this.web.json<InboxResponse>('/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=40&thread_message_limit=1', { headers: APP_HEADERS })
    const threads = res.inbox?.threads ?? []
    if (res.viewer?.profile_pic_url && this.account.avatarUrl !== res.viewer.profile_pic_url) {
      this.account.avatarUrl = res.viewer.profile_pic_url
      this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
    }
    for (const thread of threads) {
      this.threads.set(thread.thread_id, thread)
      this.absorbUsers(thread.users)
    }
    return threads
  }

  private async poll(): Promise<void> {
    if (this.polling) return
    if (this.skip > 0) {
      this.skip -= 1
      return
    }
    this.polling = true
    try {
      const before = new Map([...this.threads].map(([k, t]) => [k, (t.last_permanent_item ?? t.items?.[0])?.item_id]))
      const threads = await this.inbox()
      for (const thread of threads) {
        const id = conversationId(this.account.id, thread.thread_id)
        const lastId = (thread.last_permanent_item ?? thread.items?.[0])?.item_id
        if (before.get(thread.thread_id) === lastId) continue
        this.ctx.emit({ type: 'conversation:upserted', conversation: this.toConversation(thread) })
        const known = this.history.get(id)
        if (!known || !lastId || known.some((m) => m.id === lastId)) continue
        const res = await this.web.json<{ thread: IgThread }>(`/api/v1/direct_v2/threads/${thread.thread_id}/?limit=10`, { headers: APP_HEADERS })
        const fresh = (res.thread.items ?? [])
          .filter((item) => !known.some((m) => m.id === item.item_id))
          .map((item) => this.toMessage(item, id))
          .sort((a, b) => a.sentAt - b.sentAt)
        this.remember(id, fresh)
        for (const message of fresh) if (!message.isOutgoing) this.ctx.emit({ type: 'message:new', message })
      }
      this.backoff = 1
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.expire(err)
        return
      }
      const message = (err as Error).message
      if (/429|wait a few minutes|rate/i.test(message)) {
        this.skip = this.backoff
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF)
      }
      this.ctx.log('instagram poll failed', message)
    } finally {
      this.polling = false
    }
  }

  /** Run a request; if Instagram ended the session, stop polling and ask the user to sign in again. */
  private async guard<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task()
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.expire(err)
        throw new Error(sessionMessage(err))
      }
      throw err
    }
  }

  private expire(err: SessionExpiredError): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.web.close()
    this.composer.close()
    this.setStatus('needs_auth', err.reason)
  }

  // ---- mapping ----------------------------------------------------------

  private threadIdFor(id: string): string | undefined {
    const external = externalIdOf(id)
    if (external.startsWith('u')) return this.aliases.get(external)
    return external
  }

  private absorbUsers(users?: IgUser[]): void {
    for (const user of users ?? []) this.users.set(String(user.pk ?? user.pk_id), user)
  }

  private toPeer(user: IgUser): Peer {
    return { id: String(user.pk), name: user.full_name || user.username, handle: `@${user.username}`, avatarUrl: user.profile_pic_url }
  }

  private toConversation(thread: IgThread): Conversation {
    const id = conversationId(this.account.id, thread.thread_id)
    const others = thread.users.filter((u) => String(u.pk) !== this.mePk)
    const last = thread.last_permanent_item ?? thread.items?.[0]
    const lastAt = last ? Number(last.timestamp) / 1000 : Number(thread.last_activity_at ?? 0) / 1000
    const lastMine = last ? String(last.user_id) === this.mePk : false
    const seen = thread.last_seen_at?.[this.mePk]?.timestamp
    const unread = last && !lastMine && (!seen || Number(seen) < Number(last.timestamp)) ? 1 : 0
    return {
      id,
      accountId: this.account.id,
      platform: 'instagram',
      title: thread.thread_title || others.map((u) => u.full_name || u.username).join(', ') || 'Instagram',
      avatarUrl: others[0]?.profile_pic_url,
      isGroup: !!thread.is_group,
      participants: [{ id: this.mePk, name: this.account.displayName, isMe: true }, ...others.map((u) => this.toPeer(u))],
      unreadCount: unread,
      muted: !!thread.muted,
      lastMessage: last
        ? { id: last.item_id, text: itemText(last), senderName: lastMine ? this.account.displayName : (others[0]?.full_name || others[0]?.username || ''), isOutgoing: lastMine, sentAt: lastAt }
        : undefined,
      updatedAt: lastAt || Date.now()
    }
  }

  private toMessage(item: IgItem, id: string): Message {
    const isOutgoing = String(item.user_id) === this.mePk
    const sender = this.users.get(String(item.user_id))
    const attachments: Attachment[] = []
    const media = item.media ?? item.visual_media?.media
    const candidate = media?.image_versions2?.candidates?.[0]
    if (candidate) {
      attachments.push({ id: `${item.item_id}-m`, kind: media?.video_versions ? 'video' : 'image', url: media?.video_versions?.[0]?.url ?? candidate.url, thumbnailUrl: candidate.url, width: candidate.width, height: candidate.height })
    }
    if (item.animated_media?.images?.fixed_height?.url) attachments.push({ id: `${item.item_id}-g`, kind: 'image', url: item.animated_media.images.fixed_height.url })
    const audio = item.voice_media?.media?.audio
    if (audio?.audio_src) attachments.push({ id: `${item.item_id}-v`, kind: 'audio', url: audio.audio_src, name: 'Voice message', duration: audio.duration ? audio.duration / 1000 : undefined })
    if (item.link?.link_context?.link_url) attachments.push({ id: `${item.item_id}-l`, kind: 'link', url: item.link.link_context.link_url, name: item.link.link_context.link_title })
    const share = item.media_share ?? item.clip?.clip
    if (share?.code) {
      attachments.push({ id: `${item.item_id}-s`, kind: 'link', url: `https://www.instagram.com/p/${share.code}/`, name: (item.media_share?.caption?.text ?? 'Instagram post').slice(0, 80), thumbnailUrl: share.image_versions2?.candidates?.[0]?.url })
    }
    const reactions = new Map<string, { emoji: string; count: number; byMe: boolean }>()
    for (const r of item.reactions?.emojis ?? []) {
      const entry = reactions.get(r.emoji) ?? { emoji: r.emoji, count: 0, byMe: false }
      entry.count += 1
      if (String(r.sender_id) === this.mePk) entry.byMe = true
      reactions.set(r.emoji, entry)
    }
    const message: Message = {
      id: item.item_id,
      conversationId: id,
      senderId: String(item.user_id),
      senderName: isOutgoing ? this.account.displayName : (sender?.full_name || sender?.username || 'Instagram'),
      senderAvatarUrl: isOutgoing ? this.account.avatarUrl : sender?.profile_pic_url,
      text: itemText(item),
      attachments,
      reactions: [...reactions.values()],
      sentAt: Number(item.timestamp) / 1000,
      isOutgoing,
      status: 'delivered'
    }
    if (item.replied_to_message?.item_id) {
      const who = this.users.get(String(item.replied_to_message.user_id))
      message.replyTo = { id: item.replied_to_message.item_id, senderName: who?.full_name || who?.username || '', text: item.replied_to_message.text ?? '' }
    }
    return message
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

  private setStatus(status: Account['status'], error?: string): void {
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
}

function sessionMessage(err: SessionExpiredError): string {
  return err.reason === 'checkpoint'
    ? 'Instagram wants a security check. Sign in again to confirm it is you.'
    : 'Instagram signed this session out. Sign in again to keep messaging.'
}

function itemText(item: IgItem): string {
  if (item.text) return item.text
  if (item.link?.text) return item.link.text
  switch (item.item_type) {
    case 'like':
      return '❤️'
    case 'media':
    case 'raven_media':
    case 'visual_media':
      return ''
    case 'voice_media':
      return ''
    case 'media_share':
    case 'clip':
      return ''
    case 'story_share':
      return 'Shared a story'
    case 'reel_share':
      return item.reel_share?.text ?? 'Replied to a story'
    case 'action_log':
      return ''
    default:
      return ''
  }
}
