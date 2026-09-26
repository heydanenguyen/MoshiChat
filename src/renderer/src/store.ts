import { useMemo } from 'react'
import { create } from 'zustand'
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
  GifItem
} from '@shared/types'
import { ACCENTS, DEFAULT_SETTINGS, isMutedBy, tagDefsOf, type MuteRules } from '@shared/types'
import { translate, type TKey } from './i18n'
import { LOGO_ORDER, logoIconSvg, type LogoId } from '@shared/logos'
import { accentVars, type AccentSpec } from '@shared/accent'
import { previewKindOf } from '@shared/preview'

export type Filter = 'all' | Platform | `account:${string}` | `tag:${string}`

export type Sheet =
  | { kind: 'none' }
  | { kind: 'settings' }
  | { kind: 'add-account'; platform?: Platform }
  | { kind: 'command' }
  | { kind: 'new-chat' }

export type DetailsTab = 'info' | 'moments' | 'search' | 'media' | 'links' | 'files'

export interface Toast {
  id: number
  text: string
  kind: 'error' | 'info'
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
  selectedId?: string
  highlightId?: string
  filter: Filter
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
  replyTo?: Message
  pendingFiles: OutgoingAttachment[]
  forwarding?: Message
  lightbox?: Lightbox
  /** Window narrower than a phone-ish breakpoint: list and chat stack. */
  narrow: boolean

  init(): Promise<void>
  select(id?: string, highlightId?: string): void
  setFilter(filter: Filter): void
  setSearch(search: string): void
  openHit(hit: SearchHit): void
  /** Scroll to a message in the open thread, loading older pages until it appears. */
  jumpTo(messageId: string, maxPages?: number): Promise<void>
  toggleSaved(message: Message): Promise<void>
  openSaved(saved: SavedMessage): Promise<void>
  /** `resolveFiles` prepares the real files after the optimistic bubble is shown (GIF downloads). */
  send(text: string, files?: OutgoingAttachment[], resolveFiles?: () => Promise<OutgoingAttachment[]>): Promise<void>
  sendGif(item: GifItem): Promise<void>
  react(messageId: string, emoji: string): Promise<void>
  setReplyTo(message?: Message): void
  startForward(message?: Message): void
  forward(toConversationId: string): Promise<void>
  loadAttachment(conversationId: string, messageId: string, attachmentId: string): Promise<string | undefined>
  openAttachment(conversationId: string, messageId: string, attachmentId: string): Promise<void>
  openLightbox(lightbox?: Lightbox): void
  addFiles(files: OutgoingAttachment[]): void
  addDroppedFiles(files: File[]): void
  removeFile(path: string): void
  loadMore(conversationId: string): Promise<void>
  openSheet(sheet: Sheet): void
  closeSheet(): void
  setSettings(patch: Partial<Settings>): Promise<void>
  toggleTag(conversationId: string, tag: TagId): Promise<void>
  createTag(input: { name: string; icon: string; color: string; fill?: string }): Promise<TagMeta>
  deleteTag(tag: TagId): Promise<void>
  togglePin(conversationId: string): Promise<void>
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
  notifyTyping(): void
  showToast(text: string, kind?: Toast['kind']): void
  t(key: TKey, params?: Record<string, string | number>): string
}

const PAGE = 50
let toastCounter = 0
let lastTypingSent = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

