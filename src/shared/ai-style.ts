/**
 * The user's own replies as examples for the language model: from the message records Moshi already keeps on
 * this computer (the friendship insights), pairs of "they wrote → I answered", and for each suggestion the few
 * pairs most like the message being answered. Nothing here is stored or sent anywhere; it is worked out when
 * asked. The same pairs, with a little of the chat before them, are what a personal LoRA is trained on.
 */
import { detectLanguage } from './ai'
import { guessIntent, type Address, type Intent } from './ai-context'
import type { InsightRecord } from './insights'

export interface StylePair {
  conversationId: string
  /** What they wrote (the last message or two before the reply). */
  them: string
  /** What the user answered. */
  me: string
  at: number
  language: 'vi' | 'en' | 'other'
  intent?: Intent
  /** Lower-case words of `them`, for matching. */
  words: string[]
}

export interface StyleExample {
  them: string
  me: string
}

/** Longest gap between their message and the user's answer for the two to count as a pair. */
const PAIR_GAP_MS = 3 * 3600_000

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** Account numbers, phone numbers, codes, addresses on the web, passwords: never an example, never trained on. */
export function isPrivate(text: string): boolean {
  return (
    /\d[\d .-]{7,}\d/.test(text) ||
    /\d{5,}/.test(text) ||
    /[\w.+-]+@[\w-]+\.\w+/.test(text) ||
    /https?:\/\/|www\./i.test(text) ||
    /\b(otp|pin|password|passcode|cvv)\b/i.test(text) ||
    /mật khẩu|số tài khoản|\bstk\b|mã xác (nhận|minh)/i.test(text)
  )
}

const usable = (text: string): boolean => text.trim().length >= 1 && text.length <= 140 && !isPrivate(text)

/**
 * "They wrote → I answered" pairs from one-to-one chats: the first message the user sent after a run of theirs,
 * within a few hours. A very short last message ("ơi", "?") takes the one before it along.
 */
export function stylePairs(records: InsightRecord[], skip: (conversationId: string) => boolean = () => false): StylePair[] {
  const byChat = new Map<string, InsightRecord[]>()
  for (const r of records) {
    if (skip(r.conversationId)) continue
    const list = byChat.get(r.conversationId)
    if (list) list.push(r)
    else byChat.set(r.conversationId, [r])
  }
  const out: StylePair[] = []
  for (const [conversationId, list] of byChat) {
    list.sort((a, b) => a.sentAt - b.sentAt)
    for (let i = 1; i < list.length; i++) {
      const mine = list[i]
      const before = list[i - 1]
      if (!mine.isOutgoing || before.isOutgoing) continue
      if (mine.sentAt - before.sentAt > PAIR_GAP_MS) continue
      const me = mine.text.trim()
      let them = before.text.trim()
      const earlier = list[i - 2]
      if (them.length < 8 && earlier && !earlier.isOutgoing && before.sentAt - earlier.sentAt < 10 * 60_000 && earlier.text.trim()) them = `${earlier.text.trim()} ${them}`.trim()
      if (!them || !usable(me) || !usable(them) || me.toLowerCase() === them.toLowerCase()) continue
      const lang = detectLanguage(me)
      out.push({
        conversationId,
        them,
        me,
        at: mine.sentAt,
        language: lang === 'vi' || lang === 'en' ? lang : 'other',
        intent: guessIntent(them),
        words: words(them)
      })
    }
  }
  return out
}

/** Words that say who is speaking to whom; an example from another chat must not bring in a different pair. */
const KIN = new Set(['anh', 'chị', 'em', 'con', 'mẹ', 'bố', 'ba', 'má', 'cô', 'chú', 'bác', 'dì', 'cháu', 'ông', 'bà', 'bạn', 'cậu', 'mày', 'tao', 'tớ', 'tôi', 'mình'])

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const set = new Set(a)
  let shared = 0
  for (const w of new Set(b)) if (set.has(w)) shared++
  return shared / Math.min(new Set(a).size, new Set(b).size)
}

