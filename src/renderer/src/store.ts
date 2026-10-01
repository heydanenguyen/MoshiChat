import { useMemo } from 'react'
import { create } from 'zustand'
import type { CustomSticker, StickerSource } from '@shared/bridge'
import { shareSettings } from '@shared/settings-share'
import type { SettingsPage } from './components/SettingsSheet'
import type {
  Account,
  AddAccountInput,
  AuthPrompt,
  BridgeEvent,
  Contact,
  Conversation,
  ConversationStats,
  Message,
  OutgoingAttachment,
  PageOption,
  PeerProfile,
  Platform,
  SearchHit,
  Settings,
  SharedKind,
  TagId,
  TagMeta,
  ContactOverride,
  CustomAccent,
  SavedMessage,
  GifItem,
  SentSticker,
  LockState
} from '@shared/types'
import { ACCENTS, DEFAULT_SETTINGS, isMutedBy, tagDefsOf, type MuteRules } from '@shared/types'
import { translate, type TKey } from './i18n'
import { LOGO_ORDER, logoIconSvg, type LogoId } from '@shared/logos'
import { accentVars, type AccentSpec } from '@shared/accent'
import { previewKindOf } from '@shared/preview'
import { abstractIdUrl } from './components/AbstractAvatar'
import { playSent, playSound } from './sounds'
import { toggleReaction } from './utils'
import { applyQuickFilter, countQuickFilters, isUnread, type QuickFilter, type QuickFilterContext } from './quickFilter'
import { mergeConversation, mergeTimeline, memberIndex, pairKey, pickSendVia as chooseSendVia, type Person } from '@shared/people'
import { accountNames, archiveMark, hasReturned, isArchived, isChatMuted, isForMe, isPendingRequest, looksLikeCode } from '@shared/inbox'
import { followState, formatLaterTime, isSnoozed, isWoken, type LaterKind } from '@shared/later'
import { parseBirthday } from '@shared/extras'
import { activate, activeId, closePane, openBeside, openIn, openIds, prune, pushRecent, restoreLayout, single, suggestBeside, toggleSplit, type PaneIndex, type PaneLayout } from './panes'

export type Filter = 'all' | Platform | `account:${string}` | `tag:${string}`

export type ListView = 'inbox' | 'archive' | 'requests' | 'snoozed'

export type LegalDoc = 'notice' | 'license' | 'terms' | 'privacy' | 'credits'

export type Sheet =
  | { kind: 'none' }
  | { kind: 'settings'; page?: SettingsPage }
  | { kind: 'add-account'; platform?: Platform }
  | { kind: 'command' }
  | { kind: 'new-chat' }
  | { kind: 'backup'; mode: 'create' | 'restore' }
  | { kind: 'legal'; doc: LegalDoc }
  | { kind: 'todos' }
  | { kind: 'insights' }
  | { kind: 'merge'; conversationId: string }

export type DetailsTab = 'info' | 'moments' | 'search' | 'media' | 'links' | 'files'

export interface LaterPickerState {
  conversationId: string
  mode: LaterKind
  /** Where to open (the picker keeps itself on screen); centred when missing. */
  x?: number
  y?: number
  /** 'end': x is the picker's right edge (under a button at the right of a header). */
  align?: 'start' | 'end'
  /** Opened from the keyboard: the first time is focused straight away. */
  keyboard?: boolean
}

export interface Toast {
  id: number
  text: string
  kind: 'error' | 'info'
  /** A button on the toast, e.g. Undo. */
  action?: { label: string; run(): void }
}

export interface Lightbox {
  url: string
  name?: string
  /** Play as a video instead of showing an image. */
  video?: boolean
  /** Still frame shown while a video loads. */
  poster?: string
  /** The original on the platform (posts, reels, stories). */
  externalUrl?: string
  externalLabel?: string
  /** Photos/videos of an album: arrows and ←/→ move through them. */
  gallery?: Array<{ url: string; video?: boolean; poster?: string }>
  index?: number
  /** The chat the photo came from: the editor's "Add to chat" puts the edited copy there. */
  conversationId?: string
}

interface State {
  ready: boolean
  settings: Settings
  accounts: Record<string, Account>
  conversations: Record<string, Conversation>
  messages: Record<string, Message[]>
  loading: Record<string, boolean>
  hasMore: Record<string, boolean>
  typing: Record<string, { name: string; until: number }>
  /** The chat in the active pane (kept in step with `layout` for everything that means "the open chat"). */
  selectedId?: string
  /** One or two panes side by side (split chat). */
  layout: PaneLayout
  /** Chats read most recently, newest first: what a fresh split shows on the right. */
  recent: string[]
  /** Window wide enough for two panes (the split stays remembered while it is not). */
  wide: boolean
  /** Asks the composer of this chat to take keyboard focus (pane switched by keyboard or the list). */
  composerFocus?: { conversationId: string; nonce: number }
  /** Per chat: the message to scroll to and flash (search hit, saved message). */
  highlightIds: Record<string, string | undefined>
  filter: Filter
  /** The chip above the chat list (Unread, Needs reply...), applied on top of `filter`. */
  quickFilter: QuickFilter
  /** Which list shows: the inbox, the archive, or message requests. */
  listView: ListView
  /** Merged chats: the app picked by hand in the composer (anchor id -> member chat, and when). */
  sendPicks: Record<string, { id: string; at: number }>
  search: string
  searchHits: SearchHit[]
  authPrompts: AuthPrompt[]
  sheet: Sheet
  detailsOpen: boolean
  detailsTab: DetailsTab
  profiles: Record<string, PeerProfile | null>
  stats: Record<string, ConversationStats>
  shared: Record<string, Message[]>
  toast?: Toast
  /** Per chat: the message being replied to. */
  replyTos: Record<string, Message | undefined>
  /** Per chat: files staged in the composer. */
  pendingFiles: Record<string, OutgoingAttachment[]>
  forwarding?: Message
  lightbox?: Lightbox
  /** Window narrower than a phone-ish breakpoint: list and chat stack. */
  narrow: boolean

  init(): Promise<void>
  /** Open a chat in the active pane (or focus the pane it is already in). */
  select(id?: string, highlightId?: string): void
  /** Open a chat next to the current one: splits the view, or fills the other pane. */
  openBeside(id: string): void
  /** Open a chat in a specific pane (drag and drop onto a landing zone). */
  openInPane(id: string, pane: PaneIndex): void
  activatePane(pane: PaneIndex, focusComposer?: boolean): void
  closePane(pane: PaneIndex): void
  toggleSplit(): void
  setWide(wide: boolean): void
  setFilter(filter: Filter): void
  setQuickFilter(quickFilter: QuickFilter): void
  setListView(listView: ListView): void
  setSearch(search: string): void
  openHit(hit: SearchHit): void
  /** Scroll to a message in the open thread, loading older pages until it appears. */
  /** Scroll to a message, loading older pages until it is there; `from` is the chat it lives in (for a merged person). */
  jumpTo(messageId: string, options?: { maxPages?: number; from?: string }): Promise<void>
  toggleSaved(message: Message): Promise<void>
  openSaved(saved: SavedMessage): Promise<void>
  /** `resolveFiles` prepares the real files after the optimistic bubble is shown (GIF downloads). */
  /** Per chat: text the composer should take over (birthday wishes, …); nonce makes repeats count. */
  composerDrafts: Record<string, { text: string; nonce: number } | undefined>
  setComposerDraft(conversationId: string, text: string): void
  /** Settings pushed from main (scheduled messages) or returned by an IPC call. */
  applySettings(settings: Settings): void
  scheduleMessage(conversationId: string, text: string, sendAt: number): Promise<void>
  send(conversationId: string, text: string, files?: OutgoingAttachment[], resolveFiles?: () => Promise<OutgoingAttachment[]>): Promise<void>
  sendGif(conversationId: string, item: GifItem): Promise<void>
  react(conversationId: string, messageId: string, emoji: string): Promise<void>
  /** Take one of my messages back for everyone (shown as unsent right away, restored if the platform refuses). */
  unsend(conversationId: string, messageId: string): Promise<void>
  setReplyTo(conversationId: string, message?: Message): void
  startForward(message?: Message): void
  forward(toConversationId: string): Promise<void>
  loadAttachment(conversationId: string, messageId: string, attachmentId: string): Promise<string | undefined>
  openAttachment(conversationId: string, messageId: string, attachmentId: string): Promise<void>
  openLightbox(lightbox?: Lightbox): void
  addFiles(conversationId: string, files: OutgoingAttachment[]): void
  addDroppedFiles(conversationId: string, files: File[]): void
  removeFile(conversationId: string, path: string): void
  /** Unsent text per chat, kept on this device so switching chats or restarting never loses it. */
  drafts: Record<string, string>
  setDraft(conversationId: string, text: string): void
  /** Remember that a message is one of our stickers (kept in settings, so it survives reloads and backups). */
  rememberSticker(record: SentSticker): void
  /** Load a chat's first page without opening it (hover in the list); `quiet` skips error toasts. */
  prefetch(conversationId: string, quiet?: boolean): Promise<void>
  loadMore(conversationId: string): Promise<void>
  openSheet(sheet: Sheet): void
  closeSheet(): void
  setSettings(patch: Partial<Settings>): Promise<void>
  toggleTag(conversationId: string, tag: TagId): Promise<void>
  createTag(input: { name: string; icon: string; color: string; fill?: string }): Promise<TagMeta>
  deleteTag(tag: TagId): Promise<void>
  togglePin(conversationId: string): Promise<void>
  /** The user's own stickers (loaded once, kept in memory). */
  customStickers: CustomSticker[]
  stickersLoaded: boolean
  loadStickers(): Promise<void>
  /** Pick an image; still photos get their background cut out when `cutout` is on (the model downloads first). */
  addSticker(cutout: boolean): Promise<void>
  /**
   * Make a sticker from a picture (picked, dropped or pasted). A still one with `cutout` goes through the sticker maker;
   * `replaces`: a sticker this one takes the place of (made again with its background cut out).
   */
  makeSticker(source: StickerSource, cutout: boolean, replaces?: string): Promise<void>
  renameSticker(id: string, name: string): Promise<void>
  /** Cut the background out of one of your stickers (made again in its place). */
  recutSticker(id: string): Promise<void>
  removeSticker(id: string): Promise<void>
  /** A photo becoming a sticker (the cut-out in progress, then the result), shown by the sticker picker's maker. */
  stickerMaker?: StickerMaker
  /** Close the maker; the sticker stays in "Mine". */
  dismissStickerMaker(): void
  /** The cut went wrong: make the sticker again from the whole photo, no cut-out. */
  remakeStickerWhole(): Promise<void>
  addTodo(input: { conversationId?: string; messageId?: string; text: string; due?: number }): Promise<void>
  updateTodo(id: string, patch: { text?: string; due?: number; done?: boolean }): Promise<void>
  removeTodo(id: string): Promise<void>
  /** Flag a chat to come back to: it counts as unread until it is opened again. Nothing is sent to the platform. */
  markUnread(conversationId: string): Promise<void>
  /** Clear new messages and the unread flag without opening the chat. */
  markRead(conversationId: string): Promise<void>
  /** Mark read if unread, unread if read. */
  toggleUnread(conversationId: string): Promise<void>
  /**
   * Done with a chat: archive it (read, out of the inbox until they write again), with Undo. If it is the open
   * chat, the next one in the list opens, so a run of chats can be cleared one key at a time.
   */
  archive(conversationId: string): Promise<void>
  unarchive(conversationId: string): Promise<void>
  /** Out of the inbox until `until` (or until they write); opens the next chat like archiving does. */
  snooze(conversationId: string, until: number): Promise<void>
  unsnooze(conversationId: string): Promise<void>
  /** Remind me at `until` if they have not written back by then. */
  followUp(conversationId: string, until: number): Promise<void>
  cancelFollowUp(conversationId: string): Promise<void>
  /** The passcode lock, as the main process reports it (undefined until known). */
  lock?: LockState
  /** The time picker for snoozing or a follow-up, opened at a point on screen. */
  laterPicker?: LaterPickerState
  openLaterPicker(picker: LaterPickerState): void
  closeLaterPicker(): void
  /** Group chats: notify only for messages that @mention you or reply to you. */
  toggleMentionsOnly(conversationId: string): Promise<void>
  /** Move a message request into the inbox (and accept it on the platform where that is a step). */
  acceptRequest(conversationId: string): Promise<void>
  /** One person across apps: fold these chats into one (the first stays the anchor). */
  mergeChats(conversationIds: string[], name?: string): Promise<void>
  /** Take one chat back out of its person. */
  unmergeChat(conversationId: string): Promise<void>
  /** "Not the same person": never suggest this pair again. */
  dismissMerge(a: string, b: string): Promise<void>
  /** Write a merged chat's messages through this member chat until they write from another app. */
  pickSendVia(anchorId: string, memberId: string): void
  /** Move a chat to Strangers: out of the list and muted until it is unhidden in Settings. */
  hideConversation(conversationId: string): Promise<void>
  unhideConversation(conversationId: string): Promise<void>
  setContactOverride(conversationId: string, override: ContactOverride | undefined): Promise<void>
  toggleMute<K extends keyof MuteRules>(kind: K, id: MuteRules[K][number]): Promise<void>
  toggleSidebar(): Promise<void>
  setDetailsTab(tab: DetailsTab): void
  loadProfile(conversationId: string, force?: boolean): Promise<void>
  loadStats(conversationId: string, force?: boolean): Promise<void>
  loadShared(conversationId: string, kind: SharedKind, force?: boolean): Promise<void>
  searchIn(conversationId: string, query: string): Promise<Message[]>
  respondAuth(requestId: string, value: string): Promise<void>
  cancelAuth(requestId: string): Promise<void>
  addAccount(input: AddAccountInput): Promise<void>
  connectWeb(platform: 'messenger' | 'instagram'): Promise<void>
  addPages(pages: PageOption[], includeInstagram: boolean): Promise<void>
  openContact(contact: Contact): Promise<void>
  setNarrow(narrow: boolean): void
  removeAccount(accountId: string): Promise<void>
  reconnect(accountId: string): Promise<void>
  addDemo(): Promise<void>
  toggleDetails(tab?: DetailsTab): void
  notifyTyping(conversationId: string): void
  showToast(text: string, kind?: Toast['kind'], action?: Toast['action']): void
  t(key: TKey, params?: Record<string, string | number>): string
}