const cleanError = (err: unknown): string =>
  (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')

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

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  accounts: {},
  conversations: {},
  messages: {},
  loading: {},
  hasMore: {},
  typing: {},
  filter: 'all',
  search: '',
  searchHits: [],
  authPrompts: [],
  sheet: { kind: 'none' },
  detailsOpen: false,
  detailsTab: 'info',
  profiles: {},
  stats: {},
  shared: {},
  pendingFiles: [],
  narrow: false,

  async init() {
    const bridge = window.unison
    const [settings, accounts, conversations] = await Promise.all([
      bridge.settings.get(),
      bridge.accounts.list(),
      bridge.conversations.list()
    ])
    set({
      ready: true,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      accounts: Object.fromEntries(accounts.map((a) => [a.id, a])),
      conversations: Object.fromEntries(conversations.map((c) => [c.id, c]))
    })

    bridge.onEvent((event: BridgeEvent) => {
      const state = get()
      switch (event.type) {
        case 'account:updated':
          set({ accounts: { ...state.accounts, [event.account.id]: event.account } })
          break
        case 'account:removed': {
          const accounts = { ...state.accounts }
          delete accounts[event.accountId]
          const conversations = Object.fromEntries(
            Object.entries(state.conversations).filter(([, c]) => c.accountId !== event.accountId)
          )
          const selectedId = state.selectedId && conversations[state.selectedId] ? state.selectedId : undefined
          set({ accounts, conversations, selectedId })
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
          const list = upsertMessage(state.messages[event.message.conversationId], event.message)
          const shared = { ...state.shared }
          for (const key of Object.keys(shared)) if (key.startsWith(event.message.conversationId + '|')) delete shared[key]
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
          if (state.selectedId === event.message.conversationId && document.hasFocus() && !event.message.isOutgoing) {
            void bridge.conversations.markRead(event.message.conversationId)
          }
          break
        }
        case 'message:updated': {
          const list = upsertMessage(state.messages[event.message.conversationId], event.message)
          if (list) set({ messages: { ...state.messages, [event.message.conversationId]: list } })
          break
        }
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
          break
      }
    })
  },

  select(id, highlightId) {
    const state = get()
    set({ selectedId: id, highlightId, sheet: { kind: 'none' }, replyTo: undefined, pendingFiles: [], detailsTab: 'info' })
    if (!id) return
    const conversation = state.conversations[id]
    if (conversation?.unreadCount) void window.unison.conversations.markRead(id)
    if (!state.messages[id] && !state.loading[id]) {
      set({ loading: { ...state.loading, [id]: true } })
      window.unison.messages
        .list(id)
        .then((messages) => {
          const s = get()
          set({
            messages: { ...s.messages, [id]: messages },
            hasMore: { ...s.hasMore, [id]: messages.length > 0 },
            loading: { ...s.loading, [id]: false }
          })
        })
        .catch((err: Error) => {
          set({ loading: { ...get().loading, [id]: false } })
          get().showToast(err.message, 'error')
        })
    }
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
    if (get().selectedId !== saved.conversationId) get().select(saved.conversationId)
    // Wait for the first page, then walk back until the message is loaded and highlight it.
    for (let i = 0; i < 50 && !get().messages[saved.conversationId]; i++) await new Promise((r) => setTimeout(r, 100))
    await get().jumpTo(saved.messageId, 40)
  },

  async jumpTo(messageId, maxPages = 8) {
    const id = get().selectedId
    if (!id) return
    for (let page = 0; page < maxPages; page++) {
      const list = get().messages[id] ?? []
      if (list.some((m) => m.id === messageId)) break
      if (!get().hasMore[id]) break
      await get().loadMore(id)
    }
    // Re-trigger the highlight even when the same message is chosen twice.
    set({ highlightId: undefined })
    setTimeout(() => set({ highlightId: messageId }), 0)
  },

  async send(text, files, resolveFiles) {
    const { selectedId, messages, settings, replyTo } = get()
    const pendingFiles = files ?? get().pendingFiles
    const trimmed = text.trim()
    if (!selectedId || (!trimmed && !pendingFiles.length)) return
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
    set({
      messages: { ...messages, [selectedId]: [...(messages[selectedId] ?? []), optimistic] },
      replyTo: undefined,
      pendingFiles: files ? get().pendingFiles : []
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
        if (pendingFiles[i]?.sticker && attachment.kind === 'image') {
          attachment.kind = 'sticker'
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
    } catch (err) {
      const s = get()
      const failed = { ...optimistic, status: 'failed' as const }
      set({ messages: { ...s.messages, [selectedId]: upsertMessage(s.messages[selectedId], failed) ?? [] } })
      get().showToast(cleanError(err), 'error')
    }
  },

  async sendGif(item) {
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
    await get().send('', [placeholder], async () => [await window.unison.app.gif(item)])
  },

  async react(messageId, emoji) {
    const { selectedId } = get()
    if (!selectedId) return
    try {
      await window.unison.messages.react(selectedId, messageId, emoji)
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  setReplyTo(message) {
    set({ replyTo: message })
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

  addFiles(files) {
    const existing = new Set(get().pendingFiles.map((f) => f.path))
    set({ pendingFiles: [...get().pendingFiles, ...files.filter((f) => !existing.has(f.path))] })
  },

  addDroppedFiles(files) {
    for (const file of files) {
      const described = window.unison.app.describeFile(file)
      if (!described.path) continue
      if (file.type.startsWith('image/') && file.size < 3_000_000) {
        const reader = new FileReader()
        reader.onload = () => get().addFiles([{ ...described, preview: String(reader.result) }])
        reader.readAsDataURL(file)
      } else {
        get().addFiles([described])
      }
    }
  },

  removeFile(path) {
    set({ pendingFiles: get().pendingFiles.filter((f) => f.path !== path) })
  },

  async loadMore(conversationId) {
    const state = get()
    const list = state.messages[conversationId]
    if (!list?.length || state.loading[conversationId] || !state.hasMore[conversationId]) return
    set({ loading: { ...state.loading, [conversationId]: true } })
    try {
      const older = await window.unison.messages.list(conversationId, list[0].id)
      const s = get()
      const known = new Set((s.messages[conversationId] ?? []).map((m) => m.id))
      const merged = [...older.filter((m) => !known.has(m.id)), ...(s.messages[conversationId] ?? [])]
      set({
        messages: { ...s.messages, [conversationId]: merged },
        hasMore: { ...s.hasMore, [conversationId]: older.filter((m) => !known.has(m.id)).length > 0 },
        loading: { ...s.loading, [conversationId]: false }
      })
    } catch (err) {
      set({ loading: { ...get().loading, [conversationId]: false } })
      get().showToast((err as Error).message, 'error')
    }
  },

  openSheet(sheet) {
    set({ sheet })
  },

  closeSheet() {
    set({ sheet: { kind: 'none' }, forwarding: undefined, lightbox: undefined })
  },

  async setSettings(patch) {
    const settings = await window.unison.settings.set(patch)
    set({ settings: { ...DEFAULT_SETTINGS, ...settings } })
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
    if (Object.keys(clean).length) overrides[conversationId] = clean
    else delete overrides[conversationId]
    await get().setSettings({ contactOverrides: overrides })
  },

  async togglePin(conversationId) {
    const { settings, conversations } = get()
    const pinned = isPinned(conversations[conversationId], settings.pins)
    await get().setSettings({ pins: { ...(settings.pins ?? {}), [conversationId]: !pinned } })
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
      const messages = await window.unison.conversations.shared(conversationId, kind)
      set({ shared: { ...get().shared, [key]: messages } })
    } catch (err) {
      get().showToast(cleanError(err), 'error')
    }
  },

  async searchIn(conversationId, query) {
    try {
      return await window.unison.conversations.searchIn(conversationId, query)
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
    set({ settings: { ...DEFAULT_SETTINGS, ...(await window.unison.settings.get()) } })
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

  notifyTyping() {
    const { selectedId } = get()
    if (!selectedId) return
    const now = Date.now()
    if (now - lastTypingSent < 4000) return
    lastTypingSent = now
    void window.unison.messages.typing(selectedId).catch(() => undefined)
  },

  showToast(text, kind = 'info') {
    const id = ++toastCounter
    set({ toast: { id, text, kind } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: undefined })
    }, 4000)
  },

  t(key, params) {
    return translate(get().settings.language, key, params)
  }
}))

// ---------------------------------------------------------------- nicknames & custom photos

/** Image for a custom avatar value (uploaded data URL, or one of the logo characters). */
export function customAvatarUrl(value?: string): string | undefined {
  if (!value) return undefined
  if (value.startsWith('data:image/')) return value
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
  return { '--bubble-out': v['--bubble-out'], '--bubble-out-text': v['--bubble-out-text'], '--bubble-out-shadow': v['--bubble-out-shadow'] } as React.CSSProperties
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

/** Conversations for the current filter and search, pinned first then most recent. */
export function useVisibleConversations(): Conversation[] {
  const conversations = useStore((s) => s.conversations)
  const filter = useStore((s) => s.filter)
  const search = useStore((s) => s.search)
  const tags = useStore((s) => s.settings.tags)
  const pins = useStore((s) => s.settings.pins)
  return useMemo(() => computeVisible(conversations, filter, search, tags, pins), [conversations, filter, search, tags, pins])
}

/** Pinned in Unison, or on the platform when Unison has no say. */
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
  pins?: Record<string, boolean>
): Conversation[] {
  const query = search.trim().toLowerCase()
  return Object.values(conversations)
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
  return useMemo(() => computeUnread(conversations, tags, muted), [conversations, tags, muted])
}

function computeUnread(conversations: Record<string, Conversation>, tags: Record<string, TagId[]>, muted?: MuteRules): UnreadCounts {
  const byPlatform: Record<Platform, number> = { messenger: 0, instagram: 0, telegram: 0, zalo: 0, whatsapp: 0 }
  const byAccount: Record<string, number> = {}
  const byTag: Record<string, number> = {}
  let total = 0
  for (const c of Object.values(conversations)) {
    if (!c.unreadCount || c.muted) continue
    if (muted && isMutedBy({ muted, tags }, c)) continue
    total += c.unreadCount
    byPlatform[c.platform] += c.unreadCount
    byAccount[c.accountId] = (byAccount[c.accountId] ?? 0) + c.unreadCount
    for (const tag of tags[c.id] ?? []) byTag[tag] = (byTag[tag] ?? 0) + c.unreadCount
  }
  return { total, byPlatform, byAccount, byTag }
}

export function useT(): (key: TKey, params?: Record<string, string | number>) => string {
  const language = useStore((s) => s.settings.language)
  return useMemo(() => (key, params) => translate(language, key, params), [language])
}
