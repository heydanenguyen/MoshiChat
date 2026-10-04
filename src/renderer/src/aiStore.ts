import { create } from 'zustand'
import { detectLanguage, type AiKind, type AiProgress, type AiStatus, type SpeakLang } from '@shared/ai'
import { playPcm, speakWithSystem, stopSpeaking, systemVoice } from './tts'
import { tagDefsOf, type Attachment, type Message } from '@shared/types'
import type { ChatLine } from '@shared/ai-prompts'
import type { ChatContext } from '@shared/ai-context'
import { personFor, shownConversation, threadOf, useStore } from './store'
import { translate as tr } from './i18n'

export interface AiResult {
  text?: string
  busy?: boolean
  error?: string
  /** Detected source language (translations). */
  from?: string
  /** Translation collapsed back to the original. */
  hidden?: boolean
}

export interface SummaryState {
  bullets?: string[]
  busy?: boolean
  error?: string
  /** How many unread messages it covers; 0 = the recent conversation. */
  count?: number
  hidden?: boolean
}
export interface SuggestState {
  items?: string[]
  busy?: boolean
  /** The message the suggestions answer. */
  forId?: string
  /** Openers to pick a quiet chat back up (shown whoever wrote last, until the chat moves on). */
  opener?: boolean
  silentDays?: number
}

interface AiState {
  status?: AiStatus
  summaries: Record<string, SummaryState>
  suggestions: Record<string, SuggestState>
  /** Unread count of a chat when it was opened (the summary covers those). */
  unreadAtOpen: Record<string, number>
  /** Key of the message being read aloud. */
  speaking?: string
  /** Language the setup sheet downloads a reading voice for. */
  speakLang?: SpeakLang
  progress: Partial<Record<AiKind, AiProgress>>
  results: Record<string, AiResult>
  /** First use: the model is not on this computer yet; the setup sheet offers the download. */
  setup?: { kind: AiKind; then?: () => void }
  init(): Promise<void>
  refresh(): Promise<void>
  prepare(kind: AiKind, speakLang?: SpeakLang): Promise<boolean>
  /** Read a message aloud (or stop, when it is the one playing). */
  speak(message: Message, text?: string): Promise<void>
  remove(kind: AiKind): Promise<void>
  closeSetup(): void
  /** Run now if the model is here, otherwise offer the download first and run afterwards. */
  /** Runs `run` once the model is here (offering the download first). A Mac that lifts subjects itself needs no cut-out model, unless `requireModel`. */
  withModel(kind: AiKind, run: () => Promise<void>, requireModel?: boolean): Promise<void>
  transcribe(message: Message, attachment: Attachment): Promise<void>
  translate(message: Message): Promise<void>
  toggleHidden(key: string): void
  summarize(conversationId: string, force?: boolean): Promise<void>
  dismissSummary(conversationId: string): void
  /** `manual`: the user asked (offers the download when the model is missing). */
  suggest(conversationId: string, manual?: boolean): Promise<void>
  /** Openers for a chat that has been quiet for `silentDays`; only when the chat model is already here. */
  opener(conversationId: string, silentDays: number): Promise<void>
  /** The draft in another language (offers the translation model download first); undefined when it could not be done. */
  translateText(text: string, target: string): Promise<{ text: string; from: string } | undefined>
  clearSuggestions(conversationId: string): void
}

export const voiceKey = (m: Message, a: Attachment): string => `${m.conversationId}|${m.id}|${a.id}`
export const textKey = (m: Message): string => `${m.conversationId}|${m.id}`

/** Voice note bytes -> 16 kHz mono PCM, what Whisper expects. */
async function decodeTo16k(bytes: Uint8Array): Promise<Float32Array> {
  const ctx = new AudioContext()
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const decoded = await ctx.decodeAudioData(copy)
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    return (await offline.startRendering()).getChannelData(0)
  } finally {
    void ctx.close()
  }
}

const language = (): 'vi' | 'en' => useStore.getState().settings.language

/** A chat's loaded messages; a merged person's from all of its chats, in one timeline. */
function threadMessages(conversationId: string): Message[] {
  return threadOf(useStore.getState(), conversationId).messages ?? []
}

/**
 * What a voice note in this chat is probably spoken in: the language most of its recent text messages
 * use (Whisper, as run here, would otherwise assume English), else the app language.
 */
