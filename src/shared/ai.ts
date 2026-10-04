/** On-device AI (Whisper for voice notes, NLLB for translation): shared ids, sizes and helpers. */

export type AiKind = 'voice' | 'translate' | 'chat' | 'speak' | 'cutout'
/** Languages the on-device reading voice comes in (system voices cover the rest when installed). */
export type SpeakLang = 'vi' | 'en'
export type VoiceModel = 'turbo' | 'small'
/** The language model behind summaries, reply suggestions and openers: Qwen3.5 (Apache-2.0) at four sizes, run by llama.cpp. */
export type ChatModel = 'qwen35-0.8b' | 'qwen35-2b' | 'qwen35-4b' | 'qwen35-9b'

/** A GGUF model llama.cpp runs, on the GPU when there is one. */
export interface LlmSpec {
  repo: string
  file: string
  /** Approximate download, for the UI. */
  megabytes: number
  /** Memory it takes while running (weights and a 4k context), GB. */
  needsGb: number
}

export interface AiModelSpec {
  repo: string
  /** Per-file quantisation, as transformers.js expects it. */
  dtype: Record<string, string> | string
  /** Approximate download, for the UI. */
  megabytes: number
  /** ONNX file base names to expect on disk; Whisper/NLLB use the encoder + merged decoder pair. */
  files?: string[]
}

export const AI_MODELS: { voice: Record<VoiceModel, AiModelSpec>; translate: AiModelSpec; chat: Record<ChatModel, LlmSpec>; speak: Record<SpeakLang, AiModelSpec>; cutout: AiModelSpec } = {
  voice: {
    // Best free speech recognition that runs locally; handles Vietnamese well.
    turbo: { repo: 'onnx-community/whisper-large-v3-turbo', dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, megabytes: 725 },
    small: { repo: 'onnx-community/whisper-small', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, megabytes: 240 }
  },
  // 200 languages, offline.
  translate: { repo: 'Xenova/nllb-200-distilled-600M', dtype: 'q8', megabytes: 855 },
  // Qwen3.5 (Apache-2.0, 2026) writes natural Vietnamese from 4B up; 4-bit GGUF, thinking turned off.
  chat: {
    'qwen35-0.8b': { repo: 'unsloth/Qwen3.5-0.8B-GGUF', file: 'Qwen3.5-0.8B-Q4_K_M.gguf', megabytes: 510, needsGb: 1.2 },
    'qwen35-2b': { repo: 'unsloth/Qwen3.5-2B-GGUF', file: 'Qwen3.5-2B-Q4_K_M.gguf', megabytes: 1220, needsGb: 2.2 },
    'qwen35-4b': { repo: 'unsloth/Qwen3.5-4B-GGUF', file: 'Qwen3.5-4B-Q4_K_M.gguf', megabytes: 2610, needsGb: 3.6 },
    'qwen35-9b': { repo: 'unsloth/Qwen3.5-9B-GGUF', file: 'Qwen3.5-9B-Q4_K_M.gguf', megabytes: 5420, needsGb: 6.8 }
  },
  // Meta's MMS text-to-speech (VITS), one small model per language. CC BY-NC 4.0: non-commercial use.
  speak: {
    vi: { repo: 'Xenova/mms-tts-vie', dtype: 'q8', megabytes: 40, files: ['model'] },
    en: { repo: 'Xenova/mms-tts-eng', dtype: 'q8', megabytes: 40, files: ['model'] }
  },
  // Background removal for custom stickers: BiRefNet lite (MIT), general-purpose, so pets, objects and people all
  // come out clean. MODNet (portrait matting) tore anything that was not a person. fp16 cuts exactly like fp32 at half
  // the download; about 8 s a picture on a CPU.
  cutout: { repo: 'onnx-community/BiRefNet_lite-ONNX', dtype: 'fp16', megabytes: 115, files: ['model'] }
}

/** Smallest to largest. */
export const CHAT_MODELS: ChatModel[] = ['qwen35-0.8b', 'qwen35-2b', 'qwen35-4b', 'qwen35-9b']

