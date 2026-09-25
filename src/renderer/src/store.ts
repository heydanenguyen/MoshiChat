import { useMemo } from 'react'
import { create } from 'zustand'
import type {
  Account,
  AddAccountInput,
  AuthPrompt,
  BridgeEvent,
  Conversation,
  Message,
  OutgoingAttachment,
  Platform,
  SearchHit,
  Settings
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { translate, type TKey } from './i18n'

export type Filter = 'all' | Platform | `account:${string}`

export type Sheet =
  | { kind: 'none' }
  | { kind: 'settings' }
  | { kind: 'add-account'; platform?: Platform }
  | { kind: 'command' }

export interface Toast {
  id: number
  text: string
  kind: 'error' | 'info'
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
  toast?: Toast
  replyTo?: Message
  pendingFiles: OutgoingAttachment[]

  init(): Promise<void>
  select(id?: string, highlightId?: string): void
  setFilter(filter: Filter): void
  setSearch(search: string): void
  openHit(hit: SearchHit): void
  send(text: string): Promise<void>
  react(messageId: string, emoji: string): Promise<void>
  setReplyTo(message?: Message): void
  addFiles(files: OutgoingAttachment[]): void
  addDroppedFiles(files: File[]): void
  removeFile(path: string): void
  loadMore(conversationId: string): Promise<void>
  openSheet(sheet: Sheet): void
  closeSheet(): void
  setSettings(patch: Partial<Settings>): Promise<void>
  respondAuth(requestId: string, value: string): Promise<void>
  cancelAuth(requestId: string): Promise<void>
  addAccount(input: AddAccountInput): Promise<void>
  removeAccount(accountId: string): Promise<void>
  reconnect(accountId: string): Promise<void>
  addDemo(): Promise<void>
  toggleDetails(): void
  notifyTyping(): void
  showToast(text: string, kind?: Toast['kind']): void
  t(key: TKey, params?: Record<string, string | number>): string
}

const PAGE = 50
let toastCounter = 0
let lastTypingSent = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
  pendingFiles: [],

  async init() {
    const bridge = window.unison
    const [settings, accounts, conversations] = await Promise.all([
      bridge.settings.get(),
      bridge.accounts.list(),
      bridge.conversations.list()
    ])
    set({
      ready: true,
      settings,
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
          if (list) set({ messages: { ...state.messages, [event.message.conversationId]: list } })
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
            typing[conversationId] = { name: peerName, until: Date.now() + 6000 }
            typingTimers.set(
              conversationId,
              setTimeout(() => {
                const next = { ...get().typing }
                delete next[conversationId]
                set({ typing: next })
              }, 6000)
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
    set({ selectedId: id, highlightId, sheet: { kind: 'none' }, replyTo: undefined, pendingFiles: [] })
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
            hasMore: { ...s.hasMore, [id]: messages.length >= PAGE },
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

  async send(text) {
    const { selectedId, messages, settings, replyTo, pendingFiles } = get()
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
        kind: f.mime.startsWith('image/') ? 'image' : f.mime.startsWith('video/') ? 'video' : f.mime.startsWith('audio/') ? 'audio' : 'file',
        url: f.preview,
        name: f.name,
        size: f.size
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
      pendingFiles: []
    })
    try {
      const sent = await window.unison.messages.send(selectedId, trimmed, {
        replyToId: replyTo?.id,
        attachments: pendingFiles.length ? pendingFiles : undefined
      })
      const s = get()
      set({ messages: { ...s.messages, [selectedId]: upsertMessage(s.messages[selectedId], sent, tempId) ?? [] } })
    } catch (err) {
      const s = get()
      const failed = { ...optimistic, status: 'failed' as const }
      set({ messages: { ...s.messages, [selectedId]: upsertMessage(s.messages[selectedId], failed) ?? [] } })
      get().showToast((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), 'error')
    }
  },

  async react(messageId, emoji) {
    const { selectedId } = get()
    if (!selectedId) return
    try {
      await window.unison.messages.react(selectedId, messageId, emoji)
    } catch (err) {
      get().showToast((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), 'error')
    }
  },

  setReplyTo(message) {
    set({ replyTo: message })
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
        hasMore: { ...s.hasMore, [conversationId]: older.length >= PAGE },
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
    set({ sheet: { kind: 'none' } })
  },

  async setSettings(patch) {
    const settings = await window.unison.settings.set(patch)
    set({ settings })
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

  async removeAccount(accountId) {
    await window.unison.accounts.remove(accountId)
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

  toggleDetails() {
    set({ detailsOpen: !get().detailsOpen })
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

/** Conversations for the current filter and search, pinned first then most recent. */
export function useVisibleConversations(): Conversation[] {
  const conversations = useStore((s) => s.conversations)
  const filter = useStore((s) => s.filter)
  const search = useStore((s) => s.search)
  return useMemo(() => computeVisible(conversations, filter, search), [conversations, filter, search])
}

function computeVisible(conversations: Record<string, Conversation>, filter: Filter, search: string): Conversation[] {
  const query = search.trim().toLowerCase()
  return Object.values(conversations)
    .filter((c) => {
      if (filter === 'all') return true
      if (filter.startsWith('account:')) return c.accountId === filter.slice(8)
      return c.platform === filter
    })
    .filter((c) => {
      if (!query) return true
      return (
        c.title.toLowerCase().includes(query) ||
        c.participants.some((p) => p.name.toLowerCase().includes(query) || p.handle?.toLowerCase().includes(query))
      )
    })
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
}

export interface UnreadCounts {
  total: number
  byPlatform: Record<Platform, number>
  byAccount: Record<string, number>
}

export function useUnreadCounts(): UnreadCounts {
  const conversations = useStore((s) => s.conversations)
  return useMemo(() => computeUnread(conversations), [conversations])
}

function computeUnread(conversations: Record<string, Conversation>): UnreadCounts {
  const byPlatform: Record<Platform, number> = { messenger: 0, instagram: 0, telegram: 0, zalo: 0, whatsapp: 0 }
  const byAccount: Record<string, number> = {}
  let total = 0
  for (const c of Object.values(conversations)) {
    if (!c.unreadCount || c.muted) continue
    total += c.unreadCount
    byPlatform[c.platform] += c.unreadCount
    byAccount[c.accountId] = (byAccount[c.accountId] ?? 0) + c.unreadCount
  }
  return { total, byPlatform, byAccount }
}

export function useT(): (key: TKey, params?: Record<string, string | number>) => string {
  const language = useStore((s) => s.settings.language)
  return useMemo(() => (key, params) => translate(language, key, params), [language])
}
