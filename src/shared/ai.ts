/** On-device AI (Whisper for voice notes, NLLB for translation): shared ids, sizes and helpers. */

export type AiKind = 'voice' | 'translate' | 'chat' | 'speak'
/** Languages the on-device reading voice comes in (system voices cover the rest when installed). */
export type SpeakLang = 'vi' | 'en'
export type VoiceModel = 'turbo' | 'small'
/** The small instruction-tuned model behind summaries and reply suggestions. */
export type ChatModel = 'small' | 'better'

export interface AiModelSpec {
  repo: string
  /** Per-file quantisation, as transformers.js expects it. */
  dtype: Record<string, string> | string
  /** Approximate download, for the UI. */
  megabytes: number
  /** ONNX file base names to expect on disk; Whisper/NLLB use the encoder + merged decoder pair. */
  files?: string[]
}

export const AI_MODELS: { voice: Record<VoiceModel, AiModelSpec>; translate: AiModelSpec; chat: Record<ChatModel, AiModelSpec>; speak: Record<SpeakLang, AiModelSpec> } = {
  voice: {
    // Best free speech recognition that runs locally; handles Vietnamese well.
    turbo: { repo: 'onnx-community/whisper-large-v3-turbo', dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, megabytes: 725 },
    small: { repo: 'onnx-community/whisper-small', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, megabytes: 240 }
  },
  // 200 languages, offline.
  translate: { repo: 'Xenova/nllb-200-distilled-600M', dtype: 'q8', megabytes: 855 },
  // Qwen2.5 Instruct (Apache-2.0) speaks Vietnamese; 4-bit so it runs on any CPU. 'better' is slower but wiser.
  chat: {
    small: { repo: 'onnx-community/Qwen2.5-0.5B-Instruct', dtype: 'q4', megabytes: 480, files: ['model'] },
    better: { repo: 'onnx-community/Qwen2.5-1.5B-Instruct', dtype: 'q4', megabytes: 1100, files: ['model'] }
  },
  // Meta's MMS text-to-speech (VITS), one small model per language. CC BY-NC 4.0: non-commercial use.
  speak: {
    vi: { repo: 'Xenova/mms-tts-vie', dtype: 'q8', megabytes: 40, files: ['model'] },
    en: { repo: 'Xenova/mms-tts-eng', dtype: 'q8', megabytes: 40, files: ['model'] }
  }
}

export interface AiStatus {
  voice: { model: VoiceModel; ready: boolean; gpu: boolean }
  translate: { ready: boolean }
  chat: { model: ChatModel; ready: boolean }
  speak: Record<SpeakLang, boolean>
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
