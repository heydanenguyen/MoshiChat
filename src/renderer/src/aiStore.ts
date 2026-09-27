import { create } from 'zustand'
import { detectLanguage, type AiKind, type AiProgress, type AiStatus } from '@shared/ai'
import type { Attachment, Message } from '@shared/types'
import { useStore } from './store'
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

interface AiState {
  status?: AiStatus
  progress: Partial<Record<AiKind, AiProgress>>
  results: Record<string, AiResult>
  /** First use: the model is not on this computer yet; the setup sheet offers the download. */
  setup?: { kind: AiKind; then?: () => void }
  init(): Promise<void>
  refresh(): Promise<void>
  prepare(kind: AiKind): Promise<boolean>
  remove(kind: AiKind): Promise<void>
  closeSetup(): void
  transcribe(message: Message, attachment: Attachment): Promise<void>
  translate(message: Message): Promise<void>
  toggleHidden(key: string): void
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

/**
 * What a voice note in this chat is probably spoken in: the language most of its recent text messages
 * use (Whisper, as run here, would otherwise assume English), else the app language.
 */
function spokenLanguage(conversationId: string): string {
  const texts = (useStore.getState().messages[conversationId] ?? []).filter((m) => m.text.trim().length > 3 && !m.system).slice(-30)
  const votes = new Map<string, number>()
  for (const m of texts) {
    const lang = detectLanguage(m.text)
    votes.set(lang, (votes.get(lang) ?? 0) + 1)
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
  return best && best[1] >= 3 ? best[0] : language()
}
const clean = (err: unknown): string => ((err as Error)?.message ?? String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const useAi = create<AiState>((set, get) => {
  const patch = (key: string, value: AiResult): void => set({ results: { ...get().results, [key]: value } })

  /** Run now if the model is here, otherwise offer the download first and run afterwards. */
  const withModel = async (kind: AiKind, run: () => Promise<void>): Promise<void> => {
    const status = get().status ?? (await window.unison.ai.status())
    if (!get().status) set({ status })
    if (status[kind].ready) return run()
    set({ setup: { kind, then: () => void run() } })
  }

  return {
    progress: {},
    results: {},

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
    },

    async refresh() {
      set({ status: await window.unison.ai.status() })
    },

    async prepare(kind) {
      set({ progress: { ...get().progress, [kind]: { kind, phase: 'downloading', progress: 0 } } })
      try {
        await window.unison.ai.prepare(kind)
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

    toggleHidden(key) {
      const current = get().results[key]
      if (current) patch(key, { ...current, hidden: !current.hidden })
    }
  }
})
