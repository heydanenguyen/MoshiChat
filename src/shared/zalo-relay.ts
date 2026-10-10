import type { TMessage } from 'zca-js'

/**
 * What the Zalo relay (main/zalo-relay.ts) and its readers pass through the sync folder. Pure types and helpers, so
 * both sides and the tests share one definition. Layout under <sync>/zalo-relay/<ownerId>/:
 *   state.zrs                  encrypted gzip of RelayState (written by the relay only)
 *   media/<msgId>.<ext>        encrypted copy of a picture / sticker / voice file (<= RELAY_MEDIA_MAX bytes)
 *   outbox/<readerDeviceId>.json   encrypted OutboxItem[] (written by that reader only); outbox/files/<name> its uploads
 *   acks/<relayDeviceId>.json  encrypted AckFile (written by the relay only)
 */

export const RELAY_VERSION = 1
/** Days of messages in state.zrs. */
export const RELAY_DAYS = 60
export const RELAY_MAX_BYTES = 50 * 1024 * 1024
/** Another relay that wrote this recently still owns the owner's folder. */
export const RELAY_TAKEOVER_MS = 10 * 60_000
export const RELAY_MEDIA_MAX = 5 * 1024 * 1024
export const OUTBOX_MAX = 200

const DAY = 24 * 3600_000

/** A sticker picture as the Zalo adapter keeps it (still image, or a sprite sheet of `frames` over `duration` seconds). */
export interface RelaySticker {
  url: string
  frames?: number
  duration?: number
  v?: number
}

export interface RelayMember {
  id: string
  name: string
  avatar?: string
}

export interface RelayThread {
  /** Zalo's own chat id (the part after `zalo:<me>/` in a conversation id). */
  id: string
  /** Direct (0) or group (1), as in TMessage threads. */
  type: 0 | 1
  name: string
  avatar?: string
  members?: RelayMember[]
  unread: number
  lastAt: number
  /** A chat with a stranger (message request). */
  request?: boolean
}

/** What the Zalo adapter hands the relay (ZaloAdapter.relaySnapshot). */
export interface RelaySnapshot {
  me: { id: string; name: string; avatar?: string }
  threads: RelayThread[]
  messages: Record<string, TMessage[]>
  stickers: Array<[number, RelaySticker]>
}

export interface RelayState extends RelaySnapshot {
  version: 1
  relayDeviceId: string
  relayDeviceName?: string
  writtenAt: number
}

/**
 * state.meta.json, plain (no secrets) beside state.zrs: who relays, and when they last proved they are alive.
 * `writtenAt` is refreshed by every heartbeat (about every 2 minutes) even when the state itself did not change; readers
 * judge "relay offline" by it, and re-read state.zrs only when `stateAt` moves.
 */
export interface RelayMeta {
  relayDeviceId: string
  relayDeviceName?: string
  writtenAt: number
  stateAt: number
}

export interface OutboxAttachment {
  name: string
  mime: string
  /** Relative to outbox/files/ . */
  path: string
}

export interface OutboxItem {
  uuid: string
  threadId: string
  type: 'message' | 'seen'
  text?: string
  attachments?: OutboxAttachment[]
  /** Zalo message id to quote. */
  replyTo?: string
  at: number
}

/** uuid -> what became of it: the sent message's id, or why it failed. */
export type AckFile = Record<string, { msgId?: string; error?: string; at: number }>

/** Items the relay has not answered yet, once each, oldest first (ties keep file order). */
export function pendingOutbox(items: OutboxItem[], acks: AckFile): OutboxItem[] {
  const seen = new Set<string>()
  const out: OutboxItem[] = []
  for (const item of items) {
    if (!item?.uuid || item.uuid in acks || seen.has(item.uuid)) continue
    seen.add(item.uuid)
    out.push(item)
  }
  return out
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.at - b.item.at || a.index - b.index)
    .map((x) => x.item)
}

/** Union of two ack files; a uuid in both keeps the newer answer (a sent one over a failed one at the same time). */
export function mergeAcks(a: AckFile, b: AckFile): AckFile {
  const out: AckFile = { ...a }
  for (const [uuid, ack] of Object.entries(b)) {
    const have = out[uuid]
    if (!have || ack.at > have.at || (ack.at === have.at && ack.msgId && !have.msgId)) out[uuid] = ack
  }
  return out
}

/** The relay already holding this owner, when it is not `deviceId` and wrote less than 10 minutes ago. */
export function relayConflict(
  existing: Pick<RelayMeta, 'relayDeviceId' | 'relayDeviceName' | 'writtenAt'> | undefined,
  deviceId: string,
  now: number
): string | undefined {
  if (!existing || existing.relayDeviceId === deviceId || now - existing.writtenAt >= RELAY_TAKEOVER_MS) return undefined
  return existing.relayDeviceName || existing.relayDeviceId
}

/**
 * The state cut down to `maxDays` and then to about `maxBytes` of JSON, dropping whole days from the oldest. Threads and
 * the rest stay; only messages go. The size is counted from each message's own JSON plus the keys around it (a little
 * over the real figure, never under), so the whole state is not serialised a second time just to measure it.
 */
