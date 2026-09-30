import type { AiProgress, ChatModel, VoiceModel } from './ai'
import type { Todo } from './todos'
import type { LogoId } from './logos'
/** Domain model shared between main, preload and renderer. */

export type Platform = 'messenger' | 'instagram' | 'telegram' | 'zalo' | 'whatsapp'

export type AccountStatus = 'connecting' | 'connected' | 'disconnected' | 'needs_auth' | 'error'

/** What the platform lets us do from our side. The UI hides unsupported actions. */
export interface AccountFeatures {
  reply: boolean
  react: boolean
  attachments: boolean
  /** Recorded voice notes; defaults to `attachments` when absent. */
  voice?: boolean
  /** Taking back (unsending) my own messages for everyone. */
  unsend?: boolean
}

export const ALL_FEATURES: AccountFeatures = { reply: true, react: true, attachments: true, unsend: true }

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
  /** What the message carries when it is not plain text; the list shows an icon and a localized label. */
  kind?: PreviewKind
}

export type PreviewKind =
  | 'photo'
  | 'video'
  | 'voice'
  | 'sticker'
  | 'gif'
  | 'link'
  | 'file'
  | 'post'
  | 'reel'
  | 'story_reply'
  | 'story_reaction'
  | 'story_mention'
  | 'story_share'
  | 'call'
  | 'unavailable'
  | 'unsent'

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
  /**
   * A message request: someone you do not know wrote first (Instagram's and Messenger's request folders, a Zalo
   * stranger). It waits apart from the inbox, silently, until you accept it or reply.
   */
  request?: boolean
  lastMessage?: MessagePreview
  /** Renderer only: the platform's name/photo when a nickname or custom photo is shown instead. */
  originalTitle?: string
  originalAvatarUrl?: string
  updatedAt: number
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'link' | 'story' | 'post'

/** Why a story card is attached, shown as a small localized label above it. */
export type StoryLabel = 'story_reply' | 'story_reaction' | 'story_mention' | 'story_share'

/** The buttons in the bar that appears beside a hovered message, in order. */
export type BubbleAction = 'react' | 'reply' | 'forward' | 'translate' | 'speak' | 'todo' | 'save' | 'unsend'
export const BUBBLE_ACTIONS: BubbleAction[] = ['react', 'reply', 'forward', 'translate', 'speak', 'todo', 'save', 'unsend']

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
  /** Voice notes: normalised amplitudes (0..1) as sent by the platform. */
  waveform?: number[]
  /** Link previews and shared posts: summary or caption. */
  caption?: string
  /** Shared posts and stories: whose content it is. */
  author?: string
  /** Story cards: reply, reaction, mention or share. */
  label?: StoryLabel
  /** Shared posts: reel (short video) rather than a feed post. */
  reel?: boolean
  /** Content that is gone (an expired story, a deleted post). */
  expired?: boolean
  /** A GIF delivered as a silent looping video (Telegram animations, WhatsApp GIFs). */
  gif?: boolean
  /** One of Moshi's own stickers (drawn from the app's pack, transparent and crisp). */
  sticker?: string
  /** A sticker the platform handed back on a white square (Instagram, Telegram). */
  flattened?: boolean
  /** Tagged as a sticker by when it was sent or by its size, not by id: the bubble double-checks the picture. */
  guessed?: boolean
}

/** Centered notices in a thread instead of a bubble. */
export interface SystemNotice {
  kind: 'call' | 'missed_call' | 'unavailable' | 'event'
  /** Call length in seconds. */
  seconds?: number
  /** Audio-only call rather than video. */
  audio?: boolean
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
  /** Taken back (unsent) by its sender: shown as a faint "message unsent" line, its content gone. */
  unsent?: boolean
  /** Rendered as a centered notice (calls, events, content only the official app can show). */
  system?: SystemNotice
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
  /**
   * The same file in other formats: voice notes are recorded as Opus and AAC at once; a sticker carries a copy on
   * white ('opaque', for platforms that flatten transparency) and, when it moves, its animation ('animated').
   */
  alternates?: Array<{ path: string; mime: string; size: number; role?: 'opaque' | 'animated' }>
  /** Moshi sticker id when this file is one of our stickers. */
  sticker?: string
  /** An animated GIF from the GIF picker (alternates carry an MP4 copy). */
  gif?: boolean
  width?: number
  height?: number
}

export type GifProvider = 'klipy' | 'giphy'

export type TextSize = 'sm' | 'md' | 'lg' | 'xl'

