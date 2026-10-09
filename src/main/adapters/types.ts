import type { Account, Attachment, AuthPromptKind, BridgeEvent, Conversation, ConversationStats, Message, Peer, PeerProfile, SendOptions, Settings, SharedKind } from '@shared/types'

/** Services the manager hands to every adapter. */
export interface AdapterContext {
  emit(event: BridgeEvent): void
  /** Ask the user for a phone number / code / password. Resolves with their answer. */
  requestAuth(kind: AuthPromptKind, message?: string): Promise<string>
  /**
   * Show (or refresh) a QR code for the user to scan. Returns the prompt id;
   * pass it again to replace the code in place. `onCancel` fires if the user
   * dismisses the sheet.
   */
  presentQr(dataUrl: string, note?: string, requestId?: string, onCancel?: () => void): string
  /** Update the note under a QR prompt without changing the code. */
  noteAuth(requestId: string, note: string): void
  dismissAuth(requestId: string): void
  /** Persist the adapter's secret material (session string, tokens, cookies). */
  saveSecret(secret: unknown): Promise<void>
  /** Directory for adapter-private files (WhatsApp signal keys). Created on demand. */
  dataDir(): string
  /** The user's settings as they are now (read-only), for adapters with switches of their own. */
  settings?(): Readonly<Settings>
  log(...args: unknown[]): void
}

export interface FetchMessagesOptions {
  limit: number
  beforeId?: string
}

/**
 * Every platform plugs into Moshi through this interface. Adapters own the
 * network connection and translate platform objects into the shared model.
 */
export interface PlatformAdapter {
  readonly account: Account
  /** The adapter reconnects itself after a drop; the manager must not run a second loop beside it. */
  readonly selfReconnects?: true
  connect(): Promise<void>
  disconnect(): Promise<void>
  listConversations(): Promise<Conversation[]>
  fetchMessages(conversationId: string, options: FetchMessagesOptions): Promise<Message[]>
  sendMessage(conversationId: string, text: string, options?: SendOptions): Promise<Message>
  markRead(conversationId: string): Promise<void>
  setTyping?(conversationId: string): Promise<void>
  /** Accept a message request on the platform, where it has such a step (Instagram). Replying accepts it everywhere. */
  acceptRequest?(conversationId: string): Promise<void>
  react?(conversationId: string, messageId: string, emoji: string): Promise<void>
  /** Take one of my messages back for everyone. The adapter emits the message as unsent (see `unsentCopy`). */
  unsend?(conversationId: string, messageId: string): Promise<void>
  /** Native forward within the same account. The manager falls back to re-sending text otherwise. */
  forward?(fromConversationId: string, messageId: string, toConversationId: string): Promise<Message>
  /** Search beyond what the manager has cached (server side or the adapter's own history). */
  searchMessages?(query: string, limit: number): Promise<Message[]>
  /** Fetch the full media for an attachment as a data URL. */
  downloadAttachment?(conversationId: string, messageId: string, attachmentId: string): Promise<string | undefined>
  /** Richer profile of the peer (bio, phone, birthday...). */
  getPeerProfile?(conversationId: string): Promise<PeerProfile | undefined>
  /** Messages with photos/videos, links or files in one conversation, newest first. */
  listShared?(conversationId: string, kind: SharedKind, limit: number): Promise<Message[]>
  /** Full-text search restricted to one conversation, newest first. */
  searchInConversation?(conversationId: string, query: string, limit: number): Promise<Message[]>
  /** Oldest message, total count and latest activity. */
  getConversationStats?(conversationId: string): Promise<ConversationStats>
  /** Walk the platform's history as deep as it goes (Zalo), reporting progress; `reachedEnd`: nothing older is left. */
  syncHistory?(onProgress: (progress: { pages: number; added: number }) => void): Promise<{ pages: number; added: number; reachedEnd: boolean }>
  /** GIPHY ids of the stickers the platform's own sticker tray shows for `query` (Instagram), its picks when empty. */
  searchTrayStickers?(conversationId: string, query: string): Promise<string[]>
  /** Everything cached in memory, for insights and memories (no network). */
  cachedMessages?(): Message[]
  /**
   * Walk one chat's history newest to oldest until `from` (ms), handing each page to `onPage`, for the
   * insights. Independent of the chat view's paging and cache. 'partial' when it had to stop early.
   */
  historySince?(conversationId: string, from: number, onPage: (messages: Message[]) => void): Promise<'complete' | 'partial'>
  /** People the account can message (friends, contacts, recent peers). */
  listContacts?(): Promise<Peer[]>
  /** Direct conversation with a contact, created lazily when the platform allows it. */
  openConversation?(peerId: string): Promise<Conversation>
}

/** Stats derived from whatever messages are at hand. */
export const statsOf = (messages: Message[]): ConversationStats => {
  if (!messages.length) return { messageCount: 0, approximate: true }
  let first = Infinity
  let last = 0
  for (const m of messages) {
    if (m.sentAt < first) first = m.sentAt
    if (m.sentAt > last) last = m.sentAt
  }
  return { firstMessageAt: first, lastMessageAt: last, messageCount: messages.length, approximate: true }
}

/** A message as it is once taken back: marked unsent, with its text, media and reactions gone. */
export const unsentCopy = (message: Message): Message => ({ ...message, unsent: true, text: '', attachments: [], reactions: [], replyTo: undefined })

export const conversationId = (accountId: string, externalId: string | number): string =>
  `${accountId}/${externalId}`

export const externalIdOf = (conversationId: string): string =>
  conversationId.slice(conversationId.indexOf('/') + 1)

export const mimeOf = (name: string): string => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    wav: 'audio/wav',
    pdf: 'application/pdf',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    json: 'application/json'
  }
  return table[ext] ?? 'application/octet-stream'
}

export const describeAttachments = (attachments: Message['attachments']): string => {
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

export { previewKindOf } from '@shared/preview'
import { previewKindOf } from '@shared/preview'

export const previewOf = (message: Message): Conversation['lastMessage'] => ({
  id: message.id,
  text: message.text || describeAttachments(message.attachments),
  senderName: message.senderName,
  isOutgoing: message.isOutgoing,
  sentAt: message.sentAt,
  kind: previewKindOf(message)
})

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi

/** URLs mentioned in the text plus link attachments. */
export const linksOf = (message: Message): string[] => {
  const found = new Set<string>()
  for (const a of message.attachments) if ((a.kind === 'link' || a.kind === 'post') && a.url) found.add(a.url)
  for (const m of message.text.matchAll(URL_RE)) found.add(m[0])
  return [...found]
}

/** Does the message belong in the given shared-content tab? */
export const isShared = (message: Message, kind: SharedKind): boolean => {
  if (kind === 'links') return linksOf(message).length > 0
  const kinds: Attachment['kind'][] = kind === 'media' ? ['image', 'video'] : ['file', 'audio']
  return message.attachments.some((a) => kinds.includes(a.kind))
}

/** Case-insensitive substring match over text and attachment names. */
export const matchesQuery = (message: Message, needle: string): boolean =>
  message.text.toLowerCase().includes(needle) || message.attachments.some((a) => a.name?.toLowerCase().includes(needle))