function spokenLanguage(conversationId: string): string {
  const texts = threadMessages(conversationId).filter((m) => m.text.trim().length > 3 && !m.system).slice(-30)
  const votes = new Map<string, number>()
  for (const m of texts) {
    const lang = detectLanguage(m.text)
    votes.set(lang, (votes.get(lang) ?? 0) + 1)
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
  return best && best[1] >= 3 ? best[0] : language()
}
const ATTACHMENT_LABEL: Record<string, { vi: string; en: string }> = {
  image: { vi: '[ảnh]', en: '[photo]' },
  video: { vi: '[video]', en: '[video]' },
  audio: { vi: '[tin nhắn thoại]', en: '[voice note]' },
  file: { vi: '[tệp]', en: '[file]' },
  sticker: { vi: '[sticker]', en: '[sticker]' },
  link: { vi: '[liên kết]', en: '[link]' },
  story: { vi: '[story]', en: '[story]' },
  post: { vi: '[bài viết]', en: '[post]' }
}

/** The newest `count` messages of a chat as lines the model can read (attachments become short labels). */
function linesFor(conversationId: string, count: number): ChatLine[] {
  const lang = language()
  return threadMessages(conversationId)
    .filter((m) => !m.system && (m.text.trim() || m.attachments.length))
    .slice(-count)
    .map((m) => ({
      who: m.senderName,
      text: m.text.trim() || m.attachments.map((a) => ATTACHMENT_LABEL[a.kind]?.[lang] ?? '[…]').join(' '),
      at: m.sentAt,
      mine: m.isOutgoing
    }))
}

/** Who the chat is with, for the language model: names, the user's tags and note (pronouns and style come from the lines). */
function contextFor(conversationId: string): ChatContext {
  const s = useStore.getState()
  const c = shownConversation(s, conversationId)
  const account = c ? s.accounts[c.accountId] : undefined
  const defs = tagDefsOf(s.settings)
  const lang = s.settings.language
  const tags = (s.settings.tags?.[conversationId] ?? []).map((id) => defs.find((d) => d.id === id)?.name[lang]).filter((n): n is string => !!n)
  const me = c?.participants.find((p) => p.isMe)?.name ?? (account && !account.demo ? account.displayName : undefined)
  return { me, them: c?.title, isGroup: c?.isGroup, tags, note: s.settings.contactOverrides?.[conversationId]?.note, conversationId }
}

const clean = (err: unknown): string => ((err as Error)?.message ?? String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const useAi = create<AiState>((set, get) => {
  const patch = (key: string, value: AiResult): void => set({ results: { ...get().results, [key]: value } })

  /** Run now if the model is here, otherwise offer the download first and run afterwards. */
  const withModel = async (kind: AiKind, run: () => Promise<void>, requireModel = false): Promise<void> => {
    const status = get().status ?? (await window.unison.ai.status())
    if (!get().status) set({ status })
    // Reading voices are per language and handled by speak() itself.
    if (kind !== 'speak' && status[kind].ready) return run()
    if (kind === 'cutout' && status.cutout.native && !requireModel) return run()
    set({ setup: { kind, then: () => void run() } })
  }

  let suggestTimer: ReturnType<typeof setTimeout> | undefined

  return {
    progress: {},
    results: {},
    summaries: {},
    suggestions: {},
    unreadAtOpen: {},

    async init() {
      window.unison.onEvent((event) => {
        if (event.type !== 'ai:progress') return
        set({ progress: { ...get().progress, [event.progress.kind]: event.progress } })
        if (event.progress.phase === 'ready') void get().refresh()
      })
      const [status, cached] = await Promise.all([window.unison.ai.status(), window.unison.ai.cached()])
      const results: Record<string, AiResult> = {}
      for (const [key, text] of Object.entries(cached.transcripts)) results[key] = { text }
      const lang = language()
      for (const [key, text] of Object.entries(cached.translations)) {
        if (key.endsWith(`|${lang}`)) results[`t:${key.slice(0, -(lang.length + 1))}`] = { text }
      }
      set({ status, results })
      // Remember how many messages were unread when a chat is opened, and offer replies as new ones arrive.
      useStore.subscribe((s, prev) => {
        if (s.selectedId && s.selectedId !== prev.selectedId) {
          // A chat was opened: have the language model loaded by the time a suggestion is wanted.
          if (s.settings.aiSuggest !== false && get().status?.chat.ready) void window.unison.ai.warm().catch(() => undefined)
          set({ unreadAtOpen: { ...get().unreadAtOpen, [s.selectedId]: shownConversation(prev, s.selectedId)?.unreadCount ?? 0 } })
        }
        const id = s.selectedId
        if (!id) return
        // Nothing new in this chat (or any of a merged person's chats): nothing to do.
        const ids = personFor(s, id)?.members ?? [id]
        if (id === prev.selectedId && ids.every((m) => s.messages[m] === prev.messages[m])) return
        // A merged person's newest message may be in any of its chats.
        const last = threadOf(s, id).messages?.at(-1)
        if (!last || (id === prev.selectedId && last === threadOf(prev, id).messages?.at(-1))) return
        const current = get().suggestions[id]
        // Openers stay while the chat loads; anything new in it (your own message too) replaces them.
        if (current?.opener && (current.forId === undefined || current.forId === last.id)) return
        if (last.isOutgoing) {
          if (current?.items?.length) get().clearSuggestions(id)
          return
        }
        if (suggestTimer) clearTimeout(suggestTimer)
        suggestTimer = setTimeout(() => void get().suggest(id), 1200)
      })
    },

    async refresh() {
      set({ status: await window.unison.ai.status() })
    },

    async prepare(kind, speakLang) {
      set({ progress: { ...get().progress, [kind]: { kind, phase: 'downloading', progress: 0 } } })
      try {
        await window.unison.ai.prepare(kind, speakLang ?? get().speakLang)
        await get().refresh()
        return true
      } catch (err) {
        set({ progress: { ...get().progress, [kind]: { kind, phase: 'error', error: clean(err) } } })
        return false
      }
    },

    async remove(kind) {
      await window.unison.ai.remove(kind)
      set({ progress: { ...get().progress, [kind]: undefined } })
      await get().refresh()
    },

    closeSetup() {
      set({ setup: undefined })
    },

    withModel,

    async transcribe(message, attachment) {
      const key = voiceKey(message, attachment)
      if (get().results[key]?.busy) return
      await withModel('voice', async () => {
        patch(key, { busy: true })
        try {
          let url = attachment.url
          if (!url) url = await useStore.getState().loadAttachment(message.conversationId, message.id, attachment.id)
          if (!url) throw new Error(tr(language(), 'aiNoAudio'))
          const pcm = await decodeTo16k(await window.unison.ai.readMedia(url)).catch(() => {
            throw new Error(tr(language(), 'aiAudioFormat'))
          })
          const text = await window.unison.ai.transcribe(key, pcm, spokenLanguage(message.conversationId))
          patch(key, { text: text || tr(language(), 'aiNoSpeech') })
        } catch (err) {
          patch(key, { error: clean(err) })
        }
      })
    },

    async translate(message) {
      const key = `t:${textKey(message)}`
      const current = get().results[key]
      if (current?.busy) return
      if (current?.text) {
        get().toggleHidden(key)
        return
      }
      await withModel('translate', async () => {
        patch(key, { busy: true })
        try {
          const result = await window.unison.ai.translate(textKey(message), message.text)
          if (result.same) {
            patch(key, {})
            useStore.getState().showToast(tr(language(), 'aiAlreadyInLanguage'))
          } else patch(key, { text: result.text, from: result.from })
        } catch (err) {
          patch(key, { error: clean(err) })
        }
      })
    },

    async speak(message, text) {
      const key = textKey(message)
      if (get().speaking === key) {
        stopSpeaking()
        set({ speaking: undefined })
        return
      }
      const body = (text ?? message.text).trim()
      if (!body) return
      const lang = detectLanguage(body)
      const voice = await systemVoice(lang)
      if (voice) {
        set({ speaking: key })
        await speakWithSystem(body, voice)
        if (get().speaking === key) set({ speaking: undefined })
        return
      }
      const speakLang: SpeakLang = lang === 'en' ? 'en' : 'vi'
      const status = get().status ?? (await window.unison.ai.status())
      const run = async (): Promise<void> => {
        set({ speaking: key })
        try {
          const { audio, rate } = await window.unison.ai.speak(body.slice(0, 1200), speakLang)
          if (get().speaking !== key) return
          await playPcm(audio instanceof Float32Array ? audio : new Float32Array(audio as ArrayLike<number>), rate)
        } catch (err) {
          useStore.getState().showToast(clean(err), 'error')
        } finally {
          if (get().speaking === key) set({ speaking: undefined })
        }
      }
      if (status.speak[speakLang]) return run()
      set({ speakLang, setup: { kind: 'speak', then: () => void run() } })
    },

    async summarize(conversationId, force) {
      const current = get().summaries[conversationId]
      if (current?.busy) return
      if (current?.bullets && !force) {
        set({ summaries: { ...get().summaries, [conversationId]: { ...current, hidden: !current.hidden } } })
        return
      }
      await withModel('chat', async () => {
        const unread = get().unreadAtOpen[conversationId] ?? 0
        const count = unread >= 3 ? Math.min(unread, 60) : 0
        const lines = linesFor(conversationId, count || 40)
        const messages = threadMessages(conversationId)
        const last = messages.at(-1)
        if (lines.length < 2 || !last) {
          useStore.getState().showToast(tr(language(), 'aiNothingToSummarize'))
          return
        }
        set({ summaries: { ...get().summaries, [conversationId]: { busy: true, count } } })
        try {
          const bullets = await window.unison.ai.summarize(`${conversationId}|${last.id}|${count}`, lines)
          set({ summaries: { ...get().summaries, [conversationId]: { bullets, count } } })
        } catch (err) {
          set({ summaries: { ...get().summaries, [conversationId]: { error: clean(err), count } } })
        }
      })
    },

    dismissSummary(conversationId) {
      const current = get().summaries[conversationId]
      if (current) set({ summaries: { ...get().summaries, [conversationId]: { ...current, hidden: true } } })
    },

    async suggest(conversationId, manual) {
      const settings = useStore.getState().settings
      if (!manual && settings.aiSuggest === false) return
      const status = get().status
      if (!manual && !status?.chat.ready) return
      const list = threadMessages(conversationId)
      const last = list.at(-1)
      if (!last || last.isOutgoing || last.system) return
      const current = get().suggestions[conversationId]
      if (current?.busy || (current?.forId === last.id && current.items?.length && !manual)) return
      await withModel('chat', async () => {
        set({ suggestions: { ...get().suggestions, [conversationId]: { busy: true, forId: last.id } } })
        try {
          const items = await window.unison.ai.suggest(linesFor(conversationId, 40), contextFor(conversationId))
          // The chat may have moved on while the model was thinking.
          const now = threadMessages(conversationId).at(-1)
          if (now && now.id !== last.id && now.isOutgoing) {
            get().clearSuggestions(conversationId)
            return
          }
          set({ suggestions: { ...get().suggestions, [conversationId]: { items, forId: last.id } } })
        } catch {
          set({ suggestions: { ...get().suggestions, [conversationId]: { forId: last.id } } })
        }
      })
    },

    async opener(conversationId, silentDays) {
      const status = get().status ?? (await window.unison.ai.status())
      if (!get().status) set({ status })
      // Never a download from a nudge: without the model the chat simply opens.
      if (!status.chat.ready || get().suggestions[conversationId]?.busy) return
      set({ suggestions: { ...get().suggestions, [conversationId]: { busy: true, opener: true, silentDays } } })
      // The chat was just opened: give its messages a moment to arrive.
      for (let i = 0; i < 20 && !threadMessages(conversationId).length; i++) await new Promise((r) => setTimeout(r, 150))
      const forId = threadMessages(conversationId).at(-1)?.id
      set({ suggestions: { ...get().suggestions, [conversationId]: { busy: true, opener: true, silentDays, forId } } })
      try {
        const note = useStore.getState().settings.contactOverrides?.[conversationId]?.note
        const items = await window.unison.ai.opener(linesFor(conversationId, 40), silentDays, note, contextFor(conversationId))
        if (threadMessages(conversationId).at(-1)?.id !== forId) return get().clearSuggestions(conversationId)
        set({ suggestions: { ...get().suggestions, [conversationId]: items.length ? { items, forId, opener: true, silentDays } : {} } })
      } catch {
        get().clearSuggestions(conversationId)
      }
    },

    async translateText(text, target) {
      let result: { text: string; from: string } | undefined
      await withModel('translate', async () => {
        try {
          result = await window.unison.ai.translateTo(text, target)
        } catch (err) {
          useStore.getState().showToast(clean(err), 'error')
        }
      })
      return result
    },

    clearSuggestions(conversationId) {
      const next = { ...get().suggestions }
      delete next[conversationId]
      set({ suggestions: next })
    },

    toggleHidden(key) {
      const current = get().results[key]
      if (current) patch(key, { ...current, hidden: !current.hidden })
    }
  }
})