/** The model in use: the setting when it is one of these, older settings mapped onto the new sizes. */
export function chatModelOf(value: string | undefined): ChatModel {
  if (value && (CHAT_MODELS as string[]).includes(value)) return value as ChatModel
  return value === 'better' ? 'qwen35-4b' : 'qwen35-2b'
}

/** What the machine has for running a language model. */
export interface Hardware {
  /** The GPU llama.cpp found, or false for CPU only. */
  gpu: 'metal' | 'vulkan' | 'cuda' | false
  gpuName?: string
  /** GPU memory, GB (on Apple chips this is shared with the system). */
  vramGb: number
  ramGb: number
  /** Apple chips: one pool of memory for CPU and GPU. */
  unified: boolean
}

/** "Your voice" in the settings: the replies found on this computer, and the personal voice for the chat model. */
export interface VoiceInfo {
  model: ChatModel
  /** Times the user answered someone, usable as examples. */
  pairs: number
  /** A personal voice (LoRA) is installed for this model. */
  present: boolean
  /** It is installed but did not load (made for another model, damaged). */
  error?: string
  /** When it was installed (ms). */
  at?: number
}

export interface ChatAdvice {
  /** The two models that fit this machine best: the first is the stronger one it runs well. */
  picks: [ChatModel, ChatModel]
  /** Whether the first pick runs on the GPU or on the CPU (slower). */
  on: 'gpu' | 'cpu'
}

/**
 * The two models to offer for this machine. On a GPU, the largest that fits in its memory with room to spare
 * (on Apple chips, in the share of memory macOS lets the GPU use); without one, what the CPU can run at a
 * bearable pace, judged from RAM. The second pick is the next size down (or up, when the first is the smallest).
 */
export function recommendChatModels(hw: Hardware): ChatAdvice {
  const gpuBudget = hw.gpu ? (hw.unified ? Math.min(hw.vramGb, hw.ramGb * 0.65) : hw.vramGb * 0.85) : 0
  const fits = (budget: number): ChatModel | undefined => [...CHAT_MODELS].reverse().find((m) => AI_MODELS.chat[m].needsGb <= budget)
  let best = fits(gpuBudget)
  let on: ChatAdvice['on'] = 'gpu'
  // Too small a GPU, or none: the CPU, where speed (not memory) is the limit; 4B is the most it runs at a usable pace.
  if (!best || best === 'qwen35-0.8b') {
    on = 'cpu'
    best = hw.ramGb >= 16 ? 'qwen35-4b' : hw.ramGb >= 8 ? 'qwen35-2b' : 'qwen35-0.8b'
  }
  const i = CHAT_MODELS.indexOf(best)
  const second = CHAT_MODELS[i === 0 ? 1 : i - 1]
  return { picks: [best, second], on }
}

export interface AiStatus {
  voice: { model: VoiceModel; ready: boolean; gpu: boolean }
  translate: { ready: boolean }
  chat: { model: ChatModel; ready: boolean; gpu?: boolean }
  speak: Record<SpeakLang, boolean>
  /** `native`: macOS lifts the subject itself (no model to download; BiRefNet only for "Cut more precisely"). */
  cutout: { ready: boolean; native?: boolean }
  /** Space the downloaded models take. */
  bytes: number
}

export interface AiProgress {
  kind: AiKind
  phase: 'downloading' | 'loading' | 'ready' | 'error'
  /** 0..1 while downloading. */
  progress?: number
  error?: string
}

/** NLLB language codes for the languages Moshi users meet most. */
export const NLLB: Record<string, string> = {
  vi: 'vie_Latn',
  en: 'eng_Latn',
  zh: 'zho_Hans',
  ja: 'jpn_Jpan',
  ko: 'kor_Hang',
  th: 'tha_Thai',
  ru: 'rus_Cyrl',
  fr: 'fra_Latn',
  de: 'deu_Latn',
  es: 'spa_Latn',
  id: 'ind_Latn',
  lo: 'lao_Laoo',
  km: 'khm_Khmr'
}

