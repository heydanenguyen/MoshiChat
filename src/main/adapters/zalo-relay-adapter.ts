import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TMessage } from 'zca-js'
import type { Account, Attachment, Conversation, Message, Peer, SendOptions } from '@shared/types'
import {
  OUTBOX_FILE_MAX,
  RELAY_SEND_TIMEOUT_MS,
  mergeAcks,
  messagesSince,
  outboxAppend,
  relayOffline,
  type AckFile,
  type OutboxItem,
  type RelayState,
  type RelaySticker
} from '@shared/zalo-relay'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, externalIdOf, previewOf } from './types'
import { mapMessage, stickerIdOf, STICKER_PICTURE_VERSION } from './zalo-map'
import { RELAY_DIR, codeOf, readRelayFile, readRelayMeta, readRelayState, writeRelayFile } from './zalo-relay-files'

/**
 * The reader side of the Zalo relay (spec 2.3): shows and sends a Zalo that another computer keeps signed in, through
 * the sync folder, with no Zalo session of its own. The folder is read every 20 seconds; what is there is only as
 * fresh as the cloud drive and the relay's own 15 s to 2 min rhythm (so 20 to 60 s of delay, and "relay offline" when
 * its heartbeat stops).
 */

const POLL_MS = 20_000
const MEDIA_UPDATES_PER_POLL = 30
/** Failed sends that stay in the chat after the app stops asking about them. */
const KEEP_FAILED = 20

/** What the adapter needs from the app (injected: this file stays free of electron). */
export interface RelayEnv {
  folder(): string | undefined
  device(): { id: string; name: string }
  /** The zalo-share key; undefined when sharing is not turned on here. */
  key(): Promise<Buffer | undefined>
  /** Zalo owners that have a live account on this computer (the relay would only duplicate them). */
  liveOwners(): string[]
}

export interface RelayAdapterOptions {
  now?: () => number
  pollMs?: number
}

let sharedEnv: RelayEnv | undefined
/** Set once at startup (index.ts); the manager's factory hands it to every relay account. */
export const setRelayEnv = (env: RelayEnv | undefined): void => {
  sharedEnv = env
}
export const relayEnv = (): RelayEnv | undefined => sharedEnv

const PREFIX = 'zalo:relay-'
export const relayAccountId = (ownerId: string): string => PREFIX + ownerId
export const isRelayAccountId = (id: string): boolean => id.startsWith(PREFIX)
export const ownerOfRelayAccount = (id: string): string => id.slice(PREFIX.length)

export interface RelaySecret {
  ownerId: string
}

interface Pending {
  uuid: string
  message: Message
  at: number
  /** 'sending' until the relay answers; a failed one stays so the chat still shows it. */
  state: 'sending' | 'failed'
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.amr': 'audio/amr',
  '.mp4': 'video/mp4'
}

const safeFile = (name: string): string => basename(name).replace(/[^\w.\- ]/g, '_').slice(-120) || 'file'

export class ZaloRelayAdapter implements PlatformAdapter {
  readonly account: Account
  private state?: RelayState
  /** What changed last time the state was read: the sidecar's stateAt (state.zrs's mtime without a sidecar). */
  private stamp?: number
  private known = new Set<string>()
  private index = new Map<string, string>()
  private names = new Map<string, string>()
  private avatars = new Map<string, string>()
  private stickers = new Map<number, RelaySticker>()
  private converted = new Map<string, Message[]>()
  private media = new Map<string, string>()
  private pending = new Map<string, Pending>()
  /** Real ids of sent messages whose own copy has not shown up in the state yet (the ack came first). */
  private awaitingState = new Set<string>()
  private acks: AckFile = {}
  private lastBeat?: number
  private timer?: ReturnType<typeof setInterval>
  private polling: Promise<void> = Promise.resolve()
  private outboxLock: Promise<void> = Promise.resolve()
  private connecting = false
  private now: () => number
  private pollMs: number

  constructor(
    initialId: string,
    private readonly owner: string,
    private readonly ctx: AdapterContext,
    private readonly env: RelayEnv,
    options: RelayAdapterOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.pollMs = options.pollMs ?? POLL_MS
    this.account = {
      id: initialId,
      platform: 'zalo',
      displayName: 'Zalo · relay',
      status: 'disconnected',
      // Zalo's own, minus what a relay cannot carry out (v1)
      features: { reply: true, react: false, attachments: true, unsend: false, call: 'none' }
    }
  }

