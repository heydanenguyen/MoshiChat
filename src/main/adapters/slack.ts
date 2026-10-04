import { WebClient } from '@slack/web-api'
import { SocketModeClient } from '@slack/socket-mode'
import type { Account, AccountStatus, Attachment, Conversation, Message, Peer, Reaction } from '@shared/types'
import { conversationId, externalIdOf, type AdapterContext, type FetchMessagesOptions, type PlatformAdapter } from './types'

/**
 * Slack through its official Web API, as the user (a user token from a small Slack app the user installs in their
 * own workspace; the add-account form hands them the app's manifest). With an app-level token, new messages come in
 * live over Socket Mode; without one, the chats seen most recently are checked every few seconds.
 */
export interface SlackSecret {
  /** User OAuth token (xoxp-…). */
  token: string
  /** App-level token (xapp-…) with connections:write, for live updates over Socket Mode. */
  appToken?: string
}

interface SlackUser {
  name: string
  avatar?: string
}

interface SlackChannel {
  id: string
  is_im?: boolean
  is_mpim?: boolean
  is_channel?: boolean
  is_group?: boolean
  is_private?: boolean
  name?: string
  user?: string
  created?: number
  last_read?: string
  unread_count_display?: number
  unread_count?: number
  latest?: SlackMessage
}

interface SlackFile {
  id: string
  name?: string
  title?: string
  mimetype?: string
  size?: number
  thumb_360?: string
  url_private?: string
}

interface SlackMessage {
  ts: string
  user?: string
  bot_id?: string
  username?: string
  text?: string
  subtype?: string
  edited?: unknown
  files?: SlackFile[]
  reactions?: Array<{ name: string; count: number; users: string[] }>
  bot_profile?: { name?: string }
}

/** Slack names reactions; Moshi shows emoji. The common ones both ways; anything else shows as :name:. */
const EMOJI_OF: Record<string, string> = {
  heart: '❤️',
  '+1': '👍',
  thumbsup: '👍',
  '-1': '👎',
  joy: '😂',
  open_mouth: '😮',
  astonished: '😲',
  cry: '😢',
  pray: '🙏',
  fire: '🔥',
  tada: '🎉',
  heart_eyes: '😍',
  smile: '😄',
  laughing: '😆',
  rage: '😡',
  eyes: '👀',
  white_check_mark: '✅',
  raised_hands: '🙌',
  clap: '👏',
  ok_hand: '👌',
  thinking_face: '🤔',
  rocket: '🚀',
  '100': '💯',
  wave: '👋'
}
const NAME_OF: Record<string, string> = Object.fromEntries(Object.entries(EMOJI_OF).filter(([n]) => n !== 'thumbsup').map(([n, e]) => [e, n]))

export class SlackAdapter implements PlatformAdapter {
  readonly account: Account
  private web: WebClient
  private socket?: SocketModeClient
  private me = ''
  private users = new Map<string, SlackUser>()
  private channels = new Map<string, SlackChannel>()
  /** Newest ts seen per channel, for polling without a socket. */
  private newest = new Map<string, string>()
  private poll?: ReturnType<typeof setInterval>
  private closing = false

  constructor(
    initialId: string,
    private secret: SlackSecret,
    private ctx: AdapterContext
  ) {
    this.web = new WebClient(secret.token.trim(), { retryConfig: { retries: 2 } })
    this.account = {
      id: initialId,
      platform: 'slack',
      displayName: 'Slack',
      status: 'disconnected',
      features: { reply: false, react: true, attachments: false, unsend: false }
    }
  }

  async connect(): Promise<void> {
    this.closing = false
    this.setStatus('connecting')
    let auth: { user_id?: string; team_id?: string; team?: string; user?: string }
    try {
      auth = (await this.web.auth.test()) as typeof auth
    } catch (err) {
      const code = (err as { data?: { error?: string } }).data?.error
      const message = code === 'invalid_auth' || code === 'not_authed' ? 'Slack did not accept this token' : `Could not reach Slack: ${code ?? (err as Error).message}`
      this.setStatus('error', message)
      throw new Error(message, { cause: err })
    }
    this.me = auth.user_id ?? ''
    this.account.id = `slack:${auth.team_id}-${auth.user_id}`
    this.account.displayName = auth.team ?? 'Slack'
    this.account.handle = auth.user
    await this.ctx.saveSecret(this.secret)
    await this.loadUsers().catch((err) => this.ctx.log('slack users failed', (err as Error).message))
    this.account.avatarUrl = this.users.get(this.me)?.avatar
    this.setStatus('connected')
    await this.startLive()
  }