/** Moshi's own message sounds (synthesised in renderer/src/sounds.ts). */
export type SoundId = 'bubbles' | 'chirp' | 'boing' | 'twinkle' | 'marimba' | 'smooch'

/** A snippet typed with "/shortcut" in the composer. `{name}` becomes the other person's first name. */
export interface QuickReply {
  id: string
  shortcut: string
  text: string
}

/** What a backup file says about itself before it is unlocked. */
export interface BackupInfo {
  path: string
  bytes: number
  createdAt: number
  appVersion: string
  includesSessions: boolean
  accounts: number
}

/** A message waiting to be sent later (see main/scheduler.ts). */
export interface ScheduledMessage {
  id: string
  conversationId: string
  text: string
  sendAt: number
  createdAt: number
  replyToId?: string
  /** pending: waiting; failed: sending went wrong; missed: fell due long ago while Moshi was closed. */
  status: 'pending' | 'failed' | 'missed'
  error?: string
}

/** Interface zoom steps offered in Settings and by Ctrl +/- (1 = 100%). */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export function clampZoom(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(2, Math.max(0.8, value)) : 1
}

/** The next zoom step up (+1) or down (-1) from the current zoom. */
export function stepZoom(current: number | undefined, direction: 1 | -1): number {
  const zoom = clampZoom(current)
  if (direction > 0) return ZOOM_STEPS.find((z) => z > zoom + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001) ?? ZOOM_STEPS[0]
}

export interface GifMedia {
  url: string
  width: number
  height: number
  size?: number
}

export interface GifItem {
  id: string
  title: string
  provider: GifProvider
  /** Small looping preview for the picker grid. */
  preview: GifMedia
  /** The GIF that gets sent. */
  gif: GifMedia
  mp4?: GifMedia
}

export interface GifPage {
  items: GifItem[]
  hasNext: boolean
  page: number
}

export interface SendOptions {
  replyToId?: string
  attachments?: OutgoingAttachment[]
}

export interface SearchHit {
  message: Message
  conversation: Conversation
}

/** Everything a platform is willing to tell us about the person on the other side. */
export interface PeerProfile {
  id: string
  name: string
  handle?: string
  avatarUrl?: string
  bio?: string
  phone?: string
  /** ISO date (YYYY-MM-DD) or partial (--MM-DD) when the year is hidden. */
  birthday?: string
  gender?: string
  /** Extra platform-specific facts, already localised by the adapter. */
  extra?: Array<{ label: string; value: string }>
}

export type SharedKind = 'media' | 'links' | 'files'

/** How long and how much two people have been talking. */
export interface ConversationStats {
  firstMessageAt?: number
  lastMessageAt?: number
  messageCount?: number
  /** True when the count is only what is cached locally, not the platform total. */
  approximate?: boolean
  /** The adapter is still walking back through history; numbers will grow. */
  pending?: boolean
}

/** Built-in tag ids, or `c-…` for tags the user created. */
export type TagId = string
export type BuiltinTagId = 'work' | 'friend' | 'love' | 'family' | 'vip' | 'fun'

export interface TagMeta {
  id: TagId
  /** Line icon name (see the renderer's TAG_ICONS). */
  icon?: string
  /** Older custom tags only; newer tags use `icon`. */
  emoji: string
  /** Ink: label and icon colour. */
  color: string
  /** Pastel slab colour (lighter, often warmer than the ink). Derived from `color` when absent. */
  fill?: string
  name: { vi: string; en: string }
}

/** Ink + fill pairs sampled from the pastel "slab" tag style. */
export const TAG_PALETTE: Array<{ color: string; fill: string }> = [
  { color: '#3B82EE', fill: '#D2E5FF' },
  { color: '#5A9A0B', fill: '#DDF48A' },
  { color: '#11996A', fill: '#BDEFD2' },
  { color: '#EC7212', fill: '#FFDF8E' },
  { color: '#A052E8', fill: '#EAD7FF' },
  { color: '#E0457F', fill: '#FFD4E5' },
  { color: '#0A97B5', fill: '#C2EEF7' },
  { color: '#DC4436', fill: '#FFD6CE' },
  { color: '#B07415', fill: '#F7E5BC' },
  { color: '#56657C', fill: '#E0E6EF' }
]

/** Kept for older call sites: the ink colours of the palette. */
export const TAG_COLORS = TAG_PALETTE.map((p) => p.color)