  async connect(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.setStatus('connecting')
    this.stamp = undefined
    this.connecting = true
    try {
      await this.pollNow()
    } finally {
      this.connecting = false
    }
    // Kept running even while waiting (no state yet, or a live account here): the account recovers by itself.
    this.timer = setInterval(() => void this.pollNow(), this.pollMs)
    this.timer.unref?.()
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.setStatus('disconnected')
  }

  /** One look at the folder now (one at a time). */
  pollNow(): Promise<void> {
    this.polling = this.polling.then(() => this.refresh()).catch((err: Error) => {
      this.ctx.log('zalo relay reader:', err.message)
      // Never stuck at 'connecting': a failure before any status was set shows as an error (the next poll may still recover).
      if (this.account.status === 'connecting') this.setStatus('error', err.message)
    })
    return this.polling
  }

  // ---- reading the folder --------------------------------------------------

  private setStatus(status: Account['status'], error?: string): void {
    if (this.account.status === status && this.account.error === error) return
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }

  private dir(): string | undefined {
    const folder = this.env.folder()
    return folder ? join(folder, RELAY_DIR, this.owner) : undefined
  }

  private async refresh(): Promise<void> {
    if (this.env.liveOwners().includes(this.owner)) return this.setStatus('needs_auth', 'live-account')
    const dir = this.dir()
    const key = await this.env.key()
    if (!dir || !key) return this.setStatus('needs_auth', 'relay-missing')
    const meta = await readRelayMeta(dir)
    const stamp = meta ? meta.stateAt : (await fs.stat(join(dir, 'state.zrs')).catch(() => undefined))?.mtimeMs
    if (stamp !== undefined && stamp !== this.stamp) {
      try {
        const state = await readRelayState(key, dir)
        // The cloud drive can deliver the sidecar before the state it announces: try again next time.
        if (meta && !(state.writtenAt >= meta.stateAt)) throw new Error('state older than its sidecar')
        this.stamp = stamp
        this.lastBeat = undefined
        this.apply(state)
      } catch (err) {
        this.ctx.log('zalo relay reader: state not readable yet:', (err as Error).message)
      }
    }
    if (!this.state) return this.setStatus('needs_auth', 'relay-missing')
    this.lastBeat = meta?.writtenAt ?? this.lastBeat ?? this.state.writtenAt
    const beat = this.lastBeat
    this.setStatus('connected', relayOffline(beat, this.now()) ? `relay-offline:${new Date(beat).toISOString()}` : undefined)
    await this.readMedia(dir)
    await this.resolvePending(dir, key)
  }

  /** A newly read state: tells the app what is new in it. */
  private apply(state: RelayState): void {
    const first = !this.state
    const previous = new Map<string, number>()
    for (const [threadId, list] of Object.entries(this.state?.messages ?? {})) previous.set(threadId, Math.max(0, ...list.map((m) => Number(m.ts))))
    this.state = state
    this.account.displayName = `${state.me.name || 'Zalo'} · relay`
    this.account.avatarUrl = state.me.avatar
    this.converted.clear()
    this.index.clear()
    this.names.clear()
    this.avatars.clear()
    for (const t of state.threads) {
      if (t.type === 0) {
        this.names.set(t.id, t.name)
        if (t.avatar) this.avatars.set(t.id, t.avatar)
      }
      for (const m of t.members ?? []) {
        this.names.set(m.id, m.name)
        if (m.avatar) this.avatars.set(m.id, m.avatar)
      }
    }
    this.stickers = new Map(state.stickers)
    for (const [threadId, list] of Object.entries(state.messages)) for (const raw of list) this.index.set(raw.msgId, threadId)
    const fresh = first ? [] : messagesSince(state.messages, this.known)
    for (const list of Object.values(state.messages)) for (const raw of list) this.known.add(raw.msgId)
    for (const { threadId, message: raw } of fresh) {
      const message = this.map(raw, threadId)
      // The copy of something sent through here, before its ack came: the stand-in is swapped now.
      const mine = message.isOutgoing ? this.matchPending(message, threadId) : undefined
      if (mine) {
        this.sent(mine, raw.msgId)
        continue
      }
      // Older than what the chat already had: history filled in behind, not something that just arrived.
      if (Number(raw.ts) >= (previous.get(threadId) ?? 0)) this.ctx.emit({ type: 'message:new', message })
      else this.ctx.emit({ type: 'message:updated', message })
    }
    // Sent through here and answered before the state had it: now the real copy replaces the stand-in.
    for (const id of [...this.awaitingState]) {
      const threadId = this.index.get(id)
      const raw = threadId ? state.messages[threadId]?.find((m) => m.msgId === id) : undefined
      if (!threadId || !raw) continue
      this.awaitingState.delete(id)
      this.ctx.emit({ type: 'message:updated', message: this.map(raw, threadId) })
    }
    // After the new messages: the app counts an unread for each of them, and the state's own count replaces that.
    if (!first || !this.connecting) this.ctx.emit({ type: 'conversations:reset', accountId: this.account.id, conversations: this.buildConversations() })
  }

