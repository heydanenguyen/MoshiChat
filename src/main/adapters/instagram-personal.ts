import { randomUUID } from 'crypto'
import { net } from 'electron'
import { readFile as readFileAsync, writeFile as writeFileAsync } from 'fs/promises'
import { join } from 'path'
import type { Account, Conversation, ConversationStats, Message, Peer, PeerProfile, PreviewKind, SendOptions, SharedKind } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf, isShared, matchesQuery, unsentCopy } from './types'
import { mapIgItem, type IgItem, type MappedItem } from './instagram-items'
import { mapSlideNode, slideNodesOf, type SlideNode } from './instagram-slide'
import { INBOX_QUERY, MESSAGE_PAGE_QUERY, THREAD_DETAIL_QUERY, THREAD_LIST_PAGE_QUERY, convertThread, messagePageOf, slideItem, threadDetailOf, threadListOf, type GqlThread } from './instagram-graphql'
import type { WebCookie } from './facebook-personal'
import { SessionExpiredError, WebClient } from '../web-client'
import { legacyPartition } from '../web-partitions'
import { DirectComposer } from '../direct-composer'
import { InstagramRealtime, RefreshThrottle, type RealtimeKind } from '../instagram-realtime'

export interface InstagramPersonalSecret {
  cookies: WebCookie[]
  username?: string
  /** This account's own browser session (see web-partitions.ts); absent: the shared one from before. */
  partition?: string
}

interface IgUser {
  pk: number | string
  pk_id?: string
  username: string
  full_name?: string
  profile_pic_url?: string
  is_verified?: boolean
}

interface IgThread {
  thread_id: string
  /** The newer "Slide" thread id (thread_fbid) used by the web client's GraphQL. */
  thread_v2_id?: string
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
  /** In the message requests folder (not accepted yet). */
  pending?: boolean
}

/** Walking whole histories for counts/"talking since" is paused: too slow for what it shows. */
const HISTORY_CRAWL = false
/** Message requests are checked less often than the inbox: they are not urgent, and each check is a request. */
const REQUESTS_INTERVAL = 3 * 60_000
/** Safety poll; realtime events trigger refreshes within a second. */
const POLL_INTERVAL = 45_000
/**
 * Realtime refreshes come at most this often. Each one reads the whole 40-thread inbox, and receipts, reactions
 * and MarkRead events can arrive many times a minute in a busy account.
 */
const REALTIME_MIN_GAP = 4000
/** Instagram silently truncates bigger pages (100 returns 75 and claims there is nothing older). */
const PAGE_SIZE = 20
/** Delay between history pages while crawling, to stay a polite web client. */
const CRAWL_DELAY = 650
/** Pages per crawl run (~3,000 messages); a longer thread resumes the next time it is opened. */
const CRAWL_PAGES_PER_RUN = 150
/** Pages per turn before letting a more recently opened thread go first. */
const CRAWL_TURN_PAGES = 15
/** A longer breather every so many pages. */
const CRAWL_REST_EVERY = 45
const CRAWL_REST_MS = 6000
const SHARED_CAP = 600
/** Item types that are not messages a person wrote. */
const NON_MESSAGE = new Set(['action_log', 'placeholder', 'video_call_event'])

/** Per-thread history walk, persisted so counts survive restarts and only new items are fetched later. */
interface CrawlState {
  count: number
  firstAt?: number
  newestAt?: number
  cursor?: string
  done: boolean
  shared: Message[]
}
const MAX_BACKOFF = 8
const HISTORY_LIMIT = 300
/** Chats whose newest page is kept on disk for an instant first open. */
const THREAD_CACHE_CHATS = 60
const APP_HEADERS = { 'X-IG-App-ID': '936619743392459', 'X-ASBD-ID': '129477' }

/**
 * Personal Instagram through the same web endpoints instagram.com uses,
 * executed inside the session the user created in the in-app login window.
 * Messages are polled every few seconds.
 */
/** Realtime events someone is waiting to see; the rest (receipts, reactions, read marks) can wait for the spacing. */
const URGENT_KINDS = new Set<RealtimeKind>(['NewMessage', 'NewRavenMessage', 'EditMessage', 'DeleteMessage', 'AdminTextMessage'])

export class InstagramPersonalAdapter implements PlatformAdapter {
  readonly account: Account
  // All three work inside this account's own browser session (set in the constructor).
  private web: WebClient
  private composer: DirectComposer
  private realtime: InstagramRealtime
  /** Inbox reads after realtime events: coalesced, and at most every few seconds unless a message arrived. */
  private activity = new RefreshThrottle(() => void this.poll(), 350, REALTIME_MIN_GAP)
  private pollAgain = false
  /** A reaction came in over realtime: re-read reactions of the most recent chats on the next poll. */
  private reactionSweep = false
  private typingTimers = new Map<string, NodeJS.Timeout>()
  private mePk = ''
  private threads = new Map<string, IgThread>()
  /** Threads in the message requests folder, as of the last check. */
  private requestIds = new Set<string>()
  private requestsCheckedAt = 0
  /** Placeholder items ("update to the latest version") resolved through the web client's GraphQL. */
  private slideResolved = new Map<string, MappedItem>()
  private slideCache = new Map<string, { at: number; nodes: Map<string, SlideNode> }>()
  private v2Ids = new Map<string, string>()
  /** The GraphQL mailbox (inbox) id, for its later pages and the requests folder. */
  private mailboxId?: string
  /** Messaging ids (fbid) -> Instagram user ids, from the threads seen. */
  private fbidPk = new Map<string, string>()
  private slideFailures = 0
  private users = new Map<string, IgUser>()
  private history = new Map<string, Message[]>()

  cachedMessages(): Message[] {
    return [...this.history.values()].flat()
  }
  private cursors = new Map<string, string | undefined>()
  /** Chats already refreshed from the server this session (the rest may show cached messages first). */
  private refreshed = new Set<string>()
  private refreshing = new Map<string, Promise<void>>()
  private threadCacheFile = ''
  private threadCacheTimer?: NodeJS.Timeout
  private pendingPeers = new Map<string, string>()
  private aliases = new Map<string, string>()
  private timer?: NodeJS.Timeout
  private polling = false
  private crawls = new Map<string, CrawlState>()
  /** Threads with crawl work queued or running (drives the "pending" flag). */
  private crawling = new Set<string>()
  /** When each thread last finished a crawl run; catch-ups are throttled to one a minute. */
  private crawledAt = new Map<string, number>()
  /** Crawl queue, most recently requested last. */
  private crawlQueue: Array<{ threadId: string; id: string }> = []
  private crawlWorker = false
  /** Pause all crawling until this time (after Instagram throttles us). */
  private crawlPausedUntil = 0
  /** Threads that already caught up on newer items during the current job. */
  private caughtUp = new Set<string>()
  private pagesSinceRest = 0
  private crawlFile = ''
  private saveTimer?: NodeJS.Timeout
  /** Polls to skip after Instagram answers 429; doubles on each hit. */
  private skip = 0
  private backoff = 1