const VI_MARKS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i
const VI_ONLY = /[ăđơưảãạẻẽẹỉĩịỏọủũụỷỹỵằắẳẵặầấẩẫậềếểễệồốổỗộờớởỡợừứửữự]/i
const VI_WORDS = /\b(khong|duoc|nhung|minh|ban|anh|em|toi|cua|nay|roi|nha|nhe|oi|voi|lam|di|den|thi|la|ko|dc|vs)\b/gi

/**
 * The language of a chat message, by script first, then Vietnamese accents or common unaccented
 * Vietnamese words, else English. Short and mixed texts are guesses; good enough to pick a translation.
 */
export function detectLanguage(text: string): string {
  const t = text.trim()
  if (/[぀-ヿ]/.test(t)) return 'ja'
  if (/[가-힯ᄀ-ᇿ]/.test(t)) return 'ko'
  if (/[一-鿿]/.test(t)) return 'zh'
  if (/[฀-๿]/.test(t)) return 'th'
  if (/[຀-໿]/.test(t)) return 'lo'
  if (/[ក-៿]/.test(t)) return 'km'
  if (/[Ѐ-ӿ]/.test(t)) return 'ru'
  // Letters only Vietnamese uses settle it; à/é/ô... are shared with French and Spanish.
  if (VI_ONLY.test(t)) return 'vi'
  if (/[ñ¿¡]/i.test(t)) return 'es'
  if (/[äöüß]/i.test(t)) return 'de'
  if (/[çœ]|\b(je|vous|merci|beaucoup|suis|avec|pour|c'est|n'est|bonjour)\b/i.test(t)) return 'fr'
  if (VI_MARKS.test(t)) return 'vi'
  const words = t.split(/\s+/).filter(Boolean).length
  const viWords = (t.match(VI_WORDS) ?? []).length
  if (words && viWords / words >= 0.3) return 'vi'
  return 'en'
}

/**
 * A plain-language reason when on-device AI cannot start, in the app language. The usual one on a
 * Mac is a build packaged for the other CPU (Intel vs Apple Silicon): the native libraries the models
 * run on (sharp, onnxruntime) then refuse to load. Other messages pass through unchanged.
 */
export function aiErrorHint(message: string, language: string): string {
  const vi = language === 'vi'
  const detail = message.length > 160 ? `${message.slice(0, 157)}…` : message
  if (/darwin-(arm64|x64)|Could not load the "sharp" module|onnxruntime_binding|incompatible architecture|not a valid Win32 application|win32-(x64|arm64|ia32) runtime/i.test(message)) {
    return vi
      ? `Bản Moshi này được đóng gói cho loại chip khác (Intel ↔ Apple Silicon) nên AI trên máy không chạy được. Hãy tải đúng bản cho máy này. (${detail})`
      : `This Moshi build was packaged for a different CPU (Intel vs Apple Silicon), so on-device AI cannot start. Please download the build for this Mac. (${detail})`
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|huggingface\.co/i.test(message)) {
    return vi ? `Không tải được mô hình: kiểm tra kết nối mạng (huggingface.co có thể bị chặn). (${detail})` : `The model could not be downloaded: check the connection (huggingface.co may be blocked). (${detail})`
  }
  return message
}

/**
 * Text as paragraphs of sentences. NLLB translates one sentence at a time well but tends to drop the
 * rest when given several, so each sentence is translated on its own and put back in place.
 */
export function translationChunks(text: string, max = 400): string[][] {
  const paragraphs: string[][] = []
  for (const para of text.split(/\n+/)) {
    const p = para.trim()
    if (!p) continue
    const sentences: string[] = []
    for (const sentence of p.split(/(?<=[.!?。！？…])\s+/)) {
      let rest = sentence.trim()
      // Very long "sentences" (no punctuation) are cut at spaces.
      while (rest.length > max) {
        const cut = rest.lastIndexOf(' ', max) > max / 2 ? rest.lastIndexOf(' ', max) : max
        sentences.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      if (rest) sentences.push(rest)
    }
    paragraphs.push(sentences)
  }
  return paragraphs
}