  /** The send still waiting for its answer that this state message is: same chat, same text, within 2 minutes. */
  private matchPending(message: Message, threadId: string): Pending | undefined {
    for (const p of this.pending.values()) {
      if (p.state === 'sending' && externalIdOf(p.message.conversationId) === threadId && p.message.text === message.text && Math.abs(message.sentAt - p.at) <= 2 * 60_000) return p
    }
    return undefined
  }

  // ---- mapping -------------------------------------------------------------

  private map(raw: TMessage, threadId: string): Message {
    const id = conversationId(this.account.id, threadId)
    const me = this.state!.me
    const stickerId = raw.msgType === 'chat.sticker' ? stickerIdOf(raw) : undefined
    const known = stickerId ? this.stickers.get(stickerId) : undefined
    const message = mapMessage(raw, {
      conversationId: id,
      meId: me.id,
      meName: me.name,
      meAvatar: me.avatar,
      nameOf: (userId) => this.names.get(userId),
      avatarOf: (userId) => this.avatars.get(userId),
      reactions: [],
      sticker: known ? { ...known, v: STICKER_PICTURE_VERSION } : undefined
    })
    return message
  }

  private messagesOf(threadId: string): Message[] {
    let list = this.converted.get(threadId)
    if (!list) {
      list = (this.state?.messages[threadId] ?? []).map((raw) => this.map(raw, threadId)).sort((a, b) => a.sentAt - b.sentAt)
      this.converted.set(threadId, list)
    }
    return list
  }