  constructor(
    initialId: string,
    private secret: InstagramPersonalSecret,
    private readonly ctx: AdapterContext
  ) {
    this.account = { id: initialId, platform: 'instagram', displayName: 'Instagram', status: 'disconnected', features: { reply: false, react: false, attachments: true, voice: true, unsend: true, call: 'both' } }
    const partition = secret.partition ?? legacyPartition('instagram')
    this.web = new WebClient(partition, 'https://www.instagram.com')
    this.composer = new DirectComposer(partition, (...args) => this.ctx.log(...args))
    this.realtime = new InstagramRealtime(partition, {
      onActivity: (kinds) => {
        // A reaction does not move the thread in the inbox, so the poll would not notice it: look again at recent chats.
        if (kinds.has('CreateReaction') || kinds.has('DeleteReaction')) this.reactionSweep = true
        // Messages (new, edited, taken back) show at once; receipts and reactions wait for the spacing.
        this.activity.trigger([...kinds].some((k) => URGENT_KINDS.has(k)))
      },
      onTyping: (threadId, senderId, typing) => this.onRealtimeTyping(threadId, senderId, typing),
      onSessionLost: () => this.expire(new SessionExpiredError('logged_out')),
      log: (...args) => this.ctx.log(...args)
    })
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
      // Instagram answers it with a bare 500 now and then (right after a restart, or on a new device);
      // that is not a sign-in problem, so try once more and then carry on with what is remembered.
      const me = await this.lookupSelf(pk)
      this.account.id = `instagram:ig-${pk}`
      this.account.displayName = me?.full_name || me?.username || this.secret.username || 'Instagram'
      this.account.handle = me?.username ? `@${me.username}` : this.secret.username ? `@${this.secret.username}` : undefined
      this.account.avatarUrl = me?.profile_pic_url
      this.secret = { ...this.secret, cookies: await this.web.cookies(), username: me?.username ?? this.secret.username }
    } catch (err) {
      this.web.close()
      if (err instanceof SessionExpiredError) {
        this.expire(err)
        throw new Error(sessionMessage(err), { cause: err })
      }
      this.setStatus('error', `Instagram: ${(err as Error).message}`)
      throw err
    }
    await this.ctx.saveSecret(this.secret)
    await this.loadCrawls()
    await this.loadThreadCache()
    this.realtime.start()
    this.timer = setInterval(() => {
      // Offline every request would only time out; realtime and the next tick after reconnecting catch up.
      if (net.isOnline()) void this.poll()
    }, POLL_INTERVAL)
    this.setStatus('connected')
  }

  /** Who this session belongs to; undefined when Instagram is having a moment and we already know the name. */
  private async lookupSelf(pk: string): Promise<IgUser | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const form = await this.web.json<{ form_data: { username: string; first_name?: string } }>('/api/v1/accounts/edit/web_form_data/', { headers: APP_HEADERS })
        return { pk, username: form.form_data.username, full_name: form.form_data.first_name }
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err
        const message = (err as Error).message
        // 5xx / non-JSON: Instagram's side. Anything else (a 4xx) is worth surfacing.
        if (!/HTTP 5\d\d|unexpected response|Request failed|timed out/i.test(message)) throw err
        this.ctx.log('instagram self lookup failed', attempt === 0 ? '(retrying)' : '(using the remembered name)', message)
        if (attempt === 0) await sleep(2500)
      }
    }
    return this.secret.username ? { pk, username: this.secret.username } : undefined
  }

  /** New cookies from a fresh sign-in; takes effect on the next connect(). */
  replaceCookies(cookies: WebCookie[]): void {
    this.secret = { ...this.secret, cookies }
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.activity.cancel()
    this.realtime.stop()
    this.web.close()
    this.composer.close()
    this.setStatus('disconnected')
  }

  async listConversations(): Promise<Conversation[]> {
    const [inbox, requests] = await Promise.all([
      this.inbox(),
      this.requestsFolder().catch((err) => {
        this.ctx.log('instagram requests failed', (err as Error).message)
        return [] as IgThread[]
      })
    ])
    const list = [...inbox, ...requests].map((thread) => this.toConversation(thread))
    // Count the most recent threads quietly so their numbers are ready when opened.
    for (const thread of inbox.slice(0, 12)) this.ensureCrawl(thread.thread_id, conversationId(this.account.id, thread.thread_id), true)
    void this.resolveListPreviews(inbox.slice(0, 20))
    return list
  }

  async fetchMessages(id: string, options: FetchMessagesOptions): Promise<Message[]> {
    return this.guard(() => this.fetchPage(id, options))
  }

  private async fetchPage(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const threadId = this.threadIdFor(id)
    if (!threadId) return this.history.get(id) ?? []
    // Opening a chat we already know (this session or from the disk cache): show it at once and
    // refresh quietly; new or changed messages arrive as updates.
    if (!beforeId && !this.refreshed.has(id)) {
      const cached = this.history.get(id)
      if (cached?.length) {
        this.refreshed.add(id)
        const refresh = this.guard(() => this.refreshThread(id, threadId))
          .catch((err) => {
            this.refreshed.delete(id)
            this.ctx.log('instagram refresh failed', (err as Error).message)
          })
          .finally(() => this.refreshing.delete(id))
        this.refreshing.set(id, refresh)
        return cached.slice().sort((a, b) => a.sentAt - b.sentAt)
      }
    }
    if (!beforeId) this.refreshed.add(id)
    let cursor: string | undefined
    if (beforeId) {
      // Scrolling up right after opening: wait for the refresh that knows where older pages start.
      await this.refreshing.get(id)
      cursor = this.cursors.get(id)
      if (!cursor) return []
    }
    const collected: Message[] = []
    // One page per call: the first screen shows sooner; scrolling up loads the next page.
    for (let i = 0; i < Math.max(1, Math.ceil(Math.min(limit, PAGE_SIZE) / PAGE_SIZE)); i++) {
      // The Slide lookup does not depend on the page, so both requests run at once.
      const warm = cursor ? undefined : this.warmSlides(threadId)
      const page = await this.page(threadId, cursor)
      await warm
      await this.resolveSlide(threadId, page.items)
      collected.push(...page.items.filter((item) => this.visible(item)).map((item) => this.toMessage(item, id)))
      cursor = page.hasOlder ? page.cursor : undefined
      if (!cursor) break
    }
    this.cursors.set(id, cursor)
    this.remember(id, collected)
    const known = this.threads.get(threadId)
    if (known) this.applySeen(known, false)
    return (this.history.get(id) ?? collected).filter((m) => collected.some((c) => c.id === m.id)).sort((a, b) => a.sentAt - b.sentAt)
  }

  async historySince(id: string, from: number, onPage: (messages: Message[]) => void): Promise<'complete' | 'partial'> {
    const threadId = this.threadIdFor(id)
    if (!threadId) return 'complete'
    let cursor: string | undefined
    // 20 items a page: a very chatty month is a few thousand messages, so allow plenty of pages.
    for (let i = 0; i < 250; i++) {
      const page = await this.guard(() => this.page(threadId, cursor))
      const messages = page.items.filter((item) => this.visible(item)).map((item) => this.toMessage(item, id))
      if (messages.length) onPage(messages)
      const times = page.items.map((item) => Number(item.timestamp) / 1000).filter((t) => t > 0)
      if (!page.hasOlder || !page.cursor || !times.length) return 'complete'
      if (Math.min(...times) < from) return 'complete'
      cursor = page.cursor
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    return 'partial'
  }

  /** One page of a thread, newest first. */
  /**
   * One page of a chat, newest first: the newest 20 from the thread query, older ones from the message list query
   * with the cursor it gave. Both are the web client's own GraphQL (direct_v2's thread endpoint answers 404).
   */
  private async page(threadId: string, cursor?: string): Promise<{ items: IgItem[]; cursor?: string; hasOlder: boolean }> {
    const v2 = this.threads.get(threadId)?.thread_v2_id ?? this.v2Ids.get(threadId)
    if (!v2) throw new Error('Instagram chat not found in the inbox yet')
    let nodes: SlideNode[]
    let next: { cursor?: string; hasOlder: boolean }
    if (!cursor) {
      const detail = threadDetailOf(await this.realtime.graphql(THREAD_DETAIL_QUERY, { thread_fbid: v2, min_uq_seq_id: null }))
      if (detail) {
        const thread = this.absorbGraphqlThread(detail)
        this.absorbUsers(thread.users)
        const known = this.threads.get(threadId)
        if (known) known.last_seen_at = thread.last_seen_at
      }
      const page = messagePageOf(detail?.slide_messages ?? {})
      nodes = page.nodes
      next = page
    } else {
      const page = messagePageOf(await this.realtime.graphql(MESSAGE_PAGE_QUERY, { id: v2, after: cursor, first: PAGE_SIZE }))
      nodes = page.nodes
      next = page
    }
    const items = nodes.map((node) => {
      const item = slideItem(node, this.fbidPk)
      this.slideResolved.set(item.item_id, mapSlideNode(node, item.item_id))
      return item
    })
    return { items, cursor: next.cursor, hasOlder: next.hasOlder }
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    return this.guard(() => this.send(id, text, options))
  }

  private async send(id: string, text: string, options: SendOptions): Promise<Message> {
    if (options.attachments?.length) return this.sendAttachments(id, text, options)
    if (!text.trim()) throw new Error('Message is empty')
    const external = externalIdOf(id)
    const threadId = await this.resolveThread(id)
    let url: string[]
    if (threadId) url = this.threadUrls(threadId)
    else {
      const peer = this.users.get(this.pendingPeers.get(external) ?? '')
      if (!peer?.username) throw new Error('Unknown Instagram recipient')
      url = [`new:${peer.username}`, `https://ig.me/m/${peer.username}`]
    }
    const sentAt = Date.now()
    await this.composer.send(url, text)

    // Pick up the real item id (reads are safe on the web API); fall back to a local id.
    let itemId: string | undefined
    const resolvedThread = threadId ?? (await this.findThreadFor(external))
    if (resolvedThread) {
      if (!threadId) this.aliases.set(external, resolvedThread)
      try {
        const res = { thread: { items: (await this.page(resolvedThread)).items } }
        const mine = (res.thread.items ?? []).find((item) => String(item.user_id) === this.mePk && this.mapped(item).text === text)
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

  /**
   * Photos, videos and voice notes go through Instagram's own picker, then any text as its own
   * message (Instagram has no captions in DMs). The returned message is read back from the thread.
   */
  private async sendAttachments(id: string, text: string, options: SendOptions): Promise<Message> {
    const external = externalIdOf(id)
    let threadId = await this.resolveThread(id)
    let url: string[]
    if (threadId) url = this.threadUrls(threadId)
    else {
      // New contact: open Instagram's composer for them (ig.me), the thread appears after the first send.
      const peer = this.users.get(this.pendingPeers.get(external) ?? '')
      if (!peer?.username) throw new Error('Unknown Instagram recipient')
      url = [`new:${peer.username}`, `https://ig.me/m/${peer.username}`]
    }
    const sentAt = Date.now()
    // A sticker that is on GIPHY goes the way Instagram's app sends one: picked from its GIF and sticker tray, so it
    // arrives as a real sticker (moving, see-through). If the tray cannot find it, a Moshi sticker still goes as the
    // still on white; a GIPHY sticker has nothing better to fall back to, so that error is shown.
    const [only, ...more] = options.attachments ?? []
    let viaTray = false
    if (only?.giphy && !more.length) {
      try {
        await this.composer.sendSticker(url, only.giphy)
        viaTray = true
      } catch (err) {
        if (only.sticker?.startsWith('giphy:') || err instanceof SessionExpiredError) throw err
        this.ctx.log('instagram sticker tray failed, sending the still', (err as Error).message)
      }
    }
    const files = (options.attachments ?? []).map((file) => {
      // Voice notes are recorded as Opus and AAC together; Instagram plays AAC (.m4a) natively.
      const aac = file.alternates?.find((alt) => alt.mime === 'audio/mp4')
      // Stickers: Instagram turns transparent PNGs into JPEGs, so use the copy on white.
      const opaque = file.sticker ? file.alternates?.find((alt) => alt.role === 'opaque') : undefined
      // GIFs: Instagram's uploader takes MP4 but not GIF.
      const mp4 = file.gif ? file.alternates?.find((alt) => alt.mime === 'video/mp4') : undefined
      const chosen = aac ?? opaque ?? mp4 ?? { path: file.path, mime: file.mime }
      if (!/^(image\/(jpeg|png)|video\/(mp4|quicktime)|audio\/)/.test(chosen.mime)) {
        throw new Error(`Instagram can send JPEG/PNG photos, MP4/MOV videos and voice notes, not ${file.name}`)
      }
      return chosen.path
    })
    if (!viaTray) await this.composer.sendFiles(url, files)
    if (!threadId) {
      for (let attempt = 0; attempt < 6 && !threadId; attempt++) {
        await sleep(1500)
        threadId = await this.findThreadFor(external)
      }
      if (threadId) this.aliases.set(external, threadId)
    }
    if (text.trim()) await this.composer.send(threadId ? this.threadUrls(threadId) : url, text)
    if (!threadId) {
      // Sent, but the new thread is not listed yet: show the local copy; the next refresh reconciles it.
      const local: Message = {
        id: `local-${randomUUID()}`,
        conversationId: id,
        senderId: this.mePk,
        senderName: this.account.displayName,
        senderAvatarUrl: this.account.avatarUrl,
        text: '',
        attachments: (options.attachments ?? []).map((f, i) => ({ id: `local-${i}`, kind: f.sticker ? 'sticker' : f.mime.startsWith('video/') ? 'video' : 'image', url: f.preview })),
        reactions: [],
        sentAt,
        isOutgoing: true,
        status: 'sent'
      }
      this.remember(id, [local])
      return local
    }

    // Read back what Instagram stored (uploads can take a few seconds to show up).
    let sent: IgItem | undefined
    for (let attempt = 0; attempt < 12 && !sent; attempt++) {
      await sleep(attempt ? 2500 : 1200)
      try {
        const res = { thread: { items: (await this.page(threadId)).items } }
        sent = (res.thread.items ?? [])
          .filter((item) => String(item.user_id) === this.mePk && Number(item.timestamp) / 1000 >= sentAt - 5000 && item.item_type !== 'text')
          .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))[0]
      } catch {
        /* keep waiting */
      }
    }
    if (!sent) throw new Error('Instagram did not confirm the upload yet. Check the conversation before sending again')
    await this.resolveSlide(threadId, [sent])
    const message = this.toMessage(sent, id)
    this.remember(id, [message])
    // Text sent right after shows up through the next refresh.
    this.onRealtimeActivity()
    return message
  }

  /**
   * Addresses of a thread on instagram.com, best first. The web client moved to the newer "Slide" id
   * (thread_v2_id) in its URLs; the legacy direct_v2 id is kept as a fallback for threads without one.
   */
  private threadUrls(threadId: string): string[] {
    const v2 = this.threads.get(threadId)?.thread_v2_id ?? this.v2Ids.get(threadId)
    const ids = v2 && v2 !== threadId ? [v2, threadId] : [threadId]
    return ids.map((id) => `https://www.instagram.com/direct/t/${id}/`)
  }

  /**
   * The thread behind a conversation. Chats opened from the contact list carry a peer id instead
   * (`u<pk>`), and that link is only in memory, so look the thread up in the inbox before sending:
   * instagram.com only shows a composer for a real thread address (ig.me landing pages have none).
   */
  /** Search Instagram's own GIF and sticker tray in this thread (nothing is sent): GIPHY ids, no GIPHY key needed. */
  async searchTrayStickers(id: string, query: string): Promise<string[]> {
    const threadId = await this.resolveThread(id)
    if (!threadId) throw new Error('Send a first message to this person, then stickers can be searched here')
    return this.composer.searchStickers(this.threadUrls(threadId), query)
  }

  private async resolveThread(id: string): Promise<string | undefined> {
    const known = this.threadIdFor(id)
    if (known) return known
    const external = externalIdOf(id)
    if (!external.startsWith('u')) return undefined
    const peerPk = this.pendingPeers.get(external) ?? external.slice(1)
    if (!this.pendingPeers.has(external)) this.pendingPeers.set(external, peerPk)
    const found = await this.findThreadFor(external)
    if (found) {
      this.aliases.set(external, found)
      this.ctx.log('instagram: resolved chat', external, 'to thread', found)
    }
    return found
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

  /**
   * Not offered yet (features.react is off): the reaction call is app-only. www answers 404, the page may not reach
   * i.instagram.com (CORS) and the main process gets net::ERR_FAILED there. Kept, with its logs, for the next try.
   * React the way Instagram's apps do (one reaction per person: a new emoji replaces yours, the same one takes it
   * back). Shown at once; the next refresh brings Instagram's own copy.
   */
  async react(id: string, messageId: string, emoji: string): Promise<void> {
    const threadId = this.threadIdFor(id)
    this.ctx.log('instagram reaction: sending', emoji, threadId ? 'to thread' : `no thread for ${id}`)
    if (!threadId) throw new Error('Conversation not found')
    const list = this.history.get(id)
    const index = list?.findIndex((m) => m.id === messageId) ?? -1
    const current = list && index >= 0 ? list[index] : undefined
    const removing = !!current?.reactions.some((r) => r.byMe && r.emoji === emoji)
    const token = String(BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000)))
    // The broadcast call lives on Instagram's app API host: www answers 404 and the page may not call it (CORS),
    // so it goes from the main process with the web session's cookies.
    const answer = await this.web
      .postFrom(
        'https://i.instagram.com/api/v1/direct_v2/threads/broadcast/reaction/',
        {
          action: 'send_item',
          thread_ids: `[${threadId}]`,
          item_id: messageId,
          node_type: 'item',
          reaction_type: 'like',
          reaction_status: removing ? 'deleted' : 'created',
          emoji: removing ? '' : emoji,
          client_context: token,
          mutation_token: token,
          offline_threading_id: token,
          is_shh_mode: '0',
          send_attribution: 'direct_thread',
          original_message_client_context: ''
        },
        APP_HEADERS
      )
      .then((res) => res as { status?: string })
      .catch((err: Error) => {
        this.ctx.log('instagram reaction failed', err.message)
        throw err
      })
    this.ctx.log('instagram reaction', removing ? 'removed' : emoji, JSON.stringify(answer).slice(0, 300))
    if (answer?.status && answer.status !== 'ok') throw new Error('Instagram did not take the reaction')
    if (!list || !current) return
    let reactions = current.reactions.map((r) => (r.byMe ? { ...r, count: r.count - 1, byMe: false } : r)).filter((r) => r.count > 0)
    if (!removing) {
      const existing = reactions.find((r) => r.emoji === emoji)
      reactions = existing ? reactions.map((r) => (r === existing ? { ...r, count: r.count + 1, byMe: true } : r)) : [...reactions, { emoji, count: 1, byMe: true }]
    }
    list[index] = { ...current, reactions }
    this.ctx.emit({ type: 'message:reactions', conversationId: id, messageId, reactions })
    this.saveThreadCache()
  }

  /** Unsend: the same call Instagram's own apps make to take a message back for everyone. */
  async unsend(id: string, messageId: string): Promise<void> {
    const threadId = this.threadIdFor(id)
    if (!threadId) throw new Error('Conversation not found')
    await this.web.json(`/api/v1/direct_v2/threads/${threadId}/items/${messageId}/delete/`, {
      method: 'POST',
      form: { is_shh_mode: '0', send_attribution: 'direct_thread', original_message_client_context: '' },
      headers: APP_HEADERS
    })
    const list = this.history.get(id)
    const index = list?.findIndex((m) => m.id === messageId) ?? -1
    if (list && index >= 0) {
      list[index] = unsentCopy(list[index])
      this.ctx.emit({ type: 'message:updated', message: { ...list[index] } })
    }
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

  async getConversationStats(id: string): Promise<ConversationStats> {
    const threadId = this.threadIdFor(id)
    if (!threadId) return { messageCount: 0, approximate: false }
    this.ensureCrawl(threadId, id)
    const state = this.crawls.get(threadId)
    const recent = this.history.get(id) ?? []
    return {
      firstMessageAt: state?.firstAt,
      lastMessageAt: Math.max(state?.newestAt ?? 0, recent.at(-1)?.sentAt ?? 0) || undefined,
      messageCount: state?.count,
      approximate: !state?.done,
      pending: this.crawling.has(threadId) && !state?.done
    }
  }

  async listShared(id: string, kind: SharedKind, limit: number): Promise<Message[]> {
    const threadId = this.threadIdFor(id)
    if (threadId) this.ensureCrawl(threadId, id)
    const seen = new Set<string>()
    const out: Message[] = []
    for (const m of [...(this.history.get(id) ?? []), ...(threadId ? (this.crawls.get(threadId)?.shared ?? []) : [])]) {
      if (seen.has(m.id) || !isShared(m, kind)) continue
      seen.add(m.id)
      out.push(m)
    }
    return out.sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  // ---- history crawl ------------------------------------------------------

  /**
   * Walk the whole thread once (persisted), then only catch up on newer
   * items. One thread at a time, paced, and it stops on the first error so a
   * throttled or signed-out session is left alone.
   */
  private ensureCrawl(threadId: string, id: string, background = false): void {
    if (!HISTORY_CRAWL) return
    const existing = this.crawls.get(threadId)
    if (existing?.done && !this.crawling.has(threadId) && Date.now() - (this.crawledAt.get(threadId) ?? 0) < 60_000) return
    // Background work never overtakes something the user asked for, and finished threads need no pre-count.
    if (background && (existing?.done || this.crawling.has(threadId))) return
    if (!existing) this.crawls.set(threadId, { count: 0, done: false, shared: [] })
    // Most recently requested goes to the back = next to run; background jobs go to the front (last).
    this.crawlQueue = this.crawlQueue.filter((job) => job.threadId !== threadId)
    if (background) this.crawlQueue.unshift({ threadId, id })
    else this.crawlQueue.push({ threadId, id })
    if (!this.crawling.has(threadId)) this.caughtUp.delete(threadId)
    this.crawling.add(threadId)
    void this.runCrawler()
  }

  private async runCrawler(): Promise<void> {
    if (this.crawlWorker) return
    this.crawlWorker = true
    try {
      while (this.crawlQueue.length) {
        if (Date.now() < this.crawlPausedUntil || this.account.status !== 'connected') break
        const job = this.crawlQueue[this.crawlQueue.length - 1]
        const state = this.crawls.get(job.threadId)!
        let finished = false
        try {
          if (state.newestAt !== undefined && !this.caughtUp.has(job.threadId)) {
            await this.catchUp(job.threadId, job.id, state)
            this.caughtUp.add(job.threadId)
          }
          const before = state.count
          if (!state.done) await this.walkBack(job.threadId, job.id, state, CRAWL_TURN_PAGES)
          finished = state.done
          if (import.meta.env.DEV) this.ctx.log('instagram crawl turn: +' + (state.count - before) + ' messages, done=' + state.done + ', queue=' + this.crawlQueue.length)
        } catch (err) {
          finished = true
          if (err instanceof SessionExpiredError) {
            this.expire(err)
            this.crawlQueue = []
          } else if (/429|wait a few minutes|rate/i.test((err as Error).message)) {
            this.crawlPausedUntil = Date.now() + 10 * 60_000
            this.ctx.log('instagram crawl paused for 10 minutes (rate limited)')
          } else {
            this.ctx.log('instagram crawl stopped', (err as Error).message)
          }
        }
        // Take the job off the top; unfinished work moves to the front (lowest priority).
        this.crawlQueue = this.crawlQueue.filter((j) => j !== job)
        if (finished) {
          this.crawling.delete(job.threadId)
          this.crawledAt.set(job.threadId, Date.now())
        } else {
          this.crawlQueue.unshift(job)
        }
        this.scheduleSave()
      }
    } finally {
      this.crawlWorker = false
      if (Date.now() < this.crawlPausedUntil || this.account.status !== 'connected') {
        for (const job of this.crawlQueue) this.crawling.delete(job.threadId)
        this.crawlQueue = []
      }
    }
  }

  private async catchUp(threadId: string, id: string, state: CrawlState): Promise<void> {
    const since = state.newestAt ?? 0
    let cursor: string | undefined
    for (let pages = 0; pages < 25; pages++) {
      const page = await this.page(threadId, cursor)
      let reachedKnown = false
      for (const item of page.items) {
        if (Number(item.timestamp) / 1000 <= since) {
          reachedKnown = true
          break
        }
        this.absorbItem(state, item, id)
      }
      if (reachedKnown || !page.hasOlder || !page.cursor) return
      cursor = page.cursor
      await sleep(CRAWL_DELAY)
    }
  }

  private async walkBack(threadId: string, id: string, state: CrawlState, maxPages = CRAWL_PAGES_PER_RUN): Promise<void> {
    for (let pages = 0; pages < maxPages; pages++) {
      const page = await this.page(threadId, state.cursor)
      for (const item of page.items) this.absorbItem(state, item, id)
      state.cursor = page.cursor
      if (!page.hasOlder || !page.cursor) {
        state.done = true
        return
      }
      if (pages % 10 === 9) this.scheduleSave()
      this.pagesSinceRest += 1
      await sleep(this.pagesSinceRest % CRAWL_REST_EVERY === 0 ? CRAWL_REST_MS : CRAWL_DELAY)
    }
  }

  private absorbItem(state: CrawlState, item: IgItem, id: string): void {
    const at = Number(item.timestamp) / 1000
    if (!state.firstAt || at < state.firstAt) state.firstAt = at
    if (!state.newestAt || at > state.newestAt) state.newestAt = at
    if (NON_MESSAGE.has(item.item_type)) return
    state.count += 1
    const message = this.toMessage(item, id)
    if (isShared(message, 'media') || isShared(message, 'links') || isShared(message, 'files')) {
      if (!state.shared.some((m) => m.id === message.id)) {
        state.shared.push(message)
        if (state.shared.length > SHARED_CAP) {
          state.shared.sort((a, b) => b.sentAt - a.sentAt)
          state.shared.length = SHARED_CAP
        }
      }
    }
  }

  private async loadCrawls(): Promise<void> {
    this.crawlFile = join(this.ctx.dataDir(), `crawl-${this.mePk}.json`)
    try {
      const raw = JSON.parse(await readFileAsync(this.crawlFile, 'utf8')) as Record<string, CrawlState>
      for (const [threadId, state] of Object.entries(raw)) this.crawls.set(threadId, { ...state, shared: state.shared ?? [] })
    } catch {
      /* first run */
    }
  }

  private scheduleSave(): void {
    if (!this.crawlFile) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      const data = Object.fromEntries(this.crawls)
      void writeFileAsync(this.crawlFile, JSON.stringify(data)).catch(() => undefined)
    }, 1500)
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

  /**
   * A thread from the web client's GraphQL, kept in the direct_v2 shape the rest of the adapter uses; its messages
   * come mapped from their Slide nodes, and its people's messaging ids are remembered for later senders.
   */
  private absorbGraphqlThread(t: GqlThread): IgThread {
    const converted = convertThread(t, this.mePk)
    for (const [fbid, pk] of converted.fbids) this.fbidPk.set(fbid, pk)
    for (const [itemId, node] of converted.nodes) this.slideResolved.set(itemId, mapSlideNode(node, itemId))
    const thread = converted.thread as IgThread
    if (thread.thread_v2_id) this.v2Ids.set(thread.thread_id, thread.thread_v2_id)
    return thread
  }

  /**
   * Inbox threads: the first page (PolarisDirectInboxQuery) and, for the chat list, two more (the 40 or so direct_v2
   * gave). The poll every 45 s only needs the newest page.
   */
  private async inbox(pages = 3): Promise<IgThread[]> {
    const first = threadListOf(await this.realtime.graphql(INBOX_QUERY, { device_id_for_iris_subscription: randomUUID() }))
    this.mailboxId = first.mailboxId ?? this.mailboxId
    const raw = [...first.threads]
    let cursor = first.hasMore ? first.cursor : undefined
    for (let pageNo = 1; pageNo < pages && cursor && this.mailboxId; pageNo++) {
      const next = threadListOf(await this.realtime.graphql(THREAD_LIST_PAGE_QUERY, { id: this.mailboxId, cursor, count: 15, folder: 'INBOX', newer_than_timestamp_ms: null }))
      raw.push(...next.threads)
      cursor = next.hasMore ? next.cursor : undefined
    }
    const viewerPic = raw.find((t) => t.viewer?.profile_pic_url)?.viewer?.profile_pic_url
    if (viewerPic && this.account.avatarUrl !== viewerPic) {
      this.account.avatarUrl = viewerPic
      this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
    }
    const seen = new Set<string>()
    const threads = raw.filter((t) => !seen.has(String(t.thread_id)) && seen.add(String(t.thread_id))).map((t) => this.absorbGraphqlThread(t))
    for (const thread of threads) {
      this.threads.set(thread.thread_id, thread)
      this.absorbUsers(thread.users)
      this.applySeen(thread)
      // In the inbox now: accepted (here, on the phone or on the web).
      this.requestIds.delete(thread.thread_id)
      thread.pending = false
    }
    return threads
  }

  /**
   * The message requests folder: people you do not follow who wrote first. Read-only, nothing is marked seen.
   * Only the newest page is read, so a request that drops off it stays a request: a thread leaves Requests when
   * it shows up in the inbox (accepted), never by going missing here.
   */
  private async requestsFolder(): Promise<IgThread[]> {
    // Counted as checked even if it fails, so a rate limit is not hit again on every poll.
    this.requestsCheckedAt = Date.now()
    if (!this.mailboxId) return []
    const res = threadListOf(await this.realtime.graphql(THREAD_LIST_PAGE_QUERY, { id: this.mailboxId, cursor: null, count: 20, folder: 'PENDING', newer_than_timestamp_ms: null }))
    const threads = res.threads.map((t) => this.absorbGraphqlThread(t))
    for (const thread of threads) {
      if (this.threads.get(thread.thread_id)?.pending === false && !this.requestIds.has(thread.thread_id)) continue
      this.requestIds.add(thread.thread_id)
      this.threads.set(thread.thread_id, { ...thread, pending: true })
      this.absorbUsers(thread.users)
    }
    return threads
  }

  /** Every few minutes: new requests appear (ones accepted elsewhere leave through the inbox). */
  private async refreshRequests(): Promise<void> {
    if (Date.now() - this.requestsCheckedAt < REQUESTS_INTERVAL) return
    for (const thread of await this.requestsFolder()) {
      if (!this.requestIds.has(thread.thread_id)) continue
      this.ctx.emit({ type: 'conversation:upserted', conversation: this.toConversation(this.threads.get(thread.thread_id) ?? thread) })
    }
  }

  /** Accept a message request: the thread moves to the inbox on Instagram too. */
  async acceptRequest(id: string): Promise<void> {
    const threadId = this.threadIdFor(id)
    if (!threadId || !this.requestIds.has(threadId)) return
    await this.guard(() => this.web.json(`/api/v1/direct_v2/threads/${threadId}/approve/`, { method: 'POST', form: {}, headers: APP_HEADERS }))
    this.requestIds.delete(threadId)
    const thread = this.threads.get(threadId)
    if (thread) {
      thread.pending = false
      this.ctx.emit({ type: 'conversation:upserted', conversation: this.toConversation(thread) })
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) {
      // A realtime event arrived mid-refresh: run once more right after.
      this.pollAgain = true
      return
    }
    if (this.skip > 0) {
      this.skip -= 1
      return
    }
    this.polling = true
    try {
      const before = new Map([...this.threads].map(([k, t]) => [k, (t.last_permanent_item ?? t.items?.[0])?.item_id]))
      const activity = new Map([...this.threads].map(([k, t]) => [k, String(t.last_activity_at ?? '')]))
      const threads = await this.inbox(1)
      const sweep = this.reactionSweep
      this.reactionSweep = false
      const refreshed = new Set<string>()
      for (const thread of threads) {
        const id = conversationId(this.account.id, thread.thread_id)
        const lastId = (thread.last_permanent_item ?? thread.items?.[0])?.item_id
        if (before.get(thread.thread_id) === lastId) {
          // No new message, but something happened (a reaction, taken back, an edit): refresh what is on screen.
          const moved = activity.has(thread.thread_id) && activity.get(thread.thread_id) !== String(thread.last_activity_at ?? '')
          if (moved && this.history.get(id)?.length) {
            const res = { thread: { items: (await this.page(thread.thread_id)).items } }
            this.syncReactions(id, res.thread.items ?? [])
            refreshed.add(thread.thread_id)
          }
          continue
        }
        this.ctx.emit({ type: 'conversation:upserted', conversation: this.toConversation(thread) })
        const known = this.history.get(id)
        if (!known || !lastId || known.some((m) => m.id === lastId)) continue
        const res = { thread: { items: (await this.page(thread.thread_id)).items } }
        await this.resolveSlide(thread.thread_id, res.thread.items ?? [])
        this.syncReactions(id, res.thread.items ?? [])
        refreshed.add(thread.thread_id)
        const fresh = (res.thread.items ?? [])
          .filter((item) => !known.some((m) => m.id === item.item_id) && this.visible(item))
          .map((item) => this.toMessage(item, id))
          .sort((a, b) => a.sentAt - b.sentAt)
        this.remember(id, fresh)
        const state = this.crawls.get(thread.thread_id)
        if (state?.newestAt !== undefined) {
          for (const item of res.thread.items ?? []) if (Number(item.timestamp) / 1000 > state.newestAt) this.absorbItem(state, item, id)
          this.scheduleSave()
        }
        // Includes messages the user sent from another device; the app dedupes by id.
        for (const message of fresh) this.ctx.emit({ type: 'message:new', message })
      }
      if (sweep) {
        // The three chats active last (the reaction is almost always in one of them), if they are on screen at all.
        const recent = threads
          .filter((t) => !refreshed.has(t.thread_id) && this.history.get(conversationId(this.account.id, t.thread_id))?.length)
          .sort((a, b) => Number(b.last_activity_at ?? 0) - Number(a.last_activity_at ?? 0))
          .slice(0, 3)
        for (const thread of recent) {
          const res = { thread: { items: (await this.page(thread.thread_id)).items } }
          this.syncReactions(conversationId(this.account.id, thread.thread_id), res.thread.items ?? [])
        }
      }
      await this.refreshRequests().catch((err) => {
        if (err instanceof SessionExpiredError) throw err
        this.ctx.log('instagram requests failed', (err as Error).message)
      })
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
      if (this.pollAgain) {
        this.pollAgain = false
        setTimeout(() => void this.poll(), 200)
      }
    }
  }

  private onRealtimeActivity(): void {
    // Coalesced, and spaced out so a stream of receipts does not turn into a stream of inbox reads.
    this.activity.trigger()
  }

  private onRealtimeTyping(threadId: string, senderId: string, typing: boolean): void {
    if (senderId === this.mePk) return
    const id = conversationId(this.account.id, threadId)
    const user = this.users.get(senderId)
    const peerName = user?.full_name || user?.username || 'Instagram'
    const existing = this.typingTimers.get(id)
    if (existing) clearTimeout(existing)
    this.ctx.emit({ type: 'typing', typing: { conversationId: id, peerName, isTyping: typing } })
    if (typing) {
      // Instagram's own TTL is ~11s; stop showing it if no "stopped" event arrives.
      this.typingTimers.set(
        id,
        setTimeout(() => this.ctx.emit({ type: 'typing', typing: { conversationId: id, peerName, isTyping: false } }), 11_000)
      )
    }
  }

  /** Mark our messages as read up to the latest point any other participant has seen. */
  private applySeen(thread: IgThread, emit = true): void {
    const id = conversationId(this.account.id, thread.thread_id)
    const list = this.history.get(id)
    if (!list?.length) return
    let seenAt = 0
    for (const [pk, seen] of Object.entries(thread.last_seen_at ?? {})) {
      if (pk === this.mePk || !seen?.timestamp) continue
      seenAt = Math.max(seenAt, Number(seen.timestamp) / 1000)
    }
    if (!seenAt) return
    for (const message of list) {
      if (!message.isOutgoing || message.status === 'read' || message.sentAt > seenAt + 1) continue
      message.status = 'read'
      if (emit) this.ctx.emit({ type: 'message:updated', message: { ...message } })
    }
  }

  /** Run a request; if Instagram ended the session, stop polling and ask the user to sign in again. */
  private async guard<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task()
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.expire(err)
        throw new Error(sessionMessage(err), { cause: err })
      }
      throw err
    }
  }

  private expire(err: SessionExpiredError): void {
    if (this.account.status === 'needs_auth') return
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.realtime.stop()
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
      request: !!thread.pending || this.requestIds.has(thread.thread_id),
      lastMessage: last
        ? { id: last.item_id, ...this.previewOf(last), senderName: lastMine ? this.account.displayName : (others[0]?.full_name || others[0]?.username || ''), isOutgoing: lastMine, sentAt: lastAt }
        : undefined,
      updatedAt: lastAt || Date.now()
    }
  }

  private mapContext = {
    mePk: '',
    nameOf: (pk: string): string | undefined => {
      const user = this.users.get(pk)
      return user?.full_name || user?.username
    }
  }

  private mapped(item: IgItem): ReturnType<typeof mapIgItem> {
    const resolved = this.slideResolved.get(item.item_id)
    if (resolved) return resolved
    this.mapContext.mePk = this.mePk
    return mapIgItem(item, this.mapContext)
  }

  /**
   * Messages in Instagram's newer format come back from direct_v2 as "Message unavailable"
   * placeholders. The web client reads them through GraphQL (IGDThreadDetailQuery, newest 20),
   * so do the same and remember the result per item.
   */
  /** The newest Slide messages of a thread (the web client's own thread query). */
  private async fetchSlideNodes(threadId: string, v2: string): Promise<{ at: number; nodes: Map<string, SlideNode> } | undefined> {
    try {
      const res = await this.realtime.graphql('IGDThreadDetailQuery', {
        min_uq_seq_id: null,
        thread_fbid: v2,
        __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider: true,
        __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: 20
      })
      const cached = { at: Date.now(), nodes: new Map(slideNodesOf(res).flatMap((n) => (n.message_id ? [[n.message_id, n] as const] : []))) }
      this.slideCache.set(threadId, cached)
      this.slideFailures = 0
      return cached
    } catch (err) {
      this.slideFailures += 1
      this.ctx.log('instagram slide lookup failed', (err as Error).message)
      return undefined
    }
  }

  /** Start the Slide lookup early, alongside the page request (opening a chat is then one round trip). */
  private async warmSlides(threadId: string): Promise<void> {
    // Pages come from the thread query itself now, already mapped: a second lookup would only repeat it.
    if (this.threads.get(threadId)?.items?.every((item) => this.slideResolved.has(item.item_id))) return
    const v2 = this.threads.get(threadId)?.thread_v2_id ?? this.v2Ids.get(threadId)
    if (!v2 || this.slideFailures >= 5) return
    const cached = this.slideCache.get(threadId)
    if (cached && Date.now() - cached.at < 5_000) return
    await this.fetchSlideNodes(threadId, v2)
  }

  /** Newest page from the server for a chat that was shown from cache; changes go out as updates. */
  private async refreshThread(id: string, threadId: string): Promise<void> {
    const warm = this.warmSlides(threadId)
    const page = await this.page(threadId)
    await warm
    await this.resolveSlide(threadId, page.items)
    const fresh = page.items.filter((item) => this.visible(item)).map((item) => this.toMessage(item, id))
    this.cursors.set(id, page.hasOlder ? page.cursor : undefined)
    const before = new Map((this.history.get(id) ?? []).map((m) => [m.id, JSON.stringify(m)]))
    this.remember(id, fresh)
    // Updates, not "new": these are not new arrivals and must not notify.
    for (const message of fresh) if (before.get(message.id) !== JSON.stringify(message)) this.ctx.emit({ type: 'message:updated', message })
  }

  private async loadThreadCache(): Promise<void> {
    this.threadCacheFile = join(this.ctx.dataDir(), `threads-v2-${this.mePk}.json`)
    try {
      const raw = JSON.parse(await readFileAsync(this.threadCacheFile, 'utf8')) as Record<string, Message[]>
      for (const [id, list] of Object.entries(raw)) if (!this.history.has(id) && Array.isArray(list)) this.history.set(id, list)
    } catch {
      /* first run */
    }
  }

  /** The newest page of the most recent chats, so reopening after a restart is instant. */
  private saveThreadCache(): void {
    if (!this.threadCacheFile) return
    if (this.threadCacheTimer) clearTimeout(this.threadCacheTimer)
    this.threadCacheTimer = setTimeout(() => {
      const slim = (m: Message): Message => ({
        ...m,
        // Local previews of sent photos can be large data URLs; the server copy replaces them anyway.
        attachments: m.attachments.map((a) => (a.url?.startsWith('data:') && a.url.length > 20_000 ? { ...a, url: undefined } : a))
      })
      const entries = [...this.history.entries()]
        .filter(([, list]) => list.length)
        .sort((a, b) => (b[1].at(-1)?.sentAt ?? 0) - (a[1].at(-1)?.sentAt ?? 0))
        .slice(0, THREAD_CACHE_CHATS)
        .map(([id, list]) => [id, list.slice(-PAGE_SIZE).map(slim)] as const)
      void writeFileAsync(this.threadCacheFile, JSON.stringify(Object.fromEntries(entries))).catch(() => undefined)
    }, 3_000)
  }

  private async resolveSlide(threadId: string, items: IgItem[]): Promise<void> {
    const pending = items.filter((item) => item.item_type === 'placeholder' && item.message_id && !this.slideResolved.has(item.item_id))
    if (!pending.length || this.slideFailures >= 5) return
    const v2 = this.threads.get(threadId)?.thread_v2_id ?? this.v2Ids.get(threadId)
    if (!v2) return
    let cached = this.slideCache.get(threadId)
    const missing = (c?: { nodes: Map<string, SlideNode> }): boolean => pending.some((item) => !c?.nodes.has(item.message_id!))
    if (!cached || (missing(cached) && Date.now() - cached.at > 5_000)) {
      cached = await this.fetchSlideNodes(threadId, v2)
      if (!cached) return
    }
    for (const item of pending) {
      const node = cached.nodes.get(item.message_id!)
      if (node) this.slideResolved.set(item.item_id, mapSlideNode(node, item.item_id))
    }
  }

  /** Conversation list rows whose newest message is a placeholder get their real preview. */
  private async resolveListPreviews(threads: IgThread[]): Promise<void> {
    for (const thread of threads) {
      const last = thread.last_permanent_item ?? thread.items?.[0]
      if (!last || last.item_type !== 'placeholder' || this.slideResolved.has(last.item_id)) continue
      await this.resolveSlide(thread.thread_id, [last])
      if (this.slideResolved.has(last.item_id)) this.ctx.emit({ type: 'conversation:upserted', conversation: this.toConversation(thread) })
      await sleep(400)
    }
  }

  /** Instagram's own bookkeeping rows (reaction logs, "call started") never show as messages. */
  private visible(item: IgItem): boolean {
    return !this.mapped(item).hidden
  }

  private previewOf(item: IgItem): { text: string; kind?: PreviewKind } {
    const mapped = this.mapped(item)
    return { text: mapped.text, kind: mapped.preview }
  }

  private toMessage(item: IgItem, id: string): Message {
    const isOutgoing = String(item.user_id) === this.mePk
    const sender = this.users.get(String(item.user_id))
    const mapped = this.mapped(item)
    const message: Message = {
      id: item.item_id,
      conversationId: id,
      senderId: String(item.user_id),
      senderName: isOutgoing ? this.account.displayName : (sender?.full_name || sender?.username || 'Instagram'),
      senderAvatarUrl: isOutgoing ? this.account.avatarUrl : sender?.profile_pic_url,
      text: mapped.text,
      attachments: mapped.attachments,
      system: mapped.system,
      reactions: this.reactionsOf(item),
      sentAt: Number(item.timestamp) / 1000,
      isOutgoing,
      status: isOutgoing ? 'sent' : 'delivered'
    }
    if (item.replied_to_message?.item_id) {
      const who = this.users.get(String(item.replied_to_message.user_id))
      message.replyTo = { id: item.replied_to_message.item_id, senderName: who?.full_name || who?.username || '', text: item.replied_to_message.text ?? '' }
    }
    return message
  }

  /** Instagram changes reactions in place on messages already shown; pass the changes on. */
  private syncReactions(id: string, items: IgItem[]): void {
    const known = this.history.get(id)
    if (!known) return
    let changed = false
    for (const item of items) {
      const index = known.findIndex((m) => m.id === item.item_id)
      if (index < 0) continue
      const reactions = this.reactionsOf(item)
      if (JSON.stringify(reactions) === JSON.stringify(known[index].reactions)) continue
      known[index] = { ...known[index], reactions }
      changed = true
      this.ctx.emit({ type: 'message:reactions', conversationId: id, messageId: item.item_id, reactions })
    }
    if (changed) this.saveThreadCache()
  }

  private reactionsOf(item: IgItem): Message['reactions'] {
    const reactions = new Map<string, { emoji: string; count: number; byMe: boolean }>()
    for (const r of item.reactions?.emojis ?? []) {
      const entry = reactions.get(r.emoji) ?? { emoji: r.emoji, count: 0, byMe: false }
      entry.count += 1
      if (String(r.sender_id) === this.mePk) entry.byMe = true
      reactions.set(r.emoji, entry)
    }
    return [...reactions.values()]
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
    this.saveThreadCache()
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
