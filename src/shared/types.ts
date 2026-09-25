/** Domain model shared between main, preload and renderer. */

export type Platform = 'messenger' | 'instagram' | 'telegram' | 'zalo' | 'whatsapp'

export type AccountStatus = 'connecting' | 'connected' | 'disconnected' | 'needs_auth' | 'error'

/** What the platform lets us do from our side. The UI hides unsupported actions. */
export interface AccountFeatures {
  reply: boolean
  react: boolean
  attachments: boolean
}

export const ALL_FEATURES: AccountFeatures = { reply: true, react: true, attachments: true }

export interface Account {
  id: string
  platform: Platform
  displayName: string
  handle?: string
  avatarUrl?: string
  status: AccountStatus
  error?: string
  features: AccountFeatures
  /** Sample-data account used for the first-run experience. */
  demo?: boolean
}

export interface Peer {
  id: string
  name: string
  handle?: string
  avatarUrl?: string
  isMe?: boolean
}

export interface MessagePreview {
  id: string
  text: string
  senderName: string
  isOutgoing: boolean
  sentAt: number
}

export interface Conversation {
  id: string
  accountId: string
  platform: Platform
  title: string
  avatarUrl?: string
  isGroup: boolean
  participants: Peer[]
  unreadCount: number
  pinned?: boolean
  muted?: boolean
  lastMessage?: MessagePreview
  updatedAt: number
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'link'

export interface Attachment {
  id: string
  kind: AttachmentKind
  url?: string
  thumbnailUrl?: string
  name?: string
  size?: number
  width?: number
  height?: number
  /** Seconds, for audio and video. */
  duration?: number
}

export interface Reaction {
  emoji: string
  count: number
  byMe: boolean
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed'

export interface Message {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  senderAvatarUrl?: string
  text: string
  attachments: Attachment[]
  reactions: Reaction[]
  replyTo?: { id: string; senderName: string; text: string }
  sentAt: number
  isOutgoing: boolean
  status: MessageStatus
  edited?: boolean
}

/** A local file the user wants to send. */
export interface OutgoingAttachment {
  path: string
  name: string
  mime: string
  size: number
  /** Data URL preview for images (and small voice notes), so the optimistic bubble can show it immediately. */
  preview?: string
  /** Recorded voice note: platforms mark it as push-to-talk. */
  voice?: boolean
  duration?: number
}

export interface SendOptions {
  replyToId?: string
  attachments?: OutgoingAttachment[]
}

export interface SearchHit {
  message: Message
  conversation: Conversation
}

export interface TypingEvent {
  conversationId: string
  peerName: string
  isTyping: boolean
}

export type AuthPromptKind = 'phone' | 'code' | 'password' | 'qr'

export interface AuthPrompt {
  requestId: string
  accountId: string
  platform: Platform
  kind: AuthPromptKind
  message?: string
  /** PNG data URL for QR sign-in. A new prompt with the same requestId replaces the code. */
  qrDataUrl?: string
  /** Free-form progress note, e.g. "scanned, confirm on your phone". */
  note?: string
}

/** Credentials supplied by the user when adding an account. Secrets never leave the main process after this. */
export type AddAccountInput =
  | { platform: 'telegram'; apiId: number; apiHash: string }
  | { platform: 'messenger'; pageId: string; accessToken: string }
  | { platform: 'instagram'; pageId: string; accessToken: string }
  | { platform: 'zalo' }
  | { platform: 'whatsapp' }

export type ThemePreference = 'system' | 'light' | 'dark'
export type Language = 'vi' | 'en'

export interface Settings {
  theme: ThemePreference
  language: Language
  notifications: boolean
  sendOnEnter: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'vi',
  notifications: true,
  sendOnEnter: true
}

/** Events pushed from main to the renderer. */
export type BridgeEvent =
  | { type: 'account:updated'; account: Account }
  | { type: 'account:removed'; accountId: string }
  | { type: 'conversation:upserted'; conversation: Conversation }
  | { type: 'conversations:reset'; accountId: string; conversations: Conversation[] }
  | { type: 'message:new'; message: Message }
  | { type: 'message:updated'; message: Message }
  | { type: 'typing'; typing: TypingEvent }
  | { type: 'auth:prompt'; prompt: AuthPrompt }
  | { type: 'auth:cleared'; requestId: string }
  | { type: 'focus-conversation'; conversationId: string }

export interface PlatformMeta {
  id: Platform
  name: string
  color: string
  gradient: string
  /** How the account is connected, shown on the platform picker. */
  method: string
}

export const PLATFORM_ORDER: Platform[] = ['messenger', 'instagram', 'telegram', 'zalo', 'whatsapp']

export const PLATFORMS: Record<Platform, PlatformMeta> = {
  messenger: {
    id: 'messenger',
    name: 'Messenger',
    color: '#0084FF',
    gradient: 'linear-gradient(135deg, #00C6FF 0%, #0078FF 45%, #A033FF 100%)',
    method: 'Meta Graph API'
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    color: '#E1306C',
    gradient: 'linear-gradient(135deg, #F9CE34 0%, #EE2A7B 50%, #6228D7 100%)',
    method: 'Meta Graph API'
  },
  telegram: {
    id: 'telegram',
    name: 'Telegram',
    color: '#2AABEE',
    gradient: 'linear-gradient(135deg, #37AEE2 0%, #1E96C8 100%)',
    method: 'MTProto'
  },
  zalo: {
    id: 'zalo',
    name: 'Zalo',
    color: '#0068FF',
    gradient: 'linear-gradient(135deg, #2F8CFF 0%, #0057D8 100%)',
    method: 'QR code'
  },
  whatsapp: {
    id: 'whatsapp',
    name: 'WhatsApp',
    color: '#25D366',
    gradient: 'linear-gradient(135deg, #5DE68C 0%, #1FAF54 100%)',
    method: 'QR code'
  }
}