  private buildConversations(): Conversation[] {
    const state = this.state
    if (!state) return []
    return state.threads
      .map((t): Conversation => {
        const last = this.messagesOf(t.id).at(-1)
        const group = t.type === 1
        return {
          id: conversationId(this.account.id, t.id),
          accountId: this.account.id,
          platform: 'zalo',
          title: t.name,
          avatarUrl: t.avatar,
          isGroup: group,
          participants: [
            { id: state.me.id, name: state.me.name, isMe: true },
            ...(group ? (t.members ?? []).map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatar })) : [{ id: t.id, name: t.name, avatarUrl: t.avatar }])
          ],
          unreadCount: t.unread,
          ...(t.request ? { request: true } : {}),
          lastMessage: last && previewOf(last),
          updatedAt: last?.sentAt ?? t.lastAt
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async listConversations(): Promise<Conversation[]> {
    return this.buildConversations()
  }

  async listContacts(): Promise<Peer[]> {
    return (this.state?.threads ?? []).filter((t) => t.type === 0).map((t) => ({ id: t.id, name: t.name, avatarUrl: t.avatar }))
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const threadId = externalIdOf(id)
    const all = this.messagesOf(threadId)
    const end = beforeId ? all.findIndex((m) => m.id === beforeId) : all.length
    const page = end > 0 ? all.slice(Math.max(0, end - limit), end) : []
    const dir = this.dir()
    const out = dir ? await Promise.all(page.map((m) => this.withMedia(dir, m))) : page
    // Sends the relay has not answered yet (or failed): still part of the chat.
    if (!beforeId) for (const p of this.pending.values()) if (p.message.conversationId === id) out.push(p.message)
    return out
  }

  // ---- media (copies the relay made: encrypted in the folder, plain in this computer's own cache) ---------------

  private async readMedia(dir: string): Promise<void> {
    const names = await fs.readdir(join(dir, 'media')).catch(() => [] as string[])
    const added: string[] = []
    for (const name of names) {
      if (name.endsWith('.tmp')) continue
      const msgId = name.slice(0, name.lastIndexOf('.'))
      if (this.media.get(msgId) === name) continue
      this.media.set(msgId, name)
      added.push(msgId)
    }
    // A picture that arrived after its message: the message is shown again with it.
    for (const msgId of added.slice(0, MEDIA_UPDATES_PER_POLL)) {
      const threadId = this.index.get(msgId)
      const raw = threadId ? this.state?.messages[threadId]?.find((m) => m.msgId === msgId) : undefined
      if (!threadId || !raw || this.connecting) continue
      this.ctx.emit({ type: 'message:updated', message: await this.withMedia(dir, this.map(raw, threadId)) })
    }
  }

  /** The local file of a message's relayed media (decrypted into this computer's cache once). */
  private async localMedia(dir: string, msgId: string): Promise<{ path: string; mime: string } | undefined> {
    const name = this.media.get(msgId)
    const key = await this.env.key()
    if (!name || !key) return undefined
    try {
      const cache = join(this.ctx.dataDir(), 'relay-media', this.owner)
      const path = join(cache, name)
      if (!(await fs.stat(path).catch(() => undefined))?.size) {
        await fs.mkdir(cache, { recursive: true })
        await fs.writeFile(path + '.tmp', await readRelayFile(key, join(dir, 'media', name)))
        await fs.rename(path + '.tmp', path)
      }
      return { path, mime: MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream' }
    } catch (err) {
      this.ctx.log('zalo relay reader: media not readable:', msgId, (err as Error).message)
      return undefined
    }
  }

  private async withMedia(dir: string, message: Message): Promise<Message> {
    if (!this.media.has(message.id)) return message
    const local = await this.localMedia(dir, message.id)
    if (!local) return message
    const url = pathToFileURL(local.path).href
    const attachments = message.attachments.map((a, i): Attachment => (i === 0 && ['image', 'audio', 'sticker'].includes(a.kind) ? { ...a, url, ...(a.kind === 'image' ? { thumbnailUrl: url } : {}) } : a))
    return { ...message, attachments }
  }

  async downloadAttachment(id: string, messageId: string): Promise<string | undefined> {
    const dir = this.dir()
    if (!dir) return undefined
    const local = await this.localMedia(dir, messageId)
    return local ? `data:${local.mime};base64,${(await fs.readFile(local.path)).toString('base64')}` : undefined
  }

  // ---- sending (the outbox: this computer's own file, answered through acks/) -----------------------------------

  private outboxPath(dir: string): string {
    return join(dir, 'outbox', `${this.env.device().id}.json`)
  }

  /** Add one item to this computer's outbox file (one write at a time; answered items leave, 200 at most). */
  private append(item: OutboxItem, files: Array<{ path: string; bytes: Buffer }> = []): Promise<void> {
    const run = async (): Promise<void> => {
      const dir = this.dir()
      const key = await this.env.key()
      if (!dir || !key) throw new Error('relay-missing')
      await fs.mkdir(join(dir, 'outbox', 'files'), { recursive: true })
      for (const f of files) await writeRelayFile(key, join(dir, 'outbox', 'files', f.path), f.bytes)
      const file = this.outboxPath(dir)
      let items: OutboxItem[] = []
      try {
        const parsed: unknown = JSON.parse((await readRelayFile(key, file)).toString('utf8'))
        if (Array.isArray(parsed)) items = parsed as OutboxItem[]
      } catch (err) {
        if (codeOf(err) !== 'ENOENT') this.ctx.log('zalo relay reader: own outbox unreadable, starting a new one:', (err as Error).message)
      }
      await writeRelayFile(key, file, Buffer.from(JSON.stringify(outboxAppend(items, item, this.acks))))
    }
    const done = this.outboxLock.then(run)
    this.outboxLock = done.catch(() => undefined)
    return done
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    const uuid = randomUUID()
    const at = this.now()
    const files: Array<{ path: string; bytes: Buffer }> = []
    const attachments: OutboxItem['attachments'] = []
    for (const a of options.attachments ?? []) {
      // The file itself, never the size the renderer says
      const size = (await fs.stat(a.path)).size
      if (size > OUTBOX_FILE_MAX) throw new Error(`${a.name} is larger than ${OUTBOX_FILE_MAX / 1024 / 1024} MB: too big to send through the relay`)
      const path = `${uuid}-${safeFile(a.name)}`
      files.push({ path, bytes: await fs.readFile(a.path) })
      attachments.push({ name: a.name, mime: a.mime, path })
    }
    const item: OutboxItem = { uuid, threadId: externalIdOf(id), type: 'message', text, ...(attachments.length ? { attachments } : {}), replyTo: options.replyToId, at }
    await this.append(item, files)
    const me = this.state?.me
    const message: Message = {
      id: `relay:${uuid}`,
      conversationId: id,
      senderId: me?.id ?? 'me',
      senderName: me?.name ?? 'Zalo',
      senderAvatarUrl: me?.avatar,
      text,
      attachments: (options.attachments ?? []).map((a, i) => ({ id: `relay:${uuid}-${i}`, kind: a.mime.startsWith('image/') ? 'image' : 'file', url: a.preview, name: a.name, size: a.size })),
      reactions: [],
      sentAt: at,
      isOutgoing: true,
      status: 'sending'
    }
    this.pending.set(uuid, { uuid, message, at, state: 'sending' })
    return message
  }

  async markRead(id: string): Promise<void> {
    await this.append({ uuid: randomUUID(), threadId: externalIdOf(id), type: 'seen', at: this.now() })
  }

  async setTyping(): Promise<void> {
    /* nothing to tell: the relay would only learn of it a minute later */
  }

  // ---- answers --------------------------------------------------------------------------------------------------

  private async readAcks(dir: string, key: Buffer): Promise<AckFile> {
    let merged: AckFile = {}
    for (const name of (await fs.readdir(join(dir, 'acks')).catch(() => [] as string[])).filter((n) => n.endsWith('.json'))) {
      try {
        const parsed: unknown = JSON.parse((await readRelayFile(key, join(dir, 'acks', name))).toString('utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) merged = mergeAcks(merged, parsed as AckFile)
      } catch {
        /* half-synced: read again next time */
      }
    }
    return merged
  }

  private async resolvePending(dir: string, key: Buffer): Promise<void> {
    if (![...this.pending.values()].some((p) => p.state === 'sending')) return
    this.acks = mergeAcks(this.acks, await this.readAcks(dir, key))
    const now = this.now()
    for (const p of [...this.pending.values()]) {
      if (p.state !== 'sending') continue
      const ack = this.acks[p.uuid]
      if (ack?.msgId) this.sent(p, ack.msgId)
      else if (ack?.error) this.fail(p, ack.error)
      else if (now - p.at > RELAY_SEND_TIMEOUT_MS) this.fail(p, 'relay-timeout')
    }
  }

  /** The relay sent it: the stand-in takes the real id (the state's own copy when it already has one). */
  private sent(p: Pending, msgId: string): void {
    this.pending.delete(p.uuid)
    const threadId = this.index.get(msgId)
    const raw = threadId ? this.state?.messages[threadId]?.find((m) => m.msgId === msgId) : undefined
    const message: Message = raw && threadId ? this.map(raw, threadId) : { ...p.message, id: msgId, status: 'sent' }
    this.known.add(msgId)
    if (!raw) this.awaitingState.add(msgId)
    this.ctx.emit({ type: 'message:updated', message, replacesId: p.message.id })
  }

  private fail(p: Pending, error: string): void {
    this.ctx.log(`zalo relay reader: send ${p.uuid} failed: ${error}`)
    p.state = 'failed'
    p.message = { ...p.message, status: 'failed' }
    this.ctx.emit({ type: 'message:updated', message: p.message })
    const failed = [...this.pending.values()].filter((x) => x.state === 'failed')
    for (const old of failed.slice(0, Math.max(0, failed.length - KEEP_FAILED))) this.pending.delete(old.uuid)
  }
}