/** What the platforms return for a search inside one chat (manager SEARCH_LIMIT). */
const IN_CHAT_RESULTS = 60
let toastCounter = 0
let lastTypingSent = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const cleanError = (err: unknown): string => {
  const raw = (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
  // Errors the main process raises with a code get a translated, friendlier text.
  const language = useStore.getState().settings.language
  if (raw.startsWith('RATE_LIMIT_SEND:')) return translate(language, 'rateLimitSend')
  if (raw.startsWith('RATE_LIMIT_FORWARD:')) return translate(language, 'rateLimitForward')
  return raw
}

let prefetchesInFlight = 0

let stickerWrites = Promise.resolve()

const DRAFTS_KEY = 'unison.drafts'
let draftTimer: ReturnType<typeof setTimeout> | undefined

function loadDrafts(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

const draftMap = loadDrafts()

function flushDrafts(publish?: () => void): void {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = undefined
  publish?.()
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(draftMap))
  } catch {
    /* storage unavailable */
  }
}
window.addEventListener('beforeunload', () => flushDrafts())

/** The latest unsent text for a chat (ahead of `drafts`, which updates once typing pauses). */
export function readDraft(conversationId: string): string {
  return draftMap[conversationId] ?? ''
}


const LAYOUT_KEY = 'moshi.panes'

function loadLayout(): unknown {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null')
  } catch {
    return undefined
  }
}

function saveLayout(layout: PaneLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    /* storage unavailable */
  }
}

/** Chats on screen right now (both panes when split). */
function onScreen(conversationId: string): boolean {
  const state = useStore.getState()
  return openIds(state.layout).includes(anchorFor(state, conversationId))
}

/** Your messages in a chat, as far as they are loaded (so a reply to one of them is recognised exactly). */
function ownIds(conversationId: string): Set<string> {
  return new Set((useStore.getState().messages[conversationId] ?? []).filter((m) => m.isOutgoing).map((m) => m.id))
}

/** A new incoming message plays the chosen sound, unless the chat is muted; softer in an open chat. */
function maybePlaySound(message: Message): void {
  const { settings, conversations } = useStore.getState()
  const sound = settings.sound ?? 'bubbles'
  if (sound === 'off' || message.isOutgoing || message.system || Date.now() - message.sentAt > 60_000) return
  const raw = conversations[message.conversationId]
  // A merged person is muted (and so on) as a whole, under the anchor's id, and a request only as a whole.
  const shownId = raw && anchorFor(useStore.getState(), raw.id)
  const conversation = raw && shownId && { ...raw, id: shownId, request: shownConversation(useStore.getState(), shownId)?.request }
  if (!conversation || conversation.muted || settings.muted.conversations.includes(conversation.id) || isMutedBy(settings, conversation)) return
  if (isPendingRequest(conversation, settings.acceptedRequests) && !looksLikeCode(message.text)) return
  if (settings.mentionsOnly?.[conversation.id] && !isForMe(message, accountNames(useStore.getState().accounts[conversation.accountId]), ownIds(message.conversationId))) return
  const watching = document.hasFocus() && onScreen(message.conversationId)
  playSound(sound, (settings.soundVolume ?? 0.7) * (watching ? 0.45 : 1))
}

function upsertMessage(list: Message[] | undefined, message: Message, replaceId?: string): Message[] | undefined {
  if (!list) return list
  // Drop the optimistic placeholder first: the real message may already have
  // arrived through a 'message:new' event before the send call resolved.
  const base = replaceId && replaceId !== message.id ? list.filter((m) => m.id !== replaceId) : list
  const index = base.findIndex((m) => m.id === message.id)
  if (index >= 0) {
    const next = base.slice()
    next[index] = message
    return next
  }
  return [...base, message].sort((a, b) => a.sentAt - b.sentAt)
}

/** A photo becoming a sticker: cutting (the scan plays), done (the sticker lifts off), or error. */
export interface StickerMaker {
  phase: 'cutting' | 'done' | 'error'
  /** The photo, small, as a data URL. */
  preview: string
  path: string
  startedAt: number
  sticker?: CustomSticker
  error?: string
  /** Made again from the whole photo (no cut-out). */
  whole?: boolean
  /** One of your stickers being cut out again (its old picture is gone, so there is no whole photo to go back to). */
  recut?: boolean
}

