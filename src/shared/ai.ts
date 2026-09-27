/** On-device AI (Whisper for voice notes, NLLB for translation): shared ids, sizes and helpers. */

export type AiKind = 'voice' | 'translate'
export type VoiceModel = 'turbo' | 'small'

export interface AiModelSpec {
  repo: string
  /** Per-file quantisation, as transformers.js expects it. */
  dtype: Record<string, string> | string
  /** Approximate download, for the UI. */
  megabytes: number
}

export const AI_MODELS: { voice: Record<VoiceModel, AiModelSpec>; translate: AiModelSpec } = {
  voice: {
    // Best free speech recognition that runs locally; handles Vietnamese well.
    turbo: { repo: 'onnx-community/whisper-large-v3-turbo', dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, megabytes: 725 },
    small: { repo: 'onnx-community/whisper-small', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, megabytes: 240 }
  },
  // 200 languages, offline.
  translate: { repo: 'Xenova/nllb-200-distilled-600M', dtype: 'q8', megabytes: 855 }
}

export interface AiStatus {
  voice: { model: VoiceModel; ready: boolean; gpu: boolean }
  translate: { ready: boolean }
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