export function trimState<T extends RelayState>(state: T, maxBytes: number, maxDays: number, now = Date.now()): T {
  const since = now - maxDays * DAY
  const entries: Array<{ threadId: string; message: TMessage; day: number }> = []
  const perDay = new Map<number, number>()
  const threads = new Set<string>()
  let total = Buffer.byteLength(JSON.stringify({ ...state, messages: {} }))
  for (const [threadId, list] of Object.entries(state.messages)) {
    for (const message of list) {
      const ts = Number(message.ts)
      if (!(ts >= since)) continue
      const day = Math.floor(ts / DAY)
      // + 1: the comma after it
      const size = Buffer.byteLength(JSON.stringify(message)) + 1
      entries.push({ threadId, message, day })
      perDay.set(day, (perDay.get(day) ?? 0) + size)
      total += size
      if (!threads.has(threadId)) {
        threads.add(threadId)
        // "id":[] and the comma after it
        total += Buffer.byteLength(JSON.stringify(threadId)) + 4
      }
    }
  }
  let from = -Infinity
  for (const day of [...perDay.keys()].sort((x, y) => x - y)) {
    if (total <= maxBytes) break
    total -= perDay.get(day) ?? 0
    from = day + 1
  }
  const messages: Record<string, TMessage[]> = {}
  for (const e of entries) if (e.day >= from) (messages[e.threadId] ??= []).push(e.message)
  return { ...state, messages }
}

function paramsOf(params?: string): Record<string, unknown> {
  if (!params || params[0] !== '{') return {}
  try {
    return JSON.parse(params) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** The file behind a picture / sticker / voice message that the relay copies for readers, if it has one. */
export function mediaUrlOf(raw: TMessage, stickers: ReadonlyMap<number, RelaySticker>): string | undefined {
  if (typeof raw.content !== 'object' || !raw.content) return undefined
  const c = raw.content as {
    href?: string
    id?: number | string
    stickerId?: number | string
    params?: string
  }
  switch (raw.msgType) {
    case 'chat.photo': {
      // A photo sticker moves in its WebP; the photo is only the still.
      const ext = typeof raw.propertyExt === 'string' ? paramsOf(raw.propertyExt) : (raw.propertyExt as Record<string, unknown> | undefined)
      const webp = Number(ext?.type) === 3 ? (paramsOf(c.params).webp as { url?: string } | undefined)?.url : undefined
      return webp || c.href || undefined
    }
    case 'chat.gif':
    case 'chat.voice':
      return c.href || undefined
    case 'chat.sticker': {
      const id = Number(c.id ?? c.stickerId)
      return Number.isFinite(id) ? stickers.get(id)?.url : undefined
    }
    default:
      return undefined
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/amr': 'amr'
}

/** File extension for a downloaded file: by its content type, else the URL's own, else `bin`. */
export function extFor(contentType: string, url: string): string {
  const known = EXTENSIONS[contentType.split(';')[0].trim().toLowerCase()]
  if (known) return known
  const fromUrl = /\.([a-z0-9]{2,4})$/i.exec(url.split(/[?#]/)[0])?.[1]?.toLowerCase()
  return fromUrl && /^(jpe?g|png|gif|webp|m4a|aac|mp3|ogg|amr|mp4)$/.test(fromUrl) ? fromUrl.replace('jpeg', 'jpg') : 'bin'
}

/** Readers call the relay offline once its heartbeat (meta.writtenAt) is older than this. */
export const RELAY_OFFLINE_MS = 5 * 60_000
/** A queued send nobody answered for this long is shown as failed. */
export const RELAY_SEND_TIMEOUT_MS = 10 * 60_000
/** Largest file a reader copies into the outbox. */
export const OUTBOX_FILE_MAX = 25 * 1024 * 1024

export function relayOffline(writtenAt: number, now: number): boolean {
  return !(now - writtenAt <= RELAY_OFFLINE_MS)
}

/** The messages of `messages` whose ids are not in `known`, per chat, in the order they are listed. */
export function messagesSince(messages: Record<string, TMessage[]>, known: ReadonlySet<string>): Array<{ threadId: string; message: TMessage }> {
  const out: Array<{ threadId: string; message: TMessage }> = []
  for (const [threadId, list] of Object.entries(messages)) for (const message of list) if (message?.msgId && !known.has(message.msgId)) out.push({ threadId, message })
  return out
}

/**
 * The reader's own outbox with `item` added: items already answered (in `acks`) are dropped, a newer `seen` for a chat
 * replaces an unanswered older one, and only the last `cap` items stay.
 */
export function outboxAppend(items: OutboxItem[], item: OutboxItem, acks: AckFile = {}, cap = OUTBOX_MAX): OutboxItem[] {
  const kept = items.filter((x) => x?.uuid && !(x.uuid in acks) && x.uuid !== item.uuid && !(item.type === 'seen' && x.type === 'seen' && x.threadId === item.threadId))
  return [...kept, item].slice(-cap)
}