function bigrams(list: string[]): string[] {
  const out: string[] = []
  for (let i = 1; i < list.length; i++) out.push(`${list[i - 1]} ${list[i]}`)
  return out
}

/**
 * The examples for one suggestion: pairs in the reply's language, from this chat first, then from chats with a
 * shared tag, preferring the same kind of message and similar words. A pair from another chat is used only when
 * its pronouns fit this one (no "Dạ em gửi chị" as an example for writing to Mum).
 */
export function pickExamples(
  pairs: StylePair[],
  options: {
    answering: string
    conversationId?: string
    language: 'vi' | 'en'
    address?: Address
    /** Tag ids of this chat, and of any chat. */
    tags?: string[]
    tagsOf?: (conversationId: string) => string[]
    limit?: number
    now?: number
  }
): StyleExample[] {
  const now = options.now ?? Date.now()
  const want = words(options.answering)
  const wantPairs = bigrams(want)
  const intent = guessIntent(options.answering)
  const tags = new Set(options.tags ?? [])
  const allowed = new Set([options.address?.self, options.address?.other].filter((w): w is string => !!w))
  const scored: Array<{ pair: StylePair; score: number }> = []
  for (const p of pairs) {
    if (p.language !== options.language) continue
    if (options.answering.trim().toLowerCase() === p.them.toLowerCase() && p.conversationId === options.conversationId && now - p.at < 60_000) continue
    const same = !!options.conversationId && p.conversationId === options.conversationId
    if (!same && options.language === 'vi') {
      const kin = words(p.me).filter((w) => KIN.has(w))
      // without knowing this chat's pronouns, only examples without any
      if (kin.some((w) => !allowed.has(w))) continue
    }
    const sharedTag = !same && (options.tagsOf?.(p.conversationId) ?? []).some((t) => tags.has(t))
    const days = Math.max(0, now - p.at) / 86_400_000
    const score =
      2 * overlap(want, p.words) +
      2 * overlap(wantPairs, bigrams(p.words)) +
      (intent && p.intent === intent ? 1.2 : 0) +
      (same ? 1.5 : 0) +
      (sharedTag ? 0.6 : 0) +
      0.4 * Math.exp(-days / 120)
    scored.push({ pair: p, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const out: StyleExample[] = []
  const seen = new Set<string>()
  for (const { pair } of scored) {
    const key = pair.me.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ them: pair.them, me: pair.me })
    if (out.length >= (options.limit ?? 4)) break
  }
  return out
}

/** One training sample for a personal LoRA: the chat before the reply, and the reply. */
export interface TrainingSample {
  lines: Array<{ mine: boolean; text: string }>
  reply: string
}

/**
 * Training samples from the records: each reply of the user's in a one-to-one chat with up to six messages
 * before it. Replies that look private are left out, and so is any sample whose context does.
 */
export function trainingSamples(records: InsightRecord[], skip: (conversationId: string) => boolean = () => false): TrainingSample[] {
  const byChat = new Map<string, InsightRecord[]>()
  for (const r of records) {
    if (skip(r.conversationId) || !r.text.trim()) continue
    const list = byChat.get(r.conversationId)
    if (list) list.push(r)
    else byChat.set(r.conversationId, [r])
  }
  const out: TrainingSample[] = []
  for (const list of byChat.values()) {
    list.sort((a, b) => a.sentAt - b.sentAt)
    for (let i = 1; i < list.length; i++) {
      const mine = list[i]
      const before = list[i - 1]
      if (!mine.isOutgoing || before.isOutgoing || mine.sentAt - before.sentAt > PAIR_GAP_MS) continue
      if (!usable(mine.text)) continue
      const context = list.slice(Math.max(0, i - 6), i).filter((r) => mine.sentAt - r.sentAt < 24 * 3600_000)
      if (context.some((r) => isPrivate(r.text))) continue
      out.push({ lines: context.map((r) => ({ mine: r.isOutgoing, text: r.text.trim() })), reply: mine.text.trim() })
    }
  }
  return out
}