  async disconnect(): Promise<void> {
    this.closing = true
    if (this.poll) clearInterval(this.poll)
    await this.socket?.disconnect().catch(() => undefined)
    this.socket = undefined
    this.setStatus('disconnected')
  }

  private async loadUsers(): Promise<void> {
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const res = await this.web.users.list({ limit: 200, cursor })
      for (const u of (res.members ?? []) as Array<{ id: string; name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string; image_72?: string } }>) {
        this.users.set(u.id, { name: u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id, avatar: u.profile?.image_72 })
      }
      cursor = res.response_metadata?.next_cursor
      if (!cursor) break
    }
  }

  private nameOf(user?: string): string {
    return (user && this.users.get(user)?.name) || user || 'Slack'
  }

  async listConversations(): Promise<Conversation[]> {
    const list: SlackChannel[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const res = await this.web.users.conversations({ types: 'im,mpim,public_channel,private_channel', exclude_archived: true, limit: 200, cursor })
      list.push(...((res.channels ?? []) as SlackChannel[]))
      cursor = res.response_metadata?.next_cursor
      if (!cursor) break
    }
    for (const c of list) this.channels.set(c.id, c)
    // The latest message and unread count need a call per chat: people first, then channels, a few at a time,
    // each chat updating in the list as it arrives.
    const ordered = [...list.filter((c) => c.is_im), ...list.filter((c) => c.is_mpim), ...list.filter((c) => !c.is_im && !c.is_mpim)].slice(0, 80)
    void this.hydrate(ordered)
    return list.map((c) => this.toConversation(c))
  }

  private async hydrate(list: SlackChannel[]): Promise<void> {
    const queue = [...list]
    const worker = async (): Promise<void> => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        if (this.closing) return
        try {
          const info = (await this.web.conversations.info({ channel: c.id })).channel as SlackChannel | undefined
          const full: SlackChannel = { ...c, ...info }
          if (!full.latest) {
            const res = await this.web.conversations.history({ channel: c.id, limit: 1 })
            full.latest = (res.messages as SlackMessage[] | undefined)?.[0]
          }
          this.channels.set(c.id, full)
          if (full.latest?.ts) this.newest.set(c.id, full.latest.ts)
          this.ctx.emit({ type: 'conversation:upserted', conversation: this.toConversation(full) })
        } catch (err) {
          this.ctx.log('slack chat info failed', c.id, (err as Error).message)
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const channel = externalIdOf(id)
    const res = await this.web.conversations.history({ channel, limit, latest: beforeId, inclusive: false })
    const raw = ((res.messages ?? []) as SlackMessage[]).reverse()
    const messages = await Promise.all(raw.map((m) => this.toMessage(channel, m)))
    const top = raw.at(-1)?.ts
    if (top && (!this.newest.get(channel) || Number(top) > Number(this.newest.get(channel)))) this.newest.set(channel, top)
    return messages
  }

  async sendMessage(id: string, text: string): Promise<Message> {
    const channel = externalIdOf(id)
    const res = await this.web.chat.postMessage({ channel, text })
    const sent = (res.message ?? { ts: res.ts, text, user: this.me }) as SlackMessage
    if (sent.ts) this.newest.set(channel, sent.ts)
    return this.toMessage(channel, { ...sent, user: sent.user ?? this.me })
  }

  async markRead(id: string): Promise<void> {
    const channel = externalIdOf(id)
    const ts = this.newest.get(channel) ?? this.channels.get(channel)?.latest?.ts
    if (ts) await this.web.conversations.mark({ channel, ts })
  }

  async react(id: string, messageId: string, emoji: string): Promise<void> {
    const name = NAME_OF[emoji]
    if (!name) throw new Error('Slack takes its own emoji names: pick one of the quick reactions')
    const channel = externalIdOf(id)
    const res = await this.web.reactions.get({ channel, timestamp: messageId })
    const mine = ((res.message as SlackMessage | undefined)?.reactions ?? []).some((r) => r.name === name && r.users.includes(this.me))
    if (mine) await this.web.reactions.remove({ channel, timestamp: messageId, name })
    else await this.web.reactions.add({ channel, timestamp: messageId, name })
    const after = await this.web.reactions.get({ channel, timestamp: messageId })
    this.ctx.emit({ type: 'message:reactions', conversationId: id, messageId, reactions: this.reactionsOf((after.message as SlackMessage | undefined)?.reactions) })
  }

  async downloadAttachment(id: string, messageId: string, attachmentId: string): Promise<string | undefined> {
    const res = await this.web.conversations.history({ channel: externalIdOf(id), latest: messageId, oldest: messageId, inclusive: true, limit: 1 })
    const file = ((res.messages as SlackMessage[] | undefined)?.[0]?.files ?? []).find((f) => f.id === attachmentId)
    return file?.url_private ? this.fetchPrivate(file.url_private) : undefined
  }

  /** Slack's files need the token: fetched here and handed over as a data URL. */
  private async fetchPrivate(url: string): Promise<string | undefined> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.secret.token.trim()}` } })
    if (!res.ok) return undefined
    const mime = res.headers.get('content-type') ?? 'application/octet-stream'
    return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  }

  /** Live updates: Socket Mode with an app-level token, else a light poll of the chats in use. */
  private async startLive(): Promise<void> {
    if (this.secret.appToken?.trim()) {
      try {
        const socket = new SocketModeClient({ appToken: this.secret.appToken.trim() })
        socket.on('message', async ({ event, ack }: { event: SlackMessage & { channel: string; type: string }; ack: () => Promise<void> }) => {
          await ack()
          if (event.subtype === 'message_changed' || event.subtype === 'message_deleted') return
          void this.deliver(event.channel, event)
        })
        const onReaction = async ({ event, ack }: { event: { item: { channel: string; ts: string } }; ack: () => Promise<void> }): Promise<void> => {
          await ack()
          const res = await this.web.reactions.get({ channel: event.item.channel, timestamp: event.item.ts }).catch(() => undefined)
          if (res) this.ctx.emit({ type: 'message:reactions', conversationId: conversationId(this.account.id, event.item.channel), messageId: event.item.ts, reactions: this.reactionsOf((res.message as SlackMessage | undefined)?.reactions) })
        }
        socket.on('reaction_added', onReaction)
        socket.on('reaction_removed', onReaction)
        await socket.start()
        this.socket = socket
        return
      } catch (err) {
        this.ctx.log('slack socket mode failed, polling instead', (err as Error).message)
      }
    }
    this.poll = setInterval(() => void this.pollRecent(), 15_000)
  }

  private async pollRecent(): Promise<void> {
    const recent = [...this.newest.entries()].sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 6)
    for (const [channel, oldest] of recent) {
      try {
        const res = await this.web.conversations.history({ channel, oldest, inclusive: false, limit: 20 })
        for (const m of ((res.messages ?? []) as SlackMessage[]).reverse()) await this.deliver(channel, m)
      } catch (err) {
        this.ctx.log('slack poll failed', channel, (err as Error).message)
      }
    }
  }

  private async deliver(channel: string, raw: SlackMessage): Promise<void> {
    const seen = this.newest.get(channel)
    if (seen && Number(raw.ts) <= Number(seen)) return
    this.newest.set(channel, raw.ts)
    const message = await this.toMessage(channel, raw)
    const known = this.channels.get(channel) ?? { id: channel }
    this.channels.set(channel, { ...known, latest: raw })
    this.ctx.emit({ type: 'conversation:upserted', conversation: this.toConversation(this.channels.get(channel)!) })
    this.ctx.emit({ type: 'message:new', message })
  }

  private peer(user?: string): Peer {
    const u = user ? this.users.get(user) : undefined
    return { id: user ?? 'slack', name: u?.name ?? user ?? 'Slack', avatarUrl: u?.avatar, isMe: user === this.me }
  }

  private toConversation(c: SlackChannel): Conversation {
    const me = this.peer(this.me)
    let title = c.name ? `#${c.name}` : c.id
    let avatarUrl: string | undefined
    let others: Peer[] = []
    if (c.is_im && c.user) {
      const peer = this.peer(c.user)
      title = peer.name
      avatarUrl = peer.avatarUrl
      others = [peer]
    } else if (c.is_mpim && c.name) {
      // mpdm-ana--bao--chi-1: the people in it
      title = c.name.replace(/^mpdm-/, '').replace(/-\d+$/, '').split('--').filter((n) => n !== this.users.get(this.me)?.name).join(', ')
    }
    const latest = c.latest
    const updatedAt = latest?.ts ? Math.round(Number(latest.ts) * 1000) : (c.created ?? 0) * 1000
    return {
      id: conversationId(this.account.id, c.id),
      accountId: this.account.id,
      platform: 'slack',
      title,
      avatarUrl,
      isGroup: !c.is_im,
      participants: [me, ...others],
      unreadCount: c.unread_count_display ?? c.unread_count ?? 0,
      lastMessage: latest
        ? {
            id: latest.ts,
            text: this.plain(latest.text ?? '') || (latest.files?.length ? latest.files[0].name ?? 'File' : ''),
            senderName: this.nameOf(latest.user),
            isOutgoing: latest.user === this.me,
            sentAt: updatedAt
          }
        : undefined,
      updatedAt
    }
  }

  private async toMessage(channel: string, m: SlackMessage): Promise<Message> {
    const attachments: Attachment[] = []
    for (const f of m.files ?? []) {
      const image = (f.mimetype ?? '').startsWith('image/')
      attachments.push({
        id: f.id,
        kind: image ? 'image' : 'file',
        name: f.name ?? f.title,
        size: f.size,
        // a small preview fetched with the token, so the picture shows in the bubble
        url: image && f.thumb_360 ? await this.fetchPrivate(f.thumb_360).catch(() => undefined) : undefined
      })
    }
    const sender = m.user ?? m.bot_id
    const message: Message = {
      id: m.ts,
      conversationId: conversationId(this.account.id, channel),
      senderId: sender ?? 'slack',
      senderName: m.user ? this.nameOf(m.user) : (m.bot_profile?.name ?? m.username ?? 'Slack'),
      senderAvatarUrl: m.user ? this.users.get(m.user)?.avatar : undefined,
      text: this.plain(m.text ?? ''),
      attachments,
      reactions: this.reactionsOf(m.reactions),
      sentAt: Math.round(Number(m.ts) * 1000),
      isOutgoing: m.user === this.me,
      status: 'sent',
      edited: !!m.edited
    }
    return message
  }

  private reactionsOf(list?: SlackMessage['reactions']): Reaction[] {
    return (list ?? []).map((r) => ({
      emoji: EMOJI_OF[r.name.replace(/::skin-tone-\d$/, '')] ?? `:${r.name}:`,
      count: r.count,
      byMe: r.users.includes(this.me),
      names: r.users.filter((u) => u !== this.me).map((u) => this.nameOf(u))
    }))
  }

  /** Slack's markup to plain text: <@U1> → @name, <#C1|general> → #general, <url|label> → label (url). */
  private plain(text: string): string {
    return text
      .replace(/<@([A-Z0-9]+)(\|[^>]+)?>/g, (_m, id: string) => `@${this.nameOf(id)}`)
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_m, name: string) => `#${name}`)
      .replace(/<!(here|channel|everyone)>/g, (_m, who: string) => `@${who}`)
      .replace(/<(https?:[^|>]+)\|([^>]+)>/g, (_m, url: string, label: string) => (label === url ? url : `${label} (${url})`))
      .replace(/<(https?:[^>]+)>/g, '$1')
      .replace(/<mailto:([^|>]+)(\|[^>]+)?>/g, '$1')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  }

  private setStatus(status: AccountStatus, error?: string): void {
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
}