/** The scan always plays at least this long, even when the cut-out is quicker. */
const MAKER_MIN_SCAN_MS = 1600

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  accounts: {},
  conversations: {},
  messages: {},
  loading: {},
  hasMore: {},
  typing: {},
  layout: { panes: [undefined], active: 0 },
  recent: [],
  wide: true,
  highlightIds: {},
  filter: 'all',
  quickFilter: 'all',
  listView: 'inbox',
  sendPicks: {},
  search: '',
  searchHits: [],
  authPrompts: [],
  sheet: { kind: 'none' },
  detailsOpen: false,
  detailsTab: 'info',
  profiles: {},
  drafts: { ...draftMap },
  customStickers: [],
  stickersLoaded: false,
  stats: {},
  shared: {},
  replyTos: {},
  pendingFiles: {},
  composerDrafts: {},
  narrow: false,

  async init() {
    const bridge = window.unison
    const [settings, accounts, conversations, lock] = await Promise.all([
      bridge.settings.get(),
      bridge.accounts.list(),
      bridge.conversations.list(),
      // Known before anything is drawn, so a locked Moshi never flashes its chats.
      bridge.lock.state().catch(() => undefined)
    ])
    const conversationMap = Object.fromEntries(conversations.map((c) => [c.id, c]))
    set({
      ready: true,
      lock,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      accounts: Object.fromEntries(accounts.map((a) => [a.id, a])),
      conversations: conversationMap
    })
    // Reopen the panes from last time (only chats that still exist), without marking anything read.
    const layout = restoreLayout(loadLayout(), (id) => !!conversationMap[id])
    set({ layout, selectedId: activeId(layout), recent: openIds(layout) })
    for (const id of openIds(layout)) void get().prefetch(id, true)

    bridge.onEvent((event: BridgeEvent) => {
      const state = get()
      switch (event.type) {
        case 'app:notice':
          get().showToast(translate(get().settings.language, 'noticeInsecureSecrets'), 'error')
          break
        case 'account:updated':
          set({ accounts: { ...state.accounts, [event.account.id]: event.account } })
          break
        case 'account:removed': {
          const accounts = { ...state.accounts }
          delete accounts[event.accountId]
          const conversations = Object.fromEntries(
            Object.entries(state.conversations).filter(([, c]) => c.accountId !== event.accountId)
          )
          set({ accounts, conversations })
          applyLayout(prune(state.layout, (id) => !!conversations[id]))
          break
        }
        case 'conversation:upserted':
          set({ conversations: { ...state.conversations, [event.conversation.id]: event.conversation } })
          break
        case 'conversations:reset': {
          const conversations = Object.fromEntries(
            Object.entries(state.conversations).filter(([, c]) => c.accountId !== event.accountId)
          )
          for (const c of event.conversations) conversations[c.id] = c
          set({ conversations })
          break
        }
        case 'message:new': {
          maybePlaySound(event.message)
          const list = upsertMessage(state.messages[event.message.conversationId], event.message)
          // Its chat's cached media and stats are stale now, and a merged person's too.
          const stale = [event.message.conversationId, anchorFor(state, event.message.conversationId)]
          const shared = { ...state.shared }
          for (const key of Object.keys(shared)) if (stale.some((id) => key.startsWith(id + '|'))) delete shared[key]
          const stats = { ...state.stats }
          delete stats[event.message.conversationId]
          // The person finished typing: their message just arrived.
          const typing = state.typing[event.message.conversationId] && !event.message.isOutgoing ? { ...state.typing } : state.typing
          if (typing !== state.typing) {
            delete typing[event.message.conversationId]
            const timer = typingTimers.get(event.message.conversationId)
            if (timer) clearTimeout(timer)
          }
          if (list) set({ messages: { ...state.messages, [event.message.conversationId]: list }, shared, stats, typing })
          else set({ shared, stats, typing })
          if (onScreen(event.message.conversationId) && document.hasFocus() && !event.message.isOutgoing) {
            void bridge.conversations.markRead(event.message.conversationId)
          }
          break
        }
        case 'message:updated': {
          const list = upsertMessage(state.messages[event.message.conversationId], event.message)
          if (list) set({ messages: { ...state.messages, [event.message.conversationId]: list } })
          break
        }
        case 'message:reactions': {
          const list = state.messages[event.conversationId]
          const index = list?.findIndex((m) => m.id === event.messageId) ?? -1
          if (!list || index < 0) break
          const next = list.slice()
          next[index] = { ...list[index], reactions: event.reactions }
          set({ messages: { ...state.messages, [event.conversationId]: next } })
          break
        }
        case 'settings:updated':
          set({ settings: shareSettings(get().settings, event.settings) })
          break
        case 'lock:state':
          set({ lock: event.state, ...(event.state.locked ? { laterPicker: undefined } : {}) })
          break
        case 'typing': {
          const { conversationId, peerName, isTyping } = event.typing
          const existing = typingTimers.get(conversationId)
          if (existing) clearTimeout(existing)
          const typing = { ...get().typing }
          if (isTyping) {
            typing[conversationId] = { name: peerName, until: Date.now() + 10_000 }
            typingTimers.set(
              conversationId,
              setTimeout(() => {
                const next = { ...get().typing }
                delete next[conversationId]
                set({ typing: next })
              }, 10_000)
            )
          } else {
            delete typing[conversationId]
          }
          set({ typing })
          break
        }
        case 'auth:prompt': {
          const index = state.authPrompts.findIndex((p) => p.requestId === event.prompt.requestId)
          const authPrompts = state.authPrompts.slice()
          if (index >= 0) authPrompts[index] = event.prompt
          else authPrompts.push(event.prompt)
          set({ authPrompts })
          break
        }
        case 'auth:cleared':
          set({ authPrompts: state.authPrompts.filter((p) => p.requestId !== event.requestId) })
          break
        case 'focus-conversation':
          get().select(event.conversationId)
          if (event.messageId) setTimeout(() => void get().jumpTo(event.messageId!, { from: event.conversationId }), 400)
          break
      }
    })
  },

  select(rawId, highlightId) {
    const { layout } = get()
    const id = rawId && anchorFor(get(), rawId)
    if (!id) {
      // Back to the list on a phone-sized window (where a split is never shown anyway).
      applyLayout(single())
      return
    }
    if (highlightId) set({ highlightIds: { ...get().highlightIds, [id]: highlightId } })
    applyLayout(openIn(layout, id, layout.active), { focus: true })
  },

  openBeside(id) {
    applyLayout(openBeside(get().layout, anchorFor(get(), id)), { focus: true })
  },

  openInPane(id, pane) {
    applyLayout(openIn(get().layout, anchorFor(get(), id), pane), { focus: true })
  },

  activatePane(pane, focusComposer = false) {
    applyLayout(activate(get().layout, pane), { focus: focusComposer })
  },

  closePane(pane) {
    applyLayout(closePane(get().layout, pane), { focus: true })
  },

  toggleSplit() {
    const { layout, recent } = get()
    applyLayout(toggleSplit(layout, suggestBeside(layout, recent)), { focus: true })
  },

  setWide(wide) {
    if (get().wide !== wide) set({ wide })
  },

  setQuickFilter(quickFilter) {
    set({ quickFilter })
  },

  setListView(listView) {
    set({ listView })
  },

  setFilter(filter) {
    set({ filter })
  },

  setSearch(search) {
    set({ search })
    if (searchTimer) clearTimeout(searchTimer)
    if (search.trim().length < 2) {
      set({ searchHits: [] })
      return
    }
    searchTimer = setTimeout(() => {
      void window.unison.messages.search(search).then((hits) => {
        if (get().search === search) set({ searchHits: hits })
      })
    }, 180)
  },

  openHit(hit) {
    get().select(hit.conversation.id, hit.message.id)
    // A hit in one of a merged person's chats may sit beyond what the merged thread has loaded.
    if (personFor(get(), hit.conversation.id)) void get().jumpTo(hit.message.id, { from: hit.conversation.id })
  },

  async toggleSaved(message) {
    const conversation = get().conversations[message.conversationId]
    const list = get().settings.savedMessages ?? []
    const exists = list.some((s) => s.messageId === message.id && s.conversationId === message.conversationId)
    const next = exists
      ? list.filter((s) => !(s.messageId === message.id && s.conversationId === message.conversationId))
      : [
          {
            conversationId: message.conversationId,
            messageId: message.id,
            platform: conversation?.platform ?? 'messenger',
            text: message.text.slice(0, 280),
            kind: previewKindOf(message),
            senderName: message.senderName,
            isOutgoing: message.isOutgoing,
            sentAt: message.sentAt,
            savedAt: Date.now()
          },
          ...list
        ].slice(0, 500)
    await get().setSettings({ savedMessages: next })
    get().showToast(translate(get().settings.language, exists ? 'unsaved' : 'savedToast'))
  },

  async openSaved(saved) {
    // Already open (clicked from its Moments tab): stay on that tab and just jump.
    if (get().selectedId !== anchorFor(get(), saved.conversationId)) get().select(saved.conversationId)
    // Wait for the first page, then walk back until the message is loaded and highlight it.
    for (let i = 0; i < 50 && !get().messages[saved.conversationId]; i++) await new Promise((r) => setTimeout(r, 100))
    await get().jumpTo(saved.messageId, { maxPages: 40, from: saved.conversationId })
  },

  async jumpTo(messageId, { maxPages = 8, from } = {}) {
    const id = get().selectedId
    if (!id) return
    const person = personFor(get(), id)
    // In a merged thread, the chat holding the message pages back first; the others then catch up to it.
    const home = person && from && person.members.includes(from) ? from : undefined
    if (home) await settled(home)
    for (let page = 0; page < (home ? maxPages * 3 : maxPages); page++) {
      const thread = threadOf(get(), id)
      if (thread.messages?.some((m) => m.id === messageId)) break
      if (home && !get().messages[home]?.some((m) => m.id === messageId)) {
        if (!get().hasMore[home]) break
        await loadOlder(home)
        await settled(home)
        continue
      }
      if (!thread.hasMore) break
      await get().loadMore(id)
    }
    // Re-trigger the highlight even when the same message is chosen twice.
    set({ highlightIds: { ...get().highlightIds, [id]: undefined } })
    setTimeout(() => set({ highlightIds: { ...get().highlightIds, [id]: messageId } }), 0)
  },

  async send(composerId, text, files, resolveFiles) {
    const { settings, conversations } = get()
    const replyTo = get().replyTos[composerId]
    const pendingFiles = files ?? get().pendingFiles[composerId] ?? []
    const trimmed = text.trim()
    if (!composerId || (!trimmed && !pendingFiles.length)) return
    // A merged chat's composer writes through one of its member chats; the draft, reply and files stay with it.
    const selectedId = sendViaOf(get(), composerId)
    // Its history first, if it never loaded: a list holding only this message would never load the rest.
    if (selectedId !== composerId && !get().messages[selectedId]) await get().prefetch(selectedId, false)
    // Replying to a message request accepts it, as it does on the platforms.
    const conversation = conversations[selectedId]
    if (conversation && isPendingRequest(conversation, settings.acceptedRequests)) void get().acceptRequest(selectedId)
    const tempId = `temp-${Date.now()}`
    const optimistic: Message = {
      id: tempId,
      conversationId: selectedId,
      senderId: 'me',
      senderName: translate(settings.language, 'you'),
      text: trimmed,
      attachments: pendingFiles.map((f, i) => ({
        id: `${tempId}-${i}`,
        kind: f.sticker ? 'sticker' : f.mime.startsWith('image/') ? 'image' : f.mime.startsWith('video/') ? 'video' : f.mime.startsWith('audio/') ? 'audio' : 'file',
        url: f.preview,
        name: f.voice ? translate(settings.language, 'voice') : f.name,
        size: f.size,
        duration: f.duration
      })),
      reactions: [],
      replyTo: replyTo ? { id: replyTo.id, senderName: replyTo.senderName, text: replyTo.text } : undefined,
      sentAt: Date.now(),
      isOutgoing: true,
      status: 'sending'
    }
    if (settings.sendSound !== false && settings.sound !== 'off') playSent(settings.soundVolume ?? 0.7)
    const { messages } = get()
    set({
      messages: { ...messages, [selectedId]: [...(messages[selectedId] ?? []), optimistic] },
      replyTos: { ...get().replyTos, [composerId]: undefined },
      pendingFiles: files ? get().pendingFiles : { ...get().pendingFiles, [composerId]: [] }
    })
    try {
      const outgoing = resolveFiles ? await resolveFiles() : pendingFiles
      const sent = await window.unison.messages.send(selectedId, trimmed, {
        replyToId: replyTo?.id,
        attachments: outgoing.length ? outgoing : undefined
      })
      // Keep local previews for media the platform does not echo back.
      for (const [i, attachment] of sent.attachments.entries()) {
        if (!attachment.url && optimistic.attachments[i]?.url) attachment.url = optimistic.attachments[i].url
        // The platform echoes a sticker back as a photo; keep showing it as a sticker here.
        if (pendingFiles[i]?.sticker && (attachment.kind === 'image' || attachment.kind === 'sticker')) {
          attachment.kind = 'sticker'
          attachment.sticker = pendingFiles[i].sticker
          attachment.url = optimistic.attachments[i]?.url ?? attachment.url
        }
        // GIFs may come back as a video (Instagram, WhatsApp, Telegram): keep the looping GIF.
        if (pendingFiles[i]?.gif && optimistic.attachments[i]?.url) {
          attachment.kind = 'image'
          attachment.url = optimistic.attachments[i].url
        }
      }
      const s = get()
      set({ messages: { ...s.messages, [selectedId]: upsertMessage(s.messages[selectedId], sent, tempId) ?? [] } })
      // Remember it, so the sticker still looks like one after the platform sends it back as a photo.
      const sticker = pendingFiles.find((f) => f.sticker)?.sticker
      if (sticker) get().rememberSticker({ conversationId: selectedId, messageId: sent.id, sticker, sentAt: sent.sentAt })
    } catch (err) {
      const s = get()
      const failed = { ...optimistic, status: 'failed' as const }
      set({ messages: { ...s.messages, [selectedId]: upsertMessage(s.messages[selectedId], failed) ?? [] } })
      get().showToast(cleanError(err), 'error')
    }
  },

  async sendGif(conversationId, item) {
    const placeholder: OutgoingAttachment = {
      path: '',
      name: 'gif.gif',
      mime: 'image/gif',
      size: item.gif.size ?? 0,
      preview: item.gif.url,
      gif: true,
      width: item.gif.width,
      height: item.gif.height
    }
    await get().send(conversationId, '', [placeholder], async () => [await window.unison.app.gif(item)])
  },

  async react(selectedId, messageId, emoji) {
    if (!selectedId) return
    // Show it straight away (like Instagram / Messenger); the platform's own update follows.
    const list = get().messages[selectedId]
    const before = list?.find((m) => m.id === messageId)
    if (list && before) {
      const updated = { ...before, reactions: toggleReaction(before.reactions, emoji) }
      set({ messages: { ...get().messages, [selectedId]: list.map((m) => (m.id === messageId ? updated : m)) } })
    }
    try {
      await window.unison.messages.react(selectedId, messageId, emoji)
    } catch (err) {
      const current = get().messages[selectedId]
      if (current && before) set({ messages: { ...get().messages, [selectedId]: current.map((m) => (m.id === messageId ? before : m)) } })
      get().showToast(cleanError(err), 'error')
    }
  },

  async unsend(conversationId, messageId) {
    const list = get().messages[conversationId]
    const before = list?.find((m) => m.id === messageId)
    if (list && before) {
      const gone: Message = { ...before, unsent: true, text: '', attachments: [], reactions: [], replyTo: undefined }
      set({ messages: { ...get().messages, [conversationId]: list.map((m) => (m.id === messageId ? gone : m)) } })
    }
    try {
      await window.unison.messages.unsend(conversationId, messageId)
    } catch (err) {
      const current = get().messages[conversationId]
      if (current && before) set({ messages: { ...get().messages, [conversationId]: current.map((m) => (m.id === messageId ? before : m)) } })
      get().showToast(cleanError(err), 'error')
    }
  },

  rememberSticker(record) {
    stickerWrites = stickerWrites.then(async () => {
      const list = get().settings.sentStickers ?? []
      if (list.some((r) => r.conversationId === record.conversationId && r.messageId === record.messageId)) return
      await get().setSettings({ sentStickers: [...list, record].slice(-500) })
    }).catch(() => undefined)
  },

  setDraft(conversationId, text) {
    if ((draftMap[conversationId] ?? '') === (text.trim() ? text : '')) return
    if (text.trim()) draftMap[conversationId] = text
    else delete draftMap[conversationId]
    // The list and the disk catch up once typing pauses, so each keystroke stays cheap.
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => flushDrafts(() => set({ drafts: { ...draftMap } })), 400)
  },

  setReplyTo(conversationId, message) {
    // Replying from a merged thread: the quote belongs to the person's composer (the message keeps its own chat).
    set({ replyTos: { ...get().replyTos, [anchorFor(get(), conversationId)]: message } })
  },

  startForward(message) {
    set({ forwarding: message })
  },

  async forward(toConversationId) {
    const { forwarding, settings } = get()
    if (!forwarding) return
    set({ forwarding: undefined })
    try {
      const sent = await window.unison.messages.forward(forwarding.conversationId, forwarding.id, toConversationId)
      const s = get()
      if (s.messages[toConversationId]) {
        set({ messages: { ...s.messages, [toConversationId]: upsertMessage(s.messages[toConversationId], sent) ?? [] } })
      }
      get().showToast(translate(settings.language, 'forwarded', { name: s.conversations[toConversationId]?.title ?? '' }))
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  async loadAttachment(conversationId, messageId, attachmentId) {
    try {
      const url = await window.unison.messages.loadAttachment(conversationId, messageId, attachmentId)
      if (!url) return undefined
      const s = get()
      const list = s.messages[conversationId]
      if (list) {
        const next = list.map((m) =>
          m.id === messageId ? { ...m, attachments: m.attachments.map((a) => (a.id === attachmentId ? { ...a, url } : a)) } : m
        )
        set({ messages: { ...s.messages, [conversationId]: next } })
      }
      return url
    } catch (err) {
      get().showToast(cleanError(err), 'error')
      return undefined
    }
  },

  async openAttachment(conversationId, messageId, attachmentId) {
    try {
      await window.unison.messages.openAttachment(conversationId, messageId, attachmentId)
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  openLightbox(lightbox) {
    set({ lightbox })
  },

  addFiles(conversationId, files) {
    const current = get().pendingFiles[conversationId] ?? []
    const existing = new Set(current.map((f) => f.path))
    set({ pendingFiles: { ...get().pendingFiles, [conversationId]: [...current, ...files.filter((f) => !existing.has(f.path))] } })
  },

  addDroppedFiles(conversationId, files) {
    for (const file of files) {
      const described = window.unison.app.describeFile(file)
      if (!described.path) {
        // Pasted from the clipboard (a screenshot): there is no file on disk yet, so main writes one.
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue
        void file
          .arrayBuffer()
          .then((buf) => window.unison.app.saveImage(new Uint8Array(buf), file.type, file.name))
          .then((attachment) => get().addFiles(conversationId, [attachment]))
          .catch((err) => get().showToast(cleanError(err), 'error'))
        continue
      }
      if (file.type.startsWith('image/') && file.size < 3_000_000) {
        const reader = new FileReader()
        reader.onload = () => get().addFiles(conversationId, [{ ...described, preview: String(reader.result) }])
        reader.readAsDataURL(file)
      } else {
        get().addFiles(conversationId, [described])
      }
    }
  },

  removeFile(conversationId, path) {
    set({ pendingFiles: { ...get().pendingFiles, [conversationId]: (get().pendingFiles[conversationId] ?? []).filter((f) => f.path !== path) } })
  },

  async prefetch(id, quiet = true) {
    const state = get()
    if (state.messages[id] || state.loading[id]) return
    // Hover prefetch: one at a time, so a quick sweep over the list does not flood the platforms.
    if (quiet && prefetchesInFlight > 0) return
    if (quiet) prefetchesInFlight += 1
    set({ loading: { ...state.loading, [id]: true } })
    try {
      const messages = await window.unison.messages.list(id)
      const s = get()
      set({
        messages: { ...s.messages, [id]: messages },
        hasMore: { ...s.hasMore, [id]: messages.length > 0 },
        loading: { ...s.loading, [id]: false }
      })
    } catch (err) {
      set({ loading: { ...get().loading, [id]: false } })
      // A failed hover prefetch stays quiet; opening the chat tries again and reports errors.
      if (!quiet || onScreen(id)) get().showToast((err as Error).message, 'error')
    } finally {
      if (quiet) prefetchesInFlight -= 1
    }
  },

  async loadMore(conversationId) {
    const person = personFor(get(), conversationId)
    if (person) {
      // A merged thread pages back through the chats that hold its edge (the others already reach further).
      const { cut } = mergeTimeline(person.members.map((id) => ({ messages: get().messages[id], hasMore: !!get().hasMore[id] })))
      const edge = person.members.filter((id) => get().hasMore[id] && (get().messages[id]?.[0]?.sentAt ?? 0) >= cut)
      await Promise.all(edge.map((id) => loadOlder(id)))
      return
    }
    await loadOlder(conversationId)
  },

  openSheet(sheet) {
    set({ sheet })
  },

  closeSheet() {
    set({ sheet: { kind: 'none' }, forwarding: undefined, lightbox: undefined })
  },

  setComposerDraft(conversationId, text) {
    set({ composerDrafts: { ...get().composerDrafts, [conversationId]: { text, nonce: Date.now() } } })
  },

  applySettings(settings) {
    set({ settings: shareSettings(get().settings, settings) })
  },

  async scheduleMessage(selectedId, text, sendAt) {
    const replyTo = get().replyTos[selectedId]
    if (!selectedId || !text.trim()) return
    // A merged person: scheduled through the app the composer shows (a quote pins its own app).
    const target = sendViaOf(get(), selectedId)
    try {
      const settings = await window.unison.scheduled.add({ conversationId: target, text, sendAt, replyToId: replyTo?.conversationId === target ? replyTo.id : undefined })
      set({ settings: shareSettings(get().settings, settings), replyTos: { ...get().replyTos, [selectedId]: undefined } })
      const when = new Date(sendAt)
      const time = when.toLocaleString(get().settings.language === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit', ...(when.toDateString() === new Date().toDateString() ? {} : { weekday: 'short', day: 'numeric', month: 'numeric' }) })
      get().showToast(translate(get().settings.language, 'scheduledToast', { time }))
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  async setSettings(patch) {
    const settings = await window.unison.settings.set(patch)
    set({ settings: shareSettings(get().settings, settings) })
  },

  async toggleTag(conversationId, tag) {
    const current = get().settings.tags[conversationId] ?? []
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    const tags = { ...get().settings.tags }
    if (next.length) tags[conversationId] = next
    else delete tags[conversationId]
    await get().setSettings({ tags })
  },

  async createTag({ name, icon, color, fill }) {
    const clean = name.trim().slice(0, 24)
    const tag: TagMeta = { id: `c-${Date.now().toString(36)}`, icon, emoji: '', color, fill, name: { vi: clean, en: clean } }
    await get().setSettings({ tagDefs: [...tagDefsOf(get().settings), tag] })
    return tag
  },

  async deleteTag(tag) {
    const { settings, filter } = get()
    const tags: Record<string, TagId[]> = {}
    for (const [conversationId, list] of Object.entries(settings.tags)) {
      const next = list.filter((t) => t !== tag)
      if (next.length) tags[conversationId] = next
    }
    await get().setSettings({
      tagDefs: tagDefsOf(settings).filter((t) => t.id !== tag),
      tags,
      muted: { ...settings.muted, tags: settings.muted.tags.filter((t) => t !== tag) }
    })
    if (filter === `tag:${tag}`) set({ filter: 'all' })
  },

  async setContactOverride(conversationId, override) {
    const overrides = { ...(get().settings.contactOverrides ?? {}) }
    const clean: ContactOverride = {}
    if (override?.nickname?.trim()) clean.nickname = override.nickname.trim().slice(0, 60)
    if (override?.avatar) clean.avatar = override.avatar
    if (override?.birthday) clean.birthday = override.birthday
    if (override?.bubble) clean.bubble = override.bubble
    if (override?.wallpaper) clean.wallpaper = override.wallpaper
    if (override?.translateTo) clean.translateTo = override.translateTo
    if (override?.translateAuto && override.translateTo) clean.translateAuto = true
    if (override?.note?.trim()) {
      clean.note = override.note.slice(0, 4000)
      clean.noteAt = override.noteAt ?? Date.now()
    }
    if (Object.keys(clean).length) overrides[conversationId] = clean
    else delete overrides[conversationId]
    await get().setSettings({ contactOverrides: overrides })
  },

  async togglePin(conversationId) {
    const { settings, conversations } = get()
    const pinned = isPinned(conversations[conversationId], settings.pins)
    await get().setSettings({ pins: { ...(settings.pins ?? {}), [conversationId]: !pinned } })
  },

  async loadStickers() {
    if (get().stickersLoaded) return
    try {
      set({ customStickers: await window.unison.stickers.list(), stickersLoaded: true })
    } catch {
      set({ stickersLoaded: true })
    }
  },

  async addSticker(cutout) {
    const picked = await window.unison.stickers.pick()
    if (picked) await get().makeSticker(picked, cutout)
  },

  async makeSticker(picked, cutout, replaces) {
    // One at a time: a second picture waits for the maker to be closed.
    if (get().stickerMaker?.phase === 'cutting') return
    if (cutout && !picked.animated) {
      // The scan plays while the background is cut out, then the sticker lifts off the photo.
      const make = async (): Promise<void> => {
        const startedAt = Date.now()
        set({ stickerMaker: { phase: 'cutting', preview: picked.preview ?? '', path: picked.path, startedAt, recut: !!replaces || undefined } })
        try {
          const sticker = await window.unison.stickers.add(picked.path, true, picked.name)
          if (replaces) await get().removeSticker(replaces)
          // A quick cut still gets a moment of scanning, so the reveal never feels like a glitch.
          const rest = MAKER_MIN_SCAN_MS - (Date.now() - startedAt)
          if (rest > 0) await new Promise((r) => setTimeout(r, rest))
          set({ customStickers: [sticker, ...get().customStickers] })
          if (get().stickerMaker?.startedAt !== startedAt) return
          set({ stickerMaker: { ...get().stickerMaker!, phase: 'done', sticker } })
          // Closed the picker meanwhile: the result waits there; a toast says it is ready.
          if (!document.querySelector('.sticker-maker')) get().showToast(translate(get().settings.language, 'makerReadyToast'))
        } catch (err) {
          if (get().stickerMaker?.startedAt !== startedAt) return
          set({ stickerMaker: { ...get().stickerMaker!, phase: 'error', error: cleanError(err) } })
        }
      }
      // The cut-out model may still need downloading: the AI setup sheet takes over and calls back.
      const { useAi } = await import('./aiStore')
      await useAi.getState().withModel('cutout', make)
      return
    }
    try {
      const sticker = await window.unison.stickers.add(picked.path, false, picked.name)
      set({ customStickers: [sticker, ...get().customStickers] })
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  async renameSticker(id, name) {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40)
    if (!clean) return
    await window.unison.stickers.rename(id, clean)
    set({ customStickers: get().customStickers.map((s) => (s.id === id ? { ...s, name: clean } : s)) })
  },

  async recutSticker(id) {
    try {
      await get().makeSticker(await window.unison.stickers.source(id), true, id)
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  async removeSticker(id) {
    await window.unison.stickers.remove(id)
    set({ customStickers: get().customStickers.filter((s) => s.id !== id) })
  },

  dismissStickerMaker() {
    set({ stickerMaker: undefined })
  },

  async remakeStickerWhole() {
    const maker = get().stickerMaker
    if (!maker) return
    try {
      const sticker = await window.unison.stickers.add(maker.path, false)
      if (maker.sticker) await get().removeSticker(maker.sticker.id)
      set({ customStickers: [sticker, ...get().customStickers.filter((s) => s.id !== sticker.id)], stickerMaker: { ...maker, phase: 'done', sticker, whole: true } })
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  async addTodo(input) {
    const { settings } = get()
    const todo = { id: crypto.randomUUID(), createdAt: Date.now(), ...input }
    await get().setSettings({ todos: [...(settings.todos ?? []), todo] })
    get().showToast(translate(settings.language, 'todoAdded'), 'info')
  },

  async updateTodo(id, patch) {
    const { settings } = get()
    const now = Date.now()
    const todos = (settings.todos ?? []).map((t) => {
      if (t.id !== id) return t
      const next = { ...t, ...patch }
      if ('done' in patch) next.doneAt = patch.done ? now : undefined
      // A new time means a new reminder.
      if ('due' in patch) delete next.remindedAt
      if (next.due === undefined) delete next.due
      return next
    })
    await get().setSettings({ todos })
  },

  async removeTodo(id) {
    await get().setSettings({ todos: (get().settings.todos ?? []).filter((t) => t.id !== id) })
  },

  async markUnread(conversationId) {
    await updateRecord('markedUnread', (record) => {
      record[conversationId] = Date.now()
      return true
    })
  },

  async toggleUnread(conversationId) {
    const conversation = shownConversation(get(), conversationId)
    if (!conversation) return
    await (isUnread(conversation, get().settings.markedUnread) ? get().markRead(conversationId) : get().markUnread(conversationId))
  },

  async archive(conversationId) {
    const { selectedId, settings } = get()
    // As the list shows it: a merged person's newest message decides when it comes back.
    const conversation = shownConversation(get(), conversationId)
    if (!conversation) return
    const wasOpen = conversationId === selectedId
    const wasUnread = isUnread(conversation, settings.markedUnread)
    if (wasOpen) openNextAfter(conversationId)
    await updateRecord('archived', (record) => {
      record[conversationId] = archiveMark(conversation)
      return true
    })
    await get().markRead(conversationId)
    get().showToast(translate(settings.language, 'archivedToast', { name: conversation.title }), 'info', {
      label: translate(settings.language, 'undoAction'),
      run: () => {
        // Back as it was: in the inbox, and open again, or still unread to you if it was (the platform keeps
        // its "seen", which cannot be taken back).
        void get().unarchive(conversationId)
        if (wasOpen) get().select(conversationId)
        else if (wasUnread) void get().markUnread(conversationId)
      }
    })
  },

  async unarchive(conversationId) {
    await updateRecord('archived', (record) => delete record[conversationId])
  },

  async snooze(conversationId, until) {
    const { selectedId, settings } = get()
    const conversation = shownConversation(get(), conversationId)
    if (!conversation) return
    const wasOpen = conversationId === selectedId
    const before = settings.snoozed?.[conversationId]
    if (wasOpen) openNextAfter(conversationId)
    try {
      get().applySettings(await window.unison.later.snooze(conversationId, until))
    } catch (err) {
      get().showToast(cleanError(err), 'error')
      return
    }
    const lang = settings.language
    get().showToast(translate(lang, 'snoozedToast', { name: conversation.title, time: formatLaterTime(until, lang) }), 'info', {
      label: translate(lang, 'undoAction'),
      run: () => {
        // Back as it was: the earlier snooze if there was one, else in the inbox; and open again if it was.
        void (before ? window.unison.later.snooze(conversationId, before.until) : window.unison.later.unsnooze(conversationId)).then((next) => get().applySettings(next))
        if (wasOpen) get().select(conversationId)
      }
    })
  },

  async unsnooze(conversationId) {
    get().applySettings(await window.unison.later.unsnooze(conversationId))
  },

  async followUp(conversationId, until) {
    const conversation = shownConversation(get(), conversationId)
    if (!conversation) return
    const before = get().settings.followUps?.[conversationId]
    try {
      get().applySettings(await window.unison.later.follow(conversationId, until))
    } catch (err) {
      get().showToast(cleanError(err), 'error')
      return
    }
    const lang = get().settings.language
    get().showToast(translate(lang, 'followToast', { name: conversation.title, time: formatLaterTime(until, lang) }), 'info', {
      label: translate(lang, 'undoAction'),
      run: () => void (before ? window.unison.later.follow(conversationId, before.until) : window.unison.later.unfollow(conversationId)).then((next) => get().applySettings(next))
    })
  },

  async cancelFollowUp(conversationId) {
    get().applySettings(await window.unison.later.unfollow(conversationId))
  },

  openLaterPicker(laterPicker) {
    set({ laterPicker })
  },

  closeLaterPicker() {
    set({ laterPicker: undefined })
  },

  async acceptRequest(conversationId) {
    await updateRecord('acceptedRequests', (record) => {
      record[conversationId] = Date.now()
      return true
    })
    try {
      await window.unison.conversations.acceptRequest(conversationId)
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
    // Accepted while open: now they may see that you read it (opening it only read it privately, so the count
    // is already 0 here and the platform has not been told).
    if (onScreen(conversationId)) void window.unison.conversations.markRead(conversationId)
  },

  async mergeChats(conversationIds, name) {
    const { settings } = get()
    const index = memberIndex(settings.people)
    const people = { ...(settings.people ?? {}) }
    const personId = conversationIds.map((id) => index.get(id)).find((id): id is string => !!id) ?? `p-${crypto.randomUUID()}`
    const members: string[] = [...(people[personId]?.members ?? [])]
    for (const id of conversationIds) {
      const other = index.get(id)
      // Someone already merged elsewhere joins with all of their chats.
      const joining = other && other !== personId ? people[other].members : [id]
      if (other && other !== personId) delete people[other]
      for (const member of joining) if (!members.includes(member)) members.push(member)
    }
    if (members.length < 2) return
    people[personId] = { ...people[personId], members, ...(name?.trim() ? { name: name.trim() } : {}) }
    // The merged chat carries what its members had: every tag, and a pin if any was pinned.
    const anchor = members[0]
    const tags = { ...settings.tags }
    const union = [...new Set(members.flatMap((id) => settings.tags[id] ?? []))]
    if (union.length) tags[anchor] = union
    const pins = members.some((id) => isPinned(get().conversations[id], settings.pins)) ? { ...(settings.pins ?? {}), [anchor]: true } : settings.pins
    // And what any member had: muted, accepted as a request, marked unread, a nickname or photo.
    const muted = members.some((id) => settings.muted.conversations.includes(id)) && !settings.muted.conversations.includes(anchor)
      ? { ...settings.muted, conversations: [...settings.muted.conversations, anchor] }
      : settings.muted
    const firstOf = <T,>(record: Record<string, T> | undefined): T | undefined => members.map((id) => record?.[id]).find((v) => v !== undefined)
    const accepted = firstOf(settings.acceptedRequests)
    const marked = firstOf(settings.markedUnread)
    const override = settings.contactOverrides?.[anchor] ?? firstOf(settings.contactOverrides)
    await get().setSettings({
      people,
      tags,
      pins,
      muted,
      ...(accepted && !settings.acceptedRequests?.[anchor] ? { acceptedRequests: { ...settings.acceptedRequests, [anchor]: accepted } } : {}),
      ...(marked && !settings.markedUnread?.[anchor] ? { markedUnread: { ...settings.markedUnread, [anchor]: marked } } : {}),
      ...(override && !settings.contactOverrides?.[anchor] ? { contactOverrides: { ...settings.contactOverrides, [anchor]: override } } : {})
    })
    // Panes showing a member now show the person.
    const layout = get().layout
    const panes = layout.panes.map((id) => (id && members.includes(id) ? anchor : id))
    if (panes.some((id, i) => id !== layout.panes[i])) applyLayout(panes.length > 1 && panes[0] === panes[1] ? single(anchor) : { ...layout, panes })
    get().showToast(translate(settings.language, 'mergedToast', { name: people[personId].name ?? get().conversations[anchor]?.title ?? '' }))
  },

  async unmergeChat(conversationId) {
    const { settings } = get()
    const personId = memberIndex(settings.people).get(conversationId)
    if (!personId || !settings.people?.[personId]) return
    const people = { ...settings.people }
    const person = people[personId]
    const members = person.members.filter((id) => id !== conversationId)
    const patch: Partial<Settings> = {}
    if (members.length < 2) delete people[personId]
    else people[personId] = { ...person, members, via: person.via === conversationId ? undefined : person.via }
    // The anchor leaving: the next member takes over what the merged chat carried.
    if (person.members[0] === conversationId && members[0]) {
      const tags = settings.tags[conversationId]
      if (tags?.length) patch.tags = { ...settings.tags, [members[0]]: [...new Set([...(settings.tags[members[0]] ?? []), ...tags])] }
      if (settings.pins?.[conversationId]) patch.pins = { ...settings.pins, [members[0]]: true }
      if (settings.muted.conversations.includes(conversationId) && !settings.muted.conversations.includes(members[0])) {
        patch.muted = { ...settings.muted, conversations: [...settings.muted.conversations, members[0]] }
      }
      if (settings.acceptedRequests?.[conversationId]) patch.acceptedRequests = { ...settings.acceptedRequests, [members[0]]: settings.acceptedRequests[conversationId] }
    }
    await get().setSettings({ ...patch, people })
  },

  async dismissMerge(a, b) {
    await updateRecord('mergeDismissed', (record) => {
      record[pairKey(a, b)] = Date.now()
      return true
    })
  },

  pickSendVia(anchorId, memberId) {
    set({ sendPicks: { ...get().sendPicks, [anchorId]: { id: memberId, at: Date.now() } } })
  },

  async toggleMentionsOnly(conversationId) {
    await updateRecord('mentionsOnly', (record) => {
      if (record[conversationId]) delete record[conversationId]
      else record[conversationId] = true
      return true
    })
  },

  async markRead(conversationId) {
    await clearMarkedUnread([conversationId])
    // A merged person: each of its chats.
    const unread = (personFor(get(), conversationId)?.members ?? [conversationId]).filter((id) => get().conversations[id]?.unreadCount)
    try {
      await Promise.all(unread.map((id) => window.unison.conversations.markRead(id)))
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  async hideConversation(conversationId) {
    const { settings, conversations } = get()
    const muted = settings.muted.conversations.includes(conversationId) ? settings.muted.conversations : [...settings.muted.conversations, conversationId]
    await get().setSettings({ hidden: { ...(settings.hidden ?? {}), [conversationId]: Date.now() }, muted: { ...settings.muted, conversations: muted } })
    applyLayout(prune(get().layout, (id) => id !== conversationId))
    get().showToast(translate(settings.language, 'hiddenToast', { name: conversations[conversationId]?.title ?? '' }), 'info')
  },

  async unhideConversation(conversationId) {
    const { settings } = get()
    const hidden = { ...(settings.hidden ?? {}) }
    delete hidden[conversationId]
    await get().setSettings({ hidden, muted: { ...settings.muted, conversations: settings.muted.conversations.filter((id) => id !== conversationId) } })
  },

  async toggleMute(kind, id) {
    const current = get().settings.muted[kind] as string[]
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    await get().setSettings({ muted: { ...get().settings.muted, [kind]: next } })
  },

  async toggleSidebar() {
    await get().setSettings({ sidebarCollapsed: !get().settings.sidebarCollapsed })
  },

  setDetailsTab(tab) {
    set({ detailsTab: tab })
  },

  async loadProfile(conversationId, force) {
    if (!force && get().profiles[conversationId] !== undefined) return
    try {
      const profile = await window.unison.conversations.profile(conversationId)
      set({ profiles: { ...get().profiles, [conversationId]: profile ?? null } })
      // Remember a birthday the platform shared, so it can be remembered on the day without opening the chat.
      const known = get().settings.knownBirthdays
      if (profile?.birthday && parseBirthday(profile.birthday) && known?.[conversationId] !== profile.birthday) {
        void get().setSettings({ knownBirthdays: { ...known, [conversationId]: profile.birthday } })
      }
    } catch {
      set({ profiles: { ...get().profiles, [conversationId]: null } })
    }
  },

  async loadStats(conversationId, force) {
    if (!force && get().stats[conversationId]) return
    try {
      const stats = await window.unison.conversations.stats(conversationId)
      set({ stats: { ...get().stats, [conversationId]: stats } })
    } catch {
      /* keep whatever we have */
    }
  },

  async loadShared(conversationId, kind, force) {
    const key = `${conversationId}|${kind}`
    if (!force && get().shared[key]) return
    try {
      const members = personFor(get(), conversationId)?.members ?? [conversationId]
      const messages = (await Promise.all(members.map((id) => window.unison.conversations.shared(id, kind)))).flat().sort((a, b) => b.sentAt - a.sentAt)
      set({ shared: { ...get().shared, [key]: messages } })
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  async searchIn(conversationId, query) {
    try {
      const members = personFor(get(), conversationId)?.members ?? [conversationId]
      // As many results as a single chat gives (the newest), not that many per chat.
      return (await Promise.all(members.map((id) => window.unison.conversations.searchIn(id, query))))
        .flat()
        .sort((a, b) => b.sentAt - a.sentAt)
        .slice(0, IN_CHAT_RESULTS)
    } catch (err) {
      get().showToast(cleanError(err), 'error')
      return []
    }
  },

  async respondAuth(requestId, value) {
    await window.unison.auth.respond(requestId, value)
  },

  async cancelAuth(requestId) {
    await window.unison.auth.cancel(requestId)
  },

  async addAccount(input) {
    const account = await window.unison.accounts.add(input)
    set({ accounts: { ...get().accounts, [account.id]: account }, sheet: { kind: 'none' } })
  },

  async connectWeb(platform) {
    const account = await window.unison.accounts.connectWeb(platform)
    set({ accounts: { ...get().accounts, [account.id]: account }, sheet: { kind: 'none' } })
    get().showToast(translate(get().settings.language, 'connectedAs', { name: account.displayName }))
  },

  async addPages(pages, includeInstagram) {
    const accounts = await window.unison.accounts.addPages(pages, includeInstagram)
    const next = { ...get().accounts }
    for (const a of accounts) next[a.id] = a
    set({ accounts: next, sheet: { kind: 'none' } })
  },

  async openContact(contact) {
    try {
      const conversation = await window.unison.contacts.open(contact.accountId, contact.id)
      set({ conversations: { ...get().conversations, [conversation.id]: conversation } })
      get().select(conversation.id)
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  setNarrow(narrow) {
    if (get().narrow !== narrow) set({ narrow })
  },

  async removeAccount(accountId) {
    await window.unison.accounts.remove(accountId)
    // Main drops that account's tags, pins, nicknames and saved messages; pick up the cleaned settings.
    set({ settings: shareSettings(get().settings, await window.unison.settings.get()) })
  },

  async reconnect(accountId) {
    await window.unison.accounts.reconnect(accountId)
  },

  async addDemo() {
    const accounts = await window.unison.accounts.addDemo()
    const next = { ...get().accounts }
    for (const a of accounts) next[a.id] = a
    set({ accounts: next })
  },

  toggleDetails(tab) {
    const { detailsOpen, detailsTab } = get()
    if (tab && detailsOpen && tab !== detailsTab) {
      set({ detailsTab: tab })
      return
    }
    set({ detailsOpen: !detailsOpen, detailsTab: tab ?? detailsTab })
  },

  notifyTyping(conversationId) {
    if (!conversationId) return
    const now = Date.now()
    if (now - lastTypingSent < 4000) return
    lastTypingSent = now
    void window.unison.messages.typing(sendViaOf(get(), conversationId)).catch(() => undefined)
  },

  showToast(text, kind = 'info', action) {
    const id = ++toastCounter
    set({ toast: { id, text, kind, action } })
    // A toast with a button stays a little longer, so there is time to reach it.
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: undefined })
    }, action ? 6000 : 4000)
  },

  t(key, params) {
    return translate(get().settings.language, key, params)
  }
}))

// ---------------------------------------------------------------- one person across apps

/** What the person helpers read: the people record and the chats that exist. */
type PeopleState = { settings: Pick<Settings, 'people'>; conversations: Record<string, Conversation> }

let indexCache: { people?: Record<string, Person>; index: Map<string, string> } = { index: new Map() }

/** member chat id -> person id, worked out again only when the people record changes. */
export function peopleIndex(people: Record<string, Person> | undefined): Map<string, string> {
  if (indexCache.people !== people) indexCache = { people, index: memberIndex(people) }
  return indexCache.index
}

/**
 * The person a chat belongs to, with the member chats that exist right now (anchor first). With a single one
 * left (an account removed or signed out), the chat shows on its own again.
 */
export function personFor(state: PeopleState, conversationId: string): { id: string; person: Person; members: string[] } | undefined {
  return personIn(state.settings.people, state.conversations, conversationId)
}

export function personIn(
  people: Record<string, Person> | undefined,
  conversations: Record<string, Conversation>,
  conversationId: string
): { id: string; person: Person; members: string[] } | undefined {
  const personId = peopleIndex(people).get(conversationId)
  const person = personId ? people?.[personId] : undefined
  if (!personId || !person) return undefined
  const members = person.members.filter((id) => conversations[id])
  return members.length > 1 ? { id: personId, person, members } : undefined
}

/** The chat a conversation is shown and opened as: its person's first member, or itself. */
export function anchorFor(state: PeopleState, conversationId: string): string {
  return personFor(state, conversationId)?.members[0] ?? conversationId
}

let foldCache: { conversations?: Record<string, Conversation>; people?: Record<string, Person>; folded: Record<string, Conversation> } = { folded: {} }

/** The chats as the app shows them: a merged person as one chat under the anchor's id, the others folded in. */
export function foldPeople(conversations: Record<string, Conversation>, people: Record<string, Person> | undefined): Record<string, Conversation> {
  if (foldCache.conversations === conversations && foldCache.people === people) return foldCache.folded
  let folded = conversations
  for (const person of Object.values(people ?? {})) {
    const members = person.members.map((id) => conversations[id]).filter((c): c is Conversation => !!c)
    if (members.length < 2) continue
    if (folded === conversations) folded = { ...conversations }
    for (const member of members.slice(1)) delete folded[member.id]
    folded[members[0].id] = mergeConversation(person, members)
  }
  foldCache = { conversations, people, folded }
  return folded
}

/** A chat as the app shows it (a merged person's anchor id gives the merged chat). */
export function shownConversation(state: Pick<State, 'settings' | 'conversations'>, conversationId: string): Conversation | undefined {
  return foldPeople(state.conversations, state.settings.people)[conversationId] ?? state.conversations[conversationId]
}

export function useShownConversations(): Record<string, Conversation> {
  const conversations = useStore((s) => s.conversations)
  const people = useStore((s) => s.settings.people)
  return foldPeople(conversations, people)
}

export interface ThreadView {
  messages?: Message[]
  hasMore: boolean
  loading: boolean
}

/** A chat's messages; for a merged person, every member's in one timeline (see mergeTimeline). */
export function threadOf(state: Pick<State, 'settings' | 'conversations' | 'messages' | 'hasMore' | 'loading'>, conversationId: string): ThreadView {
  const person = personFor(state, conversationId)
  if (!person) return { messages: state.messages[conversationId], hasMore: !!state.hasMore[conversationId], loading: !!state.loading[conversationId] }
  const loading = person.members.some((id) => state.loading[id])
  const parts = person.members.map((id) => ({ messages: state.messages[id], hasMore: !!state.hasMore[id] }))
  if (parts.every((part) => !part.messages)) return { messages: undefined, hasMore: false, loading }
  const merged = mergeTimeline(parts)
  return { messages: merged.messages, hasMore: merged.hasMore, loading }
}

export function useThread(conversationId: string): ThreadView {
  const merged = useStore((s) => !!personFor(s, conversationId))
  // A plain chat listens to its own messages only; a merged one to all of them (rarely more than one open).
  const messages = useStore((s) => (merged ? s.messages : s.messages[conversationId]))
  const hasMore = useStore((s) => (merged ? s.hasMore : s.hasMore[conversationId]))
  const loading = useStore((s) => (merged ? s.loading : s.loading[conversationId]))
  const settings = useStore((s) => s.settings)
  const conversations = useStore((s) => s.conversations)
  return useMemo(
    () => threadOf(useStore.getState(), conversationId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the slices above are what the thread reads
    [conversationId, merged, messages, hasMore, loading, settings.people, conversations]
  )
}

/**
 * Which member chat a merged chat's composer writes to: where they last wrote to you, unless an app was picked
 * by hand or a message from one app is being quoted (see pickSendVia). A plain chat writes to itself.
 */
export function sendViaOf(state: Pick<State, 'settings' | 'conversations' | 'messages' | 'sendPicks' | 'replyTos'>, conversationId: string): string {
  const person = personFor(state, conversationId)
  if (!person) return conversationId
  const lastIncoming: Record<string, number | undefined> = {}
  for (const id of person.members) {
    const list = state.messages[id] ?? []
    let loaded: number | undefined
    for (let i = list.length - 1; i >= 0 && loaded === undefined; i--) if (!list[i].isOutgoing && !list[i].system) loaded = list[i].sentAt
    const preview = state.conversations[id]?.lastMessage
    lastIncoming[id] = Math.max(loaded ?? 0, preview && !preview.isOutgoing ? preview.sentAt : 0) || undefined
  }
  return chooseSendVia({
    members: person.members,
    lastIncoming,
    picked: state.sendPicks[conversationId],
    replyTo: state.replyTos[conversationId]?.conversationId,
    via: person.person.via
  })
}

export function useSendVia(conversationId: string): string {
  const merged = useStore((s) => !!personFor(s, conversationId))
  const messages = useStore((s) => (merged ? s.messages : undefined))
  const picks = useStore((s) => s.sendPicks[conversationId])
  const replyTo = useStore((s) => s.replyTos[conversationId])
  const conversations = useStore((s) => s.conversations)
  const people = useStore((s) => s.settings.people)
  return useMemo(
    () => sendViaOf(useStore.getState(), conversationId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the slices above are what the choice reads
    [conversationId, merged, messages, picks, replyTo, conversations, people]
  )
}

/**
 * A chat's first page is in and nothing is loading for it (opening a merged person starts its members loading
 * in the background; a jump into one must wait for that rather than give up). At most about five seconds.
 */
async function settled(conversationId: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const s = useStore.getState()
    if (!s.messages[conversationId] && !s.loading[conversationId]) await s.prefetch(conversationId, false)
    if (s.messages[conversationId] && !s.loading[conversationId]) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** One more page of a chat's history, older than what is loaded. */
async function loadOlder(conversationId: string): Promise<void> {
  const state = useStore.getState()
  const list = state.messages[conversationId]
  if (!list?.length || state.loading[conversationId] || !state.hasMore[conversationId]) return
  useStore.setState({ loading: { ...state.loading, [conversationId]: true } })
  try {
    const older = await window.unison.messages.list(conversationId, list[0].id)
    const s = useStore.getState()
    const known = new Set((s.messages[conversationId] ?? []).map((m) => m.id))
    const merged = [...older.filter((m) => !known.has(m.id)), ...(s.messages[conversationId] ?? [])]
    useStore.setState({
      messages: { ...s.messages, [conversationId]: merged },
      hasMore: { ...s.hasMore, [conversationId]: older.filter((m) => !known.has(m.id)).length > 0 },
      loading: { ...s.loading, [conversationId]: false }
    })
  } catch (err) {
    useStore.setState({ loading: { ...useStore.getState().loading, [conversationId]: false } })
    useStore.getState().showToast((err as Error).message, 'error')
  }
}

/** Per-chat records changed from the list, often several in a row (a key held down, a split opening two chats). */
type ChatRecords = Required<Pick<Settings, 'markedUnread' | 'archived' | 'mentionsOnly' | 'acceptedRequests' | 'mergeDismissed'>>

let recordWrites = Promise.resolve()

/**
 * Change a per-chat record one change at a time: each reads what the previous one wrote, so quick changes in a
 * row (or two chats cleared together) cannot undo each other. `change` edits the copy and says if it changed.
 */
function updateRecord<K extends keyof ChatRecords>(key: K, change: (record: ChatRecords[K]) => boolean): Promise<void> {
  recordWrites = recordWrites
    .then(async () => {
      const { settings, setSettings } = useStore.getState()
      const record = { ...(settings[key] ?? {}) } as ChatRecords[K]
      if (change(record)) await setSettings({ [key]: record })
    })
    .catch(() => undefined)
  return recordWrites
}

/** Opening a chat, or marking it read, answers "come back to this". */
function clearMarkedUnread(ids: string[]): Promise<void> {
  if (!ids.length) return Promise.resolve()
  return updateRecord('markedUnread', (record) => {
    const before = Object.keys(record).length
    for (const id of ids) delete record[id]
    return Object.keys(record).length !== before
  })
}

/**
 * Put a pane layout into effect: mirror the active chat into `selectedId`, close sheets, reset the
 * details tab when the active chat changed, mark newly shown chats read, load them and remember them.
 */
function applyLayout(layout: PaneLayout, options: { focus?: boolean } = {}): void {
  const state = useStore.getState()
  const before = state.layout
  const previousActive = state.selectedId
  const nextActive = activeId(layout)
  const shownBefore = new Set(openIds(before))
  const patch: Partial<State> = { layout, selectedId: nextActive, sheet: { kind: 'none' } }
  if (nextActive !== previousActive) patch.detailsTab = 'info'
  if (nextActive) {
    patch.recent = pushRecent(state.recent, nextActive)
    if (options.focus) patch.composerFocus = { conversationId: nextActive, nonce: Date.now() }
  }
  useStore.setState(patch)
  saveLayout(layout)
  // Only a chat you actually open answers its unread mark: not one that stays active while the layout changes
  // around it (hiding another chat, closing the other pane).
  void clearMarkedUnread(openIds(layout).filter((id) => !shownBefore.has(id) || (id === nextActive && id !== previousActive)))
  // Opening a chat that came back from a snooze, or whose follow-up fired, settles it.
  if (nextActive && nextActive !== previousActive) {
    const now = Date.now()
    const { snoozed, followUps } = state.settings
    if (isWoken(snoozed?.[nextActive], now) || followState(followUps?.[nextActive], now) === 'due') {
      void window.unison.later.seen(nextActive).then((settings) => useStore.getState().applySettings(settings))
    }
  }
  for (const id of openIds(layout)) {
    if (shownBefore.has(id) && id !== nextActive) continue
    // A merged person: read and load each of its chats.
    for (const member of personFor(state, id)?.members ?? [id]) {
      if (state.conversations[member]?.unreadCount) void window.unison.conversations.markRead(member)
      void useStore.getState().prefetch(member, false)
    }
  }
  evictThreads()
}

/**
 * Loaded threads kept besides the open ones: the most recently opened reopen at once, older ones (and chats only
 * hovered) are let go and load again from the main process's cache when opened. Without this, every chat opened or
 * hovered during the day stayed in memory, with its photos' previews.
 */
const KEEP_THREADS = 20
function evictThreads(): void {
  const s = useStore.getState()
  const loaded = Object.keys(s.messages)
  if (loaded.length <= KEEP_THREADS) return
  const keep = new Set<string>()
  const add = (id: string): void => {
    for (const member of personFor(s, id)?.members ?? [id]) keep.add(member)
  }
  for (const id of openIds(s.layout)) add(id)
  for (const id of s.recent) {
    if (keep.size >= KEEP_THREADS) break
    add(id)
  }
  // Never a chat still loading, or with a message on its way (the send would come back to an emptied thread).
  const drop = loaded.filter((id) => !keep.has(id) && !s.loading[id] && !s.messages[id]?.some((m) => m.status === 'sending'))
  if (!drop.length) return
  const messages = { ...s.messages }
  const hasMore = { ...s.hasMore }
  for (const id of drop) {
    delete messages[id]
    delete hasMore[id]
  }
  useStore.setState({ messages, hasMore })
}

// ---------------------------------------------------------------- nicknames & custom photos

/** Image for a custom avatar value (uploaded data URL, or one of the logo characters). */
export function customAvatarUrl(value?: string): string | undefined {
  if (!value) return undefined
  if (value.startsWith('data:image/')) return value
  if (value.startsWith('abstract:')) return abstractIdUrl(value)
  if (value.startsWith('logo:')) {
    const id = value.slice(5) as LogoId
    if (LOGO_ORDER.includes(id)) return `data:image/svg+xml;utf8,${encodeURIComponent(logoIconSvg(id, true))}`
  }
  return undefined
}

/** Colours of a per-chat bubble choice (preset or custom accent id); undefined = follow the app accent. */
export function bubbleSpecOf(id: string | undefined, customAccents?: CustomAccent[]): AccentSpec | undefined {
  if (!id) return undefined
  const preset = ACCENTS.find((a) => a.id === id)
  if (preset) return preset.flat ? { from: preset.from } : { from: preset.from, to: preset.to }
  const custom = customAccents?.find((a) => a.id === id)
  return custom ? { from: custom.from, to: custom.to } : undefined
}

/** CSS variables that recolour outgoing bubbles for one chat. */
export function bubbleVarsOf(id: string | undefined, customAccents?: CustomAccent[]): React.CSSProperties | undefined {
  const spec = bubbleSpecOf(id, customAccents)
  if (!spec) return undefined
  const v = accentVars(spec)
  return {
    '--bubble-out': v['--bubble-out'],
    '--bubble-out-solid': v['--bubble-out-solid'],
    '--bubble-out-text': v['--bubble-out-text'],
    '--bubble-out-shadow': v['--bubble-out-shadow'],
    '--bubble-out-ring': v['--bubble-out-ring']
  } as React.CSSProperties
}

const decorated = new WeakSet<Conversation>()

/** The conversation as shown: nickname and custom photo on top of the platform's own. */
function withOverride(c: Conversation, override?: ContactOverride): Conversation {
  const baseTitle = c.originalTitle ?? c.title
  const baseAvatar = 'originalAvatarUrl' in c ? c.originalAvatarUrl : c.avatarUrl
  const nickname = override?.nickname?.trim()
  const avatar = customAvatarUrl(override?.avatar)
  if (!nickname && !avatar) {
    if (c.originalTitle === undefined && !('originalAvatarUrl' in c)) return c
    const { originalTitle: _t, originalAvatarUrl: _a, ...rest } = c
    return { ...rest, title: baseTitle, avatarUrl: baseAvatar }
  }
  return { ...c, title: nickname || baseTitle, avatarUrl: avatar ?? baseAvatar, originalTitle: baseTitle, originalAvatarUrl: baseAvatar }
}

// Every conversation that enters the store (and every change of overrides) is decorated once.
useStore.subscribe((state, prev) => {
  const overrides = state.settings.contactOverrides
  const overridesChanged = overrides !== prev.settings.contactOverrides
  if (state.conversations === prev.conversations && !overridesChanged) return
  let changed = false
  const next: Record<string, Conversation> = { ...state.conversations }
  for (const [id, c] of Object.entries(state.conversations)) {
    if (!overridesChanged && decorated.has(c)) continue
    const shown = withOverride(c, overrides?.[id])
    decorated.add(shown)
    if (shown !== c) {
      next[id] = shown
      changed = true
    }
  }
  if (changed) useStore.setState({ conversations: next })
})

/** Whether a chat sits in the archive right now (archived, and not brought back by a new message). */
export function isArchivedNow(state: Pick<State, 'settings' | 'conversations'>, conversationId: string): boolean {
  const conversation = state.conversations[conversationId]
  return !!conversation && isArchived(conversation, state.settings.archived?.[conversationId], isChatMuted(state.settings, conversation))
}

// A chat that came back from the archive drops its mark, so muting it later does not quietly send it back.
useStore.subscribe((state, prev) => {
  const marks = state.settings.archived
  if (!marks || (state.conversations === prev.conversations && marks === prev.settings.archived)) return
  const back = Object.keys(marks).filter((id) => {
    const c = state.conversations[id]
    return c && !isChatMuted(state.settings, c) && hasReturned(c, marks[id])
  })
  if (!back.length) return
  void updateRecord('archived', (record) => {
    const stale = back.filter((id) => id in record)
    for (const id of stale) delete record[id]
    return stale.length > 0
  })
})

export interface ChatList {
  /** What the list shows: sidebar filter, then search, the archive or the quick filter; pinned first then most recent. */
  conversations: Conversation[]
  /** How many inbox chats each quick filter holds within the sidebar filter. */
  counts: Record<QuickFilter, number>
  /** Archived chats within the sidebar filter. */
  archivedCount: number
  /** Message requests waiting within the sidebar filter. */
  requestCount: number
  /** Snoozed chats within the sidebar filter. */
  snoozedCount: number
}

/** Rows the list shows right now, top to bottom (what "archive and open the next one" walks). */
let listedIds: string[] = []

/** Leaving a chat (archived, snoozed): open the next one down the list, or the one above at the bottom. */
function openNextAfter(conversationId: string): void {
  const { layout } = useStore.getState()
  const open = new Set(openIds(layout))
  const at = listedIds.indexOf(conversationId)
  const next = at < 0 ? undefined : [...listedIds.slice(at + 1), ...listedIds.slice(0, at).reverse()].find((id) => !open.has(id))
  if (next) useStore.getState().select(next)
  else if (layout.panes.length > 1) useStore.getState().closePane(layout.active)
  else useStore.getState().select(undefined)
}
/**
 * Rows last listed under a chip, and which chip (with the sidebar filter): a chat only stays put under the chip
 * it was listed under. Searching or visiting the archive leaves this alone, so coming back finds it as it was.
 */
let chipListed: { key: string; ids: ReadonlySet<string> } = { key: '', ids: new Set() }

/**
 * The chat list. Archived chats and message requests wait in their own views; a search looks everywhere and past
 * the quick filter, so it never misses a chat because a chip was left on.
 */
export function useChatList(): ChatList {
  const conversations = useShownConversations()
  const filter = useStore((s) => s.filter)
  const quickFilter = useStore((s) => s.quickFilter)
  const listView = useStore((s) => s.listView)
  const search = useStore((s) => s.search)
  const tags = useStore((s) => s.settings.tags)
  const pins = useStore((s) => s.settings.pins)
  const hidden = useStore((s) => s.settings.hidden)
  const muted = useStore((s) => s.settings.muted)
  const markedUnread = useStore((s) => s.settings.markedUnread)
  const archived = useStore((s) => s.settings.archived)
  const accepted = useStore((s) => s.settings.acceptedRequests)
  const snoozed = useStore((s) => s.settings.snoozed)
  const followUps = useStore((s) => s.settings.followUps)
  const drafts = useStore((s) => s.drafts)
  const layout = useStore((s) => s.layout)
  const searching = search.trim().length > 0
  const scoped = useMemo(() => computeVisible(conversations, filter, search, tags, pins, hidden), [conversations, filter, search, tags, pins, hidden])
  // `now` is read again whenever the chats change, which is often enough for a 30-day window.
  const ctx = useMemo<QuickFilterContext>(
    () => ({ now: Date.now(), drafts, markedUnread, isMuted: (c) => isChatMuted({ muted, tags }, c) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `conversations` is there to refresh `now`
    [drafts, markedUnread, muted, tags, conversations]
  )
  const [inbox, archive, requests, later] = useMemo(() => {
    const inbox: Conversation[] = []
    const archive: Conversation[] = []
    const requests: Conversation[] = []
    const later: Conversation[] = []
    const back: Conversation[] = []
    for (const c of scoped) {
      if (isPendingRequest(c, accepted)) requests.push(c)
      else if (isSnoozed(snoozed?.[c.id], ctx.now)) later.push(c)
      // Back from a snooze or waiting on a reply: at the top of the inbox (under pins), even if it was archived.
      else if (isWoken(snoozed?.[c.id], ctx.now) || followState(followUps?.[c.id], ctx.now) === 'due') back.push(c)
      else if (isArchived(c, archived?.[c.id], ctx.isMuted(c))) archive.push(c)
      else inbox.push(c)
    }
    const pinnedCount = inbox.findIndex((c) => !isPinned(c, pins))
    const at = pinnedCount < 0 ? inbox.length : pinnedCount
    inbox.splice(at, 0, ...back.filter((c) => !isPinned(c, pins)))
    inbox.unshift(...back.filter((c) => isPinned(c, pins)))
    // Soonest back first.
    later.sort((a, b) => (snoozed?.[a.id]?.until ?? 0) - (snoozed?.[b.id]?.until ?? 0))
    return [inbox, archive, requests, later]
  }, [scoped, archived, accepted, ctx, snoozed, followUps, pins])
  const counts = useMemo(() => countQuickFilters(searching ? [] : inbox, ctx), [inbox, ctx, searching])
  const shown = useMemo(() => {
    if (searching) return scoped
    if (listView === 'archive') return archive
    if (listView === 'requests') return requests
    if (listView === 'snoozed') return later
    // An open chat that stops matching the chip stays put, but only if it was already listed under it: one that
    // never matched does not appear under a chip it has nothing to do with.
    const key = `${filter}|${quickFilter}`
    const before = chipListed.key === key ? chipListed.ids : new Set<string>()
    const keep = new Set(openIds(layout).filter((id) => before.has(id)))
    const list = applyQuickFilter(inbox, quickFilter, ctx, keep)
    chipListed = { key, ids: new Set(list.map((c) => c.id)) }
    return list
  }, [searching, scoped, listView, archive, requests, later, inbox, filter, quickFilter, ctx, layout])
  listedIds = shown.map((c) => c.id)
  return { conversations: shown, counts, archivedCount: archive.length, requestCount: requests.length, snoozedCount: later.length }
}

/** Pinned in Moshi, or on the platform when Moshi has no say. */
export function isPinned(conversation: Pick<Conversation, 'id' | 'pinned'> | undefined, pins?: Record<string, boolean>): boolean {
  if (!conversation) return false
  return pins?.[conversation.id] ?? !!conversation.pinned
}

/** The user's tags, with a lookup by id. Stable while settings.tagDefs is unchanged. */
export function useTagDefs(): { list: TagMeta[]; byId: Record<string, TagMeta> } {
  const defs = useStore((s) => s.settings.tagDefs)
  return useMemo(() => {
    const list = tagDefsOf({ tagDefs: defs })
    return { list, byId: Object.fromEntries(list.map((t) => [t.id, t])) }
  }, [defs])
}

export function computeVisible(
  conversations: Record<string, Conversation>,
  filter: Filter,
  search: string,
  tags: Record<string, TagId[]> = {},
  pins?: Record<string, boolean>,
  hidden?: Record<string, number>
): Conversation[] {
  const query = search.trim().toLowerCase()
  return Object.values(conversations)
    .filter((c) => !hidden?.[c.id])
    .filter((c) => {
      if (filter === 'all') return true
      if (filter.startsWith('account:')) return c.accountId === filter.slice(8)
      if (filter.startsWith('tag:')) return (tags[c.id] ?? []).includes(filter.slice(4) as TagId)
      return c.platform === filter
    })
    .filter((c) => {
      if (!query) return true
      return (
        c.title.toLowerCase().includes(query) ||
        (c.originalTitle?.toLowerCase().includes(query) ?? false) ||
        c.participants.some((p) => p.name.toLowerCase().includes(query) || p.handle?.toLowerCase().includes(query))
      )
    })
    .sort((a, b) => Number(isPinned(b, pins)) - Number(isPinned(a, pins)) || b.updatedAt - a.updatedAt)
}

/** Whether avatars should carry the platform badge: only when several platforms are mixed in the list. */
export function useShowPlatformBadge(): boolean {
  const filter = useStore((s) => s.filter)
  return filter === 'all' || filter.startsWith('tag:')
}

export interface UnreadCounts {
  total: number
  byPlatform: Record<Platform, number>
  byAccount: Record<string, number>
  byTag: Record<string, number>
}

export function useUnreadCounts(): UnreadCounts {
  const conversations = useStore((s) => s.conversations)
  const tags = useStore((s) => s.settings.tags)
  const muted = useStore((s) => s.settings.muted)
  const markedUnread = useStore((s) => s.settings.markedUnread)
  const mentionsOnly = useStore((s) => s.settings.mentionsOnly)
  const accepted = useStore((s) => s.settings.acceptedRequests)
  const people = useStore((s) => s.settings.people)
  return useMemo(
    () => computeUnread(conversations, tags, muted, markedUnread, mentionsOnly, accepted, people),
    [conversations, tags, muted, markedUnread, mentionsOnly, accepted, people]
  )
}

function computeUnread(
  conversations: Record<string, Conversation>,
  tags: Record<string, TagId[]>,
  muted?: MuteRules,
  markedUnread?: Record<string, number>,
  mentionsOnly?: Record<string, boolean>,
  accepted?: Record<string, number>,
  people?: Record<string, Person>
): UnreadCounts {
  // Settings of a merged person live under its anchor's id; so does whether it is still a request.
  const shownAs = (id: string): string => personIn(people, conversations, id)?.members[0] ?? id
  const folded = foldPeople(conversations, people)
  const byPlatform: Record<Platform, number> = { messenger: 0, instagram: 0, telegram: 0, zalo: 0, whatsapp: 0 }
  const byAccount: Record<string, number> = {}
  const byTag: Record<string, number> = {}
  let total = 0
  for (const c of Object.values(conversations)) {
    const key = shownAs(c.id)
    // A chat marked unread by hand counts as one, like a single new message (once for a merged person).
    const unread = c.unreadCount || (key === c.id && markedUnread?.[key] ? 1 : 0)
    // Muted and mentions-only chats keep their own count in the list but stay out of the badges.
    // Message requests wait silently too, until accepted.
    if (!unread || c.muted || mentionsOnly?.[key] || isPendingRequest(key === c.id ? c : (folded[key] ?? c), accepted)) continue
    if (muted && isMutedBy({ muted, tags }, { ...c, id: key })) continue
    total += unread
    byPlatform[c.platform] += unread
    byAccount[c.accountId] = (byAccount[c.accountId] ?? 0) + unread
    for (const tag of tags[key] ?? []) byTag[tag] = (byTag[tag] ?? 0) + unread
  }
  return { total, byPlatform, byAccount, byTag }
}

export function useT(): (key: TKey, params?: Record<string, string | number>) => string {
  const language = useStore((s) => s.settings.language)
  return useMemo(() => (key, params) => translate(language, key, params), [language])
}