export const TAGS: Record<BuiltinTagId, TagMeta> = {
  work: { id: 'work', icon: 'briefcase', emoji: '💼', ...TAG_PALETTE[0], name: { vi: 'Công việc', en: 'Work' } },
  friend: { id: 'friend', icon: 'handshake', emoji: '🤝', ...TAG_PALETTE[3], name: { vi: 'Bạn thân', en: 'Best friend' } },
  love: { id: 'love', icon: 'heart', emoji: '❤️', ...TAG_PALETTE[5], name: { vi: 'Người yêu', en: 'Love' } },
  family: { id: 'family', icon: 'house', emoji: '🏡', ...TAG_PALETTE[2], name: { vi: 'Gia đình', en: 'Family' } },
  vip: { id: 'vip', icon: 'star', emoji: '⭐️', ...TAG_PALETTE[4], name: { vi: 'VIP', en: 'VIP' } },
  fun: { id: 'fun', icon: 'party', emoji: '🎉', ...TAG_PALETTE[1], name: { vi: 'Vui vẻ', en: 'Fun' } }
}

export const TAG_ORDER: BuiltinTagId[] = ['work', 'friend', 'love', 'family', 'vip', 'fun']

/** The user's tags in display order (the six built-ins until they change anything). Built-ins always use the current look. */
export function tagDefsOf(settings: { tagDefs?: TagMeta[] }): TagMeta[] {
  if (!settings.tagDefs) return TAG_ORDER.map((id) => TAGS[id])
  return settings.tagDefs.map((tag) => {
    const builtin = TAGS[tag.id as BuiltinTagId]
    if (builtin) return { ...tag, icon: builtin.icon, color: builtin.color, fill: builtin.fill, emoji: builtin.emoji }
    // Custom tags made before fills existed: use the palette fill for their ink when there is one.
    if (!tag.fill) return { ...tag, fill: TAG_PALETTE.find((p) => p.color.toLowerCase() === tag.color.toLowerCase())?.fill }
    return tag
  })
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

/** Someone you can start a new conversation with. */
export interface Contact extends Peer {
  accountId: string
  platform: Platform
}

/** A Facebook Page (and its linked Instagram account) returned by the OAuth picker. */
export interface PageOption {
  id: string
  name: string
  accessToken: string
  pictureUrl?: string
  instagram?: { id: string; username: string }
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

export type MeshId = 'sunrise' | 'ocean' | 'candy' | 'forest' | 'lavender' | 'mono'
export type AccentId = 'ocean' | 'violet' | 'rose' | 'coral' | 'mint' | 'sun' | 'tangerine' | 'sunflower' | 'grass' | 'bubblegum' | 'cobalt' | 'grape'
/** Accents the user built in Settings: one colour, or a gradient when `to` is set. */
export type CustomAccentId = `custom-${string}`
export interface CustomAccent {
  id: CustomAccentId
  from: string
  to?: string
}

export type FontId = 'jakarta' | 'inter' | 'nunito' | 'system'

export const MESHES: Array<{ id: MeshId; name: { vi: string; en: string }; swatch: string[] }> = [
  { id: 'sunrise', name: { vi: 'Bình minh', en: 'Sunrise' }, swatch: ['#ffd6e0', '#d6e6ff', '#e7dbff', '#ffe8c9'] },
  { id: 'ocean', name: { vi: 'Đại dương', en: 'Ocean' }, swatch: ['#cfe7ff', '#d2f4f1', '#dfe2ff', '#e6f7ff'] },
  { id: 'candy', name: { vi: 'Kẹo ngọt', en: 'Candy' }, swatch: ['#ffd1e8', '#ffe1c9', '#f2d5ff', '#d6f0ff'] },
  { id: 'forest', name: { vi: 'Rừng xanh', en: 'Forest' }, swatch: ['#d5f5e3', '#e9f7c9', '#d3ecff', '#fff1cf'] },
  { id: 'lavender', name: { vi: 'Oải hương', en: 'Lavender' }, swatch: ['#e6dbff', '#f3d9ff', '#d9e2ff', '#ffe3f2'] },
  { id: 'mono', name: { vi: 'Tối giản', en: 'Mono' }, swatch: ['#eceef5', '#e3e6ef', '#f2f3f8', '#dfe3ee'] }
]

/** Surface style: how panels, bubbles and sheets are drawn. The layout never changes with it. */
export type StyleId = 'moshi' | 'liquid'
export const STYLES: Array<{ id: StyleId; name: { vi: string; en: string }; sub: { vi: string; en: string } }> = [
  { id: 'moshi', name: { vi: 'Moshi', en: 'Moshi' }, sub: { vi: 'Pastel mềm, kính mờ nhẹ', en: 'Soft pastel, light frosted glass' } },
  { id: 'liquid', name: { vi: 'Liquid Glass', en: 'Liquid Glass' }, sub: { vi: 'Kính trong, viền sáng, bo tròn sâu', en: 'Clear glass, bright edges, deep rounding' } }
]

/** Base tone behind everything in dark mode: a preset id, or any `#rrggbb` picked by the user. */
export type DarkBaseId = 'navy' | 'graphite' | 'black' | 'slate' | 'mocha'
export const DARK_BASES: Array<{ id: DarkBaseId; name: { vi: string; en: string }; base: string }> = [
  { id: 'navy', name: { vi: 'Xanh than', en: 'Navy' }, base: '#0f1122' },
  { id: 'graphite', name: { vi: 'Xám than', en: 'Graphite' }, base: '#161618' },
  { id: 'black', name: { vi: 'Đen', en: 'Black' }, base: '#000000' },
  { id: 'slate', name: { vi: 'Xám xanh', en: 'Slate' }, base: '#151a21' },
  { id: 'mocha', name: { vi: 'Nâu mocha', en: 'Mocha' }, base: '#1b1512' }
]
/** The hex behind a dark-base setting (a preset id, a custom hex, or nothing = navy). */
export const darkBaseHex = (value: string | undefined): string => DARK_BASES.find((d) => d.id === value)?.base ?? (value && /^#[0-9a-f]{6}$/i.test(value) ? value : DARK_BASES[0].base)

/** `flat` accents are single solid colours taken from the logo characters (no gradients anywhere). */
export const ACCENTS: Array<{ id: AccentId; name: { vi: string; en: string }; from: string; to: string; flat?: boolean }> = [
  { id: 'ocean', name: { vi: 'Xanh biển', en: 'Ocean' }, from: '#5b8cff', to: '#8a6bff' },
  { id: 'violet', name: { vi: 'Tím', en: 'Violet' }, from: '#8b5cf6', to: '#d946ef' },
  { id: 'rose', name: { vi: 'Hồng', en: 'Rose' }, from: '#f45d8a', to: '#ff8a5b' },
  { id: 'coral', name: { vi: 'San hô', en: 'Coral' }, from: '#ff7a59', to: '#ffb347' },
  { id: 'mint', name: { vi: 'Bạc hà', en: 'Mint' }, from: '#22c1a3', to: '#4fa3ff' },
  { id: 'sun', name: { vi: 'Nắng', en: 'Sun' }, from: '#f7b733', to: '#fc4a1a' },
  { id: 'tangerine', name: { vi: 'Quýt', en: 'Tangerine' }, from: '#FF5B1F', to: '#FF5B1F', flat: true },
  { id: 'sunflower', name: { vi: 'Hướng dương', en: 'Sunflower' }, from: '#FFC21A', to: '#FFC21A', flat: true },
  { id: 'grass', name: { vi: 'Cỏ non', en: 'Grass' }, from: '#10A862', to: '#10A862', flat: true },
  { id: 'bubblegum', name: { vi: 'Kẹo hồng', en: 'Bubblegum' }, from: '#FF5FA8', to: '#FF5FA8', flat: true },
  { id: 'cobalt', name: { vi: 'Xanh cobalt', en: 'Cobalt' }, from: '#1F6BFF', to: '#1F6BFF', flat: true },
  { id: 'grape', name: { vi: 'Nho', en: 'Grape' }, from: '#9B5DE5', to: '#9B5DE5', flat: true }
]

export const FONTS: Array<{ id: FontId; name: string; family: string }> = [
  { id: 'jakarta', name: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans'" },
  { id: 'inter', name: 'Inter', family: "'Inter'" },
  { id: 'nunito', name: 'Nunito', family: "'Nunito'" },
  { id: 'system', name: 'System', family: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI"' }
]

/** Current conditions near the user, from Open-Meteo (WMO weather codes). */
export interface WeatherInfo {
  city: string
  country: string
  temperature: number
  feelsLike?: number
  code: number
  isDay: boolean
  fetchedAt: number
}

/** Where notifications are switched off. */
export interface MuteRules {
  conversations: string[]
  tags: TagId[]
  accounts: string[]
  platforms: Platform[]
}

export interface SentSticker {
  conversationId: string
  messageId: string
  sticker: string
  sentAt: number
}

export interface Settings {
  theme: ThemePreference
  language: Language
  notifications: boolean
  sendOnEnter: boolean
  /** Conversation id -> tags picked by the user. */
  tags: Record<string, TagId[]>
  sidebarCollapsed: boolean
  /** Sidebar groups folded away (true = folded), so the bar shows only what you look at. */
  sidebarSections?: Partial<Record<SidebarSection, boolean>>
  mesh: MeshId
  /** Surface effects (glass, edges, rounding); absent = the Moshi look. */
  style?: StyleId
  /** Dark-mode base tone: a DarkBaseId or a custom `#rrggbb`; absent = navy. */
  darkBase?: DarkBaseId | string
  accent: AccentId | CustomAccentId
  font: FontId
  muted: MuteRules
  /** Cheerful rotating line (with local weather) in the title bar. */
  greetings: boolean
  /** Tag definitions (built-in and custom) in display order; absent means the built-in six. */
  tagDefs?: TagMeta[]
  /** Pins set in Moshi: conversation id -> pinned. Overrides the platform's own pin. */
  pins?: Record<string, boolean>
  /** Logo character used in the app and as the window icon. */
  logo?: LogoId
  /** Soft drop shadows under message bubbles (off = completely flat). */
  messageShadows?: boolean
  /** Accents created with the colour picker. */
  customAccents?: CustomAccent[]
  /** Per conversation: nickname, custom photo, birthday set by the user. */
  contactOverrides?: Record<string, ContactOverride>
  /** Send "seen" to the platform when you open a chat (off = read privately). */
  sendReadReceipts?: boolean
  /** Messages bookmarked to find again later (newest first). */
  savedMessages?: SavedMessage[]
  /** Moshi stickers you sent, so they stay stickers after the platform echoes them back as photos. */
  sentStickers?: SentSticker[]
  /** When the person accepted the unofficial-connection notice for a platform (ms since epoch). */
  acceptedUnofficial?: Partial<Record<Platform, number>>
  /** Chats hidden from the list ("Strangers" in Settings): conversation id -> when it was hidden. Hidden chats are muted too. */
  hidden?: Record<string, number>
  /** Chats marked unread in Moshi ("come back to this"): conversation id -> when. Cleared when the chat is opened or marked read. */
  markedUnread?: Record<string, number>
  /** Chats archived as done: conversation id -> when. They return to the inbox when the other side writes again (unless muted). */
  archived?: Record<string, number>
  /** Group chats that only notify when a message @mentions you or replies to you. */
  mentionsOnly?: Record<string, boolean>
  /** Message requests accepted in Moshi: conversation id -> when. Also covers platforms with no "accept" of their own (Zalo). */
  acceptedRequests?: Record<string, number>
  /** To-dos (from messages or typed), with optional reminders; the main process marks reminders shown. */
  todos?: Todo[]
  /** Text size across the app (bigger for high-resolution screens). */
  textSize?: TextSize
  /** Whole-interface zoom, 0.8-2 (1 = 100%). */
  zoom?: number
  /** Snippets inserted by typing "/" in the composer. Undefined = the starter set. */
  quickReplies?: QuickReply[]
  /** Messages to send later; only the main process edits this list. */
  scheduled?: ScheduledMessage[]
  /** On-device voice-to-text model: most accurate (turbo) or light (small). */
  voiceModel?: VoiceModel
  /** Size of the on-device chat model (summaries, reply suggestions). */
  chatModel?: ChatModel
  /** What language reply suggestions are written in: the chat's own, or always Vietnamese / English. */
  suggestLanguage?: 'auto' | 'vi' | 'en'
  /** Buttons in the bar beside a hovered message; false hides one (all on by default). */
  bubbleActions?: Partial<Record<BubbleAction, boolean>>
  /** A small label naming each of those buttons when the pointer rests on it. Default on. */
  actionLabels?: boolean
  /** Where Download in the photo viewer saves; unset (or a folder that is gone) means the system Downloads folder. */
  downloadDir?: string
  /** Ask where to save each time instead of saving straight into that folder. Default off. */
  askWhereToSave?: boolean
  /** Reply suggestions appear by themselves under new messages (once the chat model is installed). */
  aiSuggest?: boolean
  /** Sound for new messages; 'off' leaves Windows' own notification sound. Default 'bubbles'. */
  sound?: SoundId | 'off'
  /** 0..1, default 0.7. */
  soundVolume?: number
  /** A soft whoosh when sending. Default on. */
  sendSound?: boolean
  /** Word effects (birthday confetti, hearts...). Default on. */
  effects?: boolean
  /** GIF search: the user's own KLIPY or GIPHY key (Tenor's public API closed in 2026). */
  gif?: { provider: GifProvider; key: string }
}

/** Sync between computers through a shared folder (see shared/sync-merge). */
export interface SyncStatus {
  enabled: boolean
  /** The "Moshi Sync" folder inside the one the user picked. */
  folder?: string
  /** This computer's name, as the others see it. */
  deviceName: string
  /** When this computer last wrote its changes to the folder. */
  lastSyncAt?: number
  error?: string
  /** The other computers found in the folder, most recently changed first. */
  devices: Array<{ name: string; updatedAt: number }>
}

/** A bookmarked message: enough to list it and jump back to it. */
export interface SavedMessage {
  conversationId: string
  messageId: string
  platform: Platform
  text: string
  kind?: PreviewKind
  senderName: string
  isOutgoing: boolean
  sentAt: number
  savedAt: number
}

/** What the user changed about a contact in Moshi (never sent to the platform). */
export interface ContactOverride {
  nickname?: string
  /** Data URL of an uploaded photo, or `logo:<LogoId>` for one of the Moshi characters. */
  avatar?: string
  /** YYYY-MM-DD, or --MM-DD without the year. */
  birthday?: string
  /** Outgoing bubble colour for this chat: a preset or custom accent id. */
  bubble?: string
  /** Chat wallpaper: a preset id (see shared/extras.ts WALLPAPERS) or an uploaded photo (data URL). */
  wallpaper?: string
  /** Language code the composer translates into for this chat (last used). */
  translateTo?: string
  /** Translate every message to this chat on send. */
  translateAuto?: boolean
}

export type SidebarSection = 'inboxes' | 'tags' | 'accounts'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'en',
  notifications: true,
  sendOnEnter: true,
  tags: {},
  sidebarCollapsed: false,
  mesh: 'sunrise',
  accent: 'ocean',
  font: 'jakarta',
  muted: { conversations: [], tags: [], accounts: [], platforms: [] },
  greetings: true
}

/** True when notifications for this conversation are switched off by any rule. */
export function isMutedBy(settings: Pick<Settings, 'muted' | 'tags'>, conversation: Pick<Conversation, 'id' | 'accountId' | 'platform'>): boolean {
  const m = settings.muted
  if (!m) return false
  if (m.conversations.includes(conversation.id)) return true
  if (m.accounts.includes(conversation.accountId)) return true
  if (m.platforms.includes(conversation.platform)) return true
  const tags = settings.tags?.[conversation.id] ?? []
  return tags.some((t) => m.tags.includes(t))
}

/** What the native menu bar (macOS) asks the renderer to do. */
export type AppCommand =
  | 'settings'
  | 'new-chat'
  | 'command-palette'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'toggle-split'
  | 'close'
  | 'archive'
  | 'toggle-unread'
  | 'show-archive'

/** In-app updates (GitHub Releases). `manual`: this build cannot replace itself (unsigned macOS), so offer the download page. */
export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; notes?: string; manual?: boolean; url: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'none'; version: string }
  | { phase: 'error'; message: string; url: string; version?: string }

/** Events pushed from main to the renderer. */
export type BridgeEvent =
  | { type: 'app:command'; command: AppCommand }
  /** ⌘-shortcuts caught before the menu while the photo editor is open (undo, redo, copy, save, send, close). */
  | { type: 'editor:key'; key: string; shift: boolean }
  | { type: 'update:state'; state: UpdateState }
  | { type: 'account:updated'; account: Account }
  | { type: 'account:removed'; accountId: string }
  | { type: 'conversation:upserted'; conversation: Conversation }
  | { type: 'conversations:reset'; accountId: string; conversations: Conversation[] }
  | { type: 'message:new'; message: Message }
  | { type: 'message:updated'; message: Message }
  /** Reactions on a message changed (someone reacted or took it back); nothing else about it did. */
  | { type: 'message:reactions'; conversationId: string; messageId: string; reactions: Reaction[] }
  | { type: 'typing'; typing: TypingEvent }
  | { type: 'auth:prompt'; prompt: AuthPrompt }
  | { type: 'auth:cleared'; requestId: string }
  | { type: 'focus-conversation'; conversationId: string; messageId?: string }
  | { type: 'window:state'; maximized: boolean }
  | { type: 'settings:updated'; settings: Settings }
  | { type: 'ai:progress'; progress: AiProgress }
  /** The insights backfill walking recent history: done of total chats. */
  | { type: 'insights:progress'; done: number; total: number }

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
