/**
 * What the language model is told about a conversation before it writes anything: who is talking to whom, how the
 * user addresses them (Vietnamese pronouns carry the relationship: em/chị, anh/em, mình/bạn, tao/mày…), how the
 * user writes, and what kind of message is being answered. All of it is worked out here, on the device, from the
 * messages themselves, so small models get the facts they would otherwise guess wrong.
 */
import type { ChatLine } from './ai-prompts'

/** What the app knows about the chat beyond its messages. */
export interface ChatContext {
  /** The user's own name on this account. */
  me?: string
  /** The other person (or the group's name). */
  them?: string
  isGroup?: boolean
  /** The user's tags on the chat (Work, Family…). */
  tags?: string[]
  /** The user's private note about this person. */
  note?: string
  closeFriend?: boolean
  /** The chat, so the user's earlier replies in it can be found. */
  conversationId?: string
  /** How the user answered similar messages before (filled in by the main process). */
  examples?: Array<{ them: string; me: string }>
}

/** How the user and the other person address each other, as far as the messages tell. */
export interface Address {
  /** What the user calls themself ("em"). */
  self?: string
  /** What the user calls the other person ("chị"). */
  other?: string
  /** The user writes politely ("dạ", "ạ"). */
  polite: boolean
}

export interface Style {
  /** Average length of the user's messages, in characters. */
  avgLength: number
  emoji: boolean
  /** Sentence-final particles the user uses often ("nhé", "nha", "ạ"). */
  particles: string[]
  /** Starts messages with a lowercase letter. */
  lowercase: boolean
  /** A few of the user's own recent messages, as examples of their voice. */
  examples: string[]
}

export type Intent = 'good_news' | 'bad_news' | 'question' | 'request' | 'invite' | 'thanks' | 'apology' | 'greeting' | 'info'
export const INTENTS: Intent[] = ['good_news', 'bad_news', 'question', 'request', 'invite', 'thanks', 'apology', 'greeting', 'info']

const PRONOUNS = new Set(['em', 'anh', 'chị', 'mình', 'tôi', 'tao', 'tớ', 'con', 'cháu', 'cô', 'chú', 'bác', 'ông', 'bà', 'mẹ', 'bố', 'ba', 'má', 'bạn', 'cậu', 'mày', 'dì'])
/** Words that open a clause before the subject ("Dạ em gửi", "Ừ mình biết"). */
const LEAD = new Set(['dạ', 'vâng', 'ừ', 'ừm', 'uh', 'ok', 'oke', 'okay', 'à', 'ơ', 'ờ', 'thì', 'mà', 'nhưng', 'còn', 'vậy', 'thế', 'hihi', 'haha', 'hì', 'ủa', 'ê', 'ồ', 'thôi', 'rồi'])
/** Words that only ever mean "you": at the start of a clause they are still the listener ("mày đâu"). */
const SECOND = new Set(['mày', 'bạn', 'cậu'])
/** When the other person calls themself X, the user calls them… (most words are their own mirror). */
const ADDRESS_OF_SELF: Record<string, string> = { tôi: 'bạn', mình: 'bạn', tao: 'mày', tớ: 'cậu' }
/** When the other person calls the user X, the user calls themself… */
const SELF_OF_ADDRESS: Record<string, string> = { bạn: 'mình', cậu: 'tớ', mày: 'tao' }

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)

interface Clause {
  words: string[]
  /** Ends in "?" or a question word ("chưa", "không", "sao"…): its subject is often the listener ("Em ngủ chưa?"). */
  question: boolean
}

const QUESTION_END = /\b(chưa|không|ko|hông|hả|à|nhỉ|sao|chứ|gì|đâu|nào)$/u
/** Words after the last pronoun that do not change who it is ("rồi em ạ", "ok chị nhé"). */
const TRAIL = new Set(['ạ', 'nhé', 'nha', 'à', 'nhỉ', 'hả', 'đó', 'nè', 'hen', 'ha', 'á', 'luôn', 'nhá', 'nhen', 'đấy', 'rồi', 'nữa', 'với'])
/** Question words anywhere in a clause ("anh lấy size gì ạ"). */
const ASKING = new Set(['gì', 'nào', 'đâu', 'mấy', 'chưa', 'sao', 'hả', 'nhỉ', 'chứ'])

const clauses = (text: string): Clause[] =>
  (text.toLowerCase().match(/[^,.!?;:\n…]+[,.!?;:\n…]*/g) ?? [])
    .map((part) => {
      const w = words(part)
      return { words: w, question: /\?/.test(part) || QUESTION_END.test(w.join(' ')) || w.some((x) => ASKING.has(x)) }
    })
    .filter((c) => c.words.length)

function vote(map: Map<string, number>, word: string | undefined, weight: number): void {
  if (word && PRONOUNS.has(word)) map.set(word, (map.get(word) ?? 0) + weight)
}

const top = (map: Map<string, number>, not?: string): string | undefined =>
  [...map.entries()].filter(([w]) => w !== not).sort((a, b) => b[1] - a[1])[0]?.[0]

/** Pairs where one side tells the other. Kinship words do not: "em" can face anh, chị, cô… */
const PAIR: Record<string, string> = { tao: 'mày', mày: 'tao', tớ: 'cậu', cậu: 'tớ', mình: 'bạn', bạn: 'mình', tôi: 'bạn' }

/** Who a clause calls ("chị ơi"), its subject (the first pronoun past "dạ", "ừ" and the call) and its closing pronoun. */
function readClause(c: Clause): { called?: string; subject?: string; closing?: string; asked: boolean; objectOfCho?: string } {
  const w = c.words
  const call = w.findIndex((x, i) => x === 'ơi' && i > 0)
  const called = call > 0 && PRONOUNS.has(w[call - 1]) ? w[call - 1] : undefined
  const rest = call > 0 ? w.slice(call + 1) : w
  const first = rest.find((x) => !LEAD.has(x))
  const subject = first && PRONOUNS.has(first) ? first : undefined
  let end = rest.length - 1
  while (end >= 0 && TRAIL.has(rest[end])) end--
  const closing = end >= 0 && PRONOUNS.has(rest[end]) && rest[end] !== first ? rest[end] : undefined
  const core = rest.filter((x) => !LEAD.has(x) && !TRAIL.has(x))
  // "Dạ vâng chị", "Ok anh": a pronoun alone after the particles calls the listener
  if (subject && core.length === 1) return { called, closing: subject, asked: c.question }
  // the one given something ("gửi hàng cho chị")
  const cho = rest.indexOf('cho')
  const objectOfCho = cho >= 0 && PRONOUNS.has(rest[cho + 1]) ? rest[cho + 1] : undefined
  // "em báo giá giúp anh": asking for help, so the subject is the one asked
  return { called, subject, closing, asked: c.question || rest.includes('giúp'), objectOfCho }
}

/**
 * How the two address each other. In the user's own words, the subject of a statement is the user ("em gửi rồi"),
 * while a name called ("chị ơi"), a closing pronoun ("ok chị") or the subject of a question ("em ngủ chưa?") is the
 * other person; their words are read the same way from the other side. Each clue votes; the strongest wins, and a
 * pair like tao/mày fills in a side nobody named.
 */
export function detectAddress(lines: ChatLine[]): Address {
  const self = new Map<string, number>()
  const other = new Map<string, number>()
  let politeHits = 0
  let mineCount = 0
  for (const line of lines) {
    if (line.mine) {
      mineCount++
      if (/(^|\s)dạ(\s|$)|\sạ(\s|$)/u.test(` ${line.text.toLowerCase()} `)) politeHits++
    }
    for (const c of clauses(line.text)) {
      const { called, subject, closing, asked, objectOfCho } = readClause(c)
      // the subject of my statement is me; of my question or request, or a word that only means "you", is them
      const subjectIsListener = !!subject && (SECOND.has(subject) || asked)
      if (line.mine) {
        vote(other, called, 3)
        vote(other, closing, 2)
        vote(other, objectOfCho, 1)
        if (subject) vote(subjectIsListener ? other : self, subject, 2)
      } else {
        if (called) vote(self, SELF_OF_ADDRESS[called] ?? called, 3)
        if (closing) vote(self, SELF_OF_ADDRESS[closing] ?? closing, 1.5)
        if (subject) {
          if (subjectIsListener) vote(self, SELF_OF_ADDRESS[subject] ?? subject, 2)
          else vote(other, ADDRESS_OF_SELF[subject] ?? subject, 2)
        }
      }
    }
  }
  let s = top(self)
  let o = top(other, s)
  if (!o && s && PAIR[s]) o = PAIR[s]
  if (!s && o && PAIR[o]) s = PAIR[o]
  return { self: s, other: o, polite: mineCount > 0 && politeHits / mineCount >= 0.2 }
}

const EMOJI = /\p{Extended_Pictographic}/u
const PARTICLES = ['nhé', 'nha', 'ạ', 'á', 'nè', 'hen', 'ha', 'nhỉ', 'luôn', 'đó', 'hihi', 'haha', 'kk', 'ok']
/** Lines that are only an attachment's label ("[Ảnh]", "[Sticker]"), not words the user wrote. */
const LABEL = /^\[[^\]]+\]$/

/** How the user writes in this chat: length, emoji, particles, case, and a few real examples. */
export function styleOf(lines: ChatLine[]): Style {
  const mine = lines.filter((l) => l.mine && l.text.trim() && !LABEL.test(l.text.trim())).map((l) => l.text.trim())
  if (!mine.length) return { avgLength: 0, emoji: false, particles: [], lowercase: false, examples: [] }
  const counts = new Map<string, number>()
  for (const text of mine) for (const w of new Set(words(text))) if (PARTICLES.includes(w)) counts.set(w, (counts.get(w) ?? 0) + 1)
  const examples: string[] = []
  for (const text of [...mine].reverse()) {
    if (text.length < 3 || text.length > 120 || examples.includes(text)) continue
    examples.push(text)
    if (examples.length === 6) break
  }
  return {
    avgLength: Math.round(mine.reduce((n, t) => n + t.length, 0) / mine.length),
    emoji: mine.filter((t) => EMOJI.test(t)).length / mine.length >= 0.25,
    particles: [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w),
    lowercase: mine.filter((t) => /^\p{Ll}/u.test(t)).length / mine.length >= 0.6,
    examples: examples.reverse()
  }
}

const RULES: Array<[Intent, RegExp]> = [
  ['good_news', /(đậu|đỗ|trúng tuyển|được nhận|nhận việc|tăng lương|thăng chức|đám cưới|cưới rồi|cầu hôn|có em bé|có bầu|mang thai|sinh rồi|mẹ tròn con vuông|mua nhà|mua xe|tốt nghiệp|thắng|vô địch|thành công rồi|got the job|promoted|engaged|married|pregnant|passed|graduated|we won|good news)/i],
  ['bad_news', /(buồn quá|mệt quá|ốm|bệnh|nằm viện|cấp cứu|mất rồi|qua đời|chia tay|thất nghiệp|bị đuổi|nghỉ việc rồi|trượt|rớt|stress|căng thẳng|chán quá|khóc|tai nạn|sad|sick|tired|hospital|passed away|broke up|laid off|failed|bad news)/i],
  ['thanks', /(cảm ơn|cám ơn|thank)/i],
  ['apology', /(xin lỗi|sorry|my bad)/i],
  ['invite', /((^|\s)(đi|cùng|chung)\s.*(không|ko|k|hông)\s*\??\s*$|cà phê|lẩu|cafe|nhậu|xem phim|họp lớp|\brủ\b|\bhẹn\b|let'?s |wanna |shall we|up for)/i],
  ['request', /(giúp|nhờ|làm ơn|gửi .*(cho|giúp)|báo .* giúp|được không|đc không|could you|would you|please|can you (send|help|check|look|give|bring|share))/i],
  ['question', /(\?\s*$|\b(không|chưa|ko|hông)\s*$|\b(gì|nào|bao giờ|khi nào|mấy giờ|ở đâu|đâu|thế nào|ra sao|bao nhiêu|sao)\b|^(what|when|where|how|why|which|who|is|are|do|does|did|can)\b)/i],
  ['greeting', /^(chào|xin chào|hello|hi|hey|alo|ê|morning|chúc buổi sáng)\b/i]
]

/** `\b` only knows ASCII letters ("gì" ends in one it does not): the rules use a word edge that knows Vietnamese. */
const EDGE = String.raw`(?:(?<=[\p{L}\p{N}])(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]))`
const UNICODE_RULES: Array<[Intent, RegExp]> = RULES.map(([intent, re]) => [intent, new RegExp(re.source.split(String.raw`\b`).join(EDGE), 'iu')])

/** The kind of message from its words; undefined when nothing is clear (the model decides then). */
export function guessIntent(text: string): Intent | undefined {
  const t = text.trim()
  if (!t) return undefined
  return UNICODE_RULES.find(([, re]) => re.test(t))?.[0]
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Fill {self} {other} {Self} {Other}; a pronoun nobody knows is dropped and the sentence tidied around it. */
export function fillPronouns(template: string, address: Address): string {
  let t = template
  // a pronoun nobody knows goes, with the "ơi" that called it
  if (!address.other) t = t.replace(/\s*\{[oO]ther\} ơi/g, '').replace(/\s*\{[oO]ther\}/g, '')
  if (!address.self) t = t.replace(/\s*\{[sS]elf\}/g, '')
  return t
    .replace(/\{Self\}/g, cap(address.self ?? ''))
    .replace(/\{Other\}/g, cap(address.other ?? ''))
    .replace(/\{self\}/g, address.self ?? '')
    .replace(/\{other\}/g, address.other ?? '')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s]+/, '')
    .trim()
    .replace(/^\p{Ll}/u, (c) => c.toUpperCase())
}

const BANK: Record<'vi' | 'en', Record<Intent, string[]>> = {
  vi: {
    good_news: ['Chúc mừng {other} nhé! 🎉', 'Tuyệt quá {other} ơi, kể {self} nghe với', 'Vui quá, {self} mừng cho {other} lắm'],
    bad_news: ['{Other} ổn không, có cần {self} giúp gì không?', 'Thương {other} quá, nghỉ ngơi đi nhé', '{Self} ở đây nếu {other} muốn nói chuyện nha'],
    question: ['Để {self} xem rồi báo {other} nhé', 'Có nhé {other}', 'Chưa {other} ơi'],
    request: ['Ok để {self} làm ngay', '{Self} xem rồi báo {other} sau nhé', '{Other} cần gấp không?'],
    invite: ['Ok, {self} đi được nhé', 'Mấy giờ vậy {other}?', 'Hôm đó {self} bận mất rồi, hẹn {other} dịp khác nha'],
    thanks: ['Không có gì đâu {other} ơi', 'Có gì đâu, {other} cần gì cứ nói {self} nhé', 'Chuyện nhỏ mà {other}'],
    apology: ['Không sao đâu {other}', 'Ổn mà, {other} đừng lo', 'Không sao, {self} hiểu mà'],
    greeting: ['Chào {other}!', '{Other} khoẻ không?', 'Có chuyện gì vậy {other}?'],
    info: ['Ok {other} nhé', '{Self} biết rồi, cảm ơn {other}', 'Vậy hả {other}?']
  },
  en: {
    good_news: ['Congrats! 🎉', 'That is amazing, tell me more!', "So happy for you!"],
    bad_news: ['Are you okay? Anything I can do?', "I'm sorry, take care of yourself", "I'm here if you want to talk"],
    question: ['Let me check and get back to you', 'Yes, sure', 'Not yet'],
    request: ["Sure, I'll do it now", "I'll take a look and let you know", 'Do you need it soon?'],
    invite: ["I'm in!", 'What time?', "Can't make it that day, another time?"],
    thanks: ['No problem!', 'Anytime, just ask', 'Happy to help'],
    apology: ["It's okay", "Don't worry about it", 'No worries, I get it'],
    greeting: ['Hey!', 'How are you?', "What's up?"],
    info: ['Got it, thanks', 'Okay, noted', 'Oh really?']
  }
}

/** Ready-made replies for the kind of message, in the user's pronouns: always fluent, for models too small to write well. */
export function replyBank(intent: Intent, address: Address, language: 'vi' | 'en'): string[] {
  const out = BANK[language][intent].map((t) => (language === 'vi' ? fillPronouns(t, address) : t))
  // Polite writers open with "Dạ" (not on exclamations of joy).
  if (language === 'vi' && address.polite && intent !== 'good_news') out[0] = `Dạ ${out[0][0].toLowerCase()}${out[0].slice(1)}`.replace(/^Dạ (dạ )/i, 'Dạ ')
  return out
}

const VI_CHARS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i
const normal = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * The model's replies, kept only when they are usable: in the right language, not a copy of the message being
 * answered, not a name label or an explanation, distinct from each other, of a sane length.
 */
/** First- and second-person words only friends or strangers use; a reply using one the two do not use is speaking out of turn. */
// Family words are left out: they also name other people ("bố con bị ốm").
const PERSONAL = new Set(['bạn', 'cậu', 'mày', 'tao', 'tớ', 'tôi'])

/** Whether the text calls out to `who` ("Anh tới rồi em", "Em ơi, …"). */
function callsOut(text: string, who: string): boolean {
  const t = text.toLowerCase().trim()
  if (t.startsWith(`${who} ơi`)) return true
  return new RegExp(`(?:[,!]|\\s(?:rồi|nhé|nha|quá|đó|đấy|nè|thôi|đi|luôn|nữa))\\s+${who}(?:\\s+(?:ơi|nhé|nha|ạ))?\\s*[.!?…]*$`, 'u').test(t)
}

export function cleanReplies(candidates: string[], options: { answering?: string; language: 'vi' | 'en'; names?: string[]; address?: Address }): string[] {
  const out: string[] = []
  const answered = options.answering ? normal(options.answering) : ''
  for (const raw of candidates) {
    // a reply that came back as a little JSON object of its own: its text
    let unwrapped = raw
    if (/^\s*\{/.test(raw)) {
      try {
        const o = JSON.parse(raw) as Record<string, unknown>
        unwrapped = String(o.content ?? o.text ?? o.reply ?? o.message ?? '')
      } catch {
        unwrapped = raw.replace(/^\s*\{.*?"(?:content|text|reply|message)"\s*:\s*"([^"]*)".*$/s, '$1')
      }
    }
    let text = unwrapped
      // "[15:03] ", "15:03] "
      .replace(/^\s*\[?\d{1,2}:\d{2}\]?\s*/, '')
      .replace(/^\s*(?:[-–•*]|\d+[.)])\s*/, '')
      .replace(/^["“'`[(]+|["”'`\])]+$/g, '')
      .trim()
    // "Tôi: …", "Me: …", "Minh Anh: …"
    for (const label of ['Tôi', 'Me', ...(options.names ?? [])]) if (label && text.toLowerCase().startsWith(`${label.toLowerCase()}:`)) text = text.slice(label.length + 1).trim()
    // a stray "Dạ]" or "Tao]" left from a label
    text = text.replace(/^[^\s\]]{1,8}\]\s*/, '').trim()
    if (text.length < 2 || text.length > 140) continue
    // placeholders, punctuation first, another script, a JSON fragment
    if (/^(text|type|id|some text|reply|content)\s*\d*$/i.test(text) || /^[,.;:)\]}{[(]/.test(text) || /[\u3040-\u30ff\u4e00-\u9fff]/.test(text) || /^\{\d+\}/.test(text) || /"(content|role)"\s*:/.test(text)) continue
    if (/^(dưới đây|đây là|gợi ý|here are|suggestion|reply \d)/i.test(text)) continue
    // the model talking about its task instead of doing it ("**Option 1 (Agreement):**", "three responses for Sam")
    if (text.includes('*') || /\b(options? \d|responses?|replies)\b/i.test(text) || /phương án|câu trả lời/i.test(text)) continue
    const n = normal(text)
    if (!n || n === answered) continue
    const wordsCount = n.split(' ').length
    if (options.language === 'vi' && !VI_CHARS.test(text) && wordsCount >= 4 && /\b(the|you|is|are|and|to|it)\b/i.test(text)) continue
    if (options.language === 'en' && VI_CHARS.test(text)) continue
    if (out.some((o) => normal(o) === n)) continue
    // pronouns the two never use with each other ("bạn" between em and chị)
    const a = options.address
    if (options.language === 'vi' && a?.self && a.other && words(text).some((w) => PERSONAL.has(w) && w !== a.self && w !== a.other)) continue
    // calling out to the user's own pronoun ("Anh tới rồi em" when the user is em): written as the other person
    // ("gửi cho em" is fine: only a closing call after a pause or a particle counts)
    if (options.language === 'vi' && a?.self && a.self !== a.other && callsOut(text, a.self)) continue
    out.push(text)
  }
  return out.slice(0, 3)
}

/** The short profile the model reads before the chat. */
export function profileText(ctx: ChatContext, address: Address, style: Style, language: 'vi' | 'en'): string {
  const vi = language === 'vi'
  const out: string[] = []
  const me = ctx.me?.trim()
  const them = ctx.them?.trim()
  if (vi) {
    out.push(`Người dùng ("Tôi")${me ? ` tên ${me}` : ''}${them ? `, đang nhắn với ${ctx.isGroup ? `nhóm "${them}"` : them}` : ''}.`)
    if (ctx.tags?.length) out.push(`Quan hệ: ${ctx.tags.join(', ')}${ctx.closeFriend ? ', bạn thân' : ''}.`)
    else if (ctx.closeFriend) out.push('Quan hệ: bạn thân.')
    if (address.self || address.other)
      out.push(`Cách xưng hô: Tôi ${address.self ? `xưng "${address.self}"` : ''}${address.self && address.other ? ', ' : ''}${address.other ? `gọi người kia là "${address.other}"` : ''}. Giữ đúng cách xưng hô này.`)
    if (address.polite) out.push('Tôi nói chuyện lễ phép, hay mở đầu bằng "dạ" và kết bằng "ạ".')
    const traits = [style.avgLength ? (style.avgLength < 25 ? 'câu rất ngắn' : style.avgLength < 60 ? 'câu ngắn' : 'câu dài vừa') : '', style.emoji ? 'hay dùng emoji' : 'ít dùng emoji', style.particles.length ? `hay dùng "${style.particles.join('", "')}"` : '', style.lowercase ? 'thường viết thường đầu câu' : ''].filter(Boolean)
    if (style.avgLength) out.push(`Văn phong của Tôi: ${traits.join(', ')}.`)
    if (style.examples.length) out.push(`Vài tin Tôi từng gửi: ${style.examples.map((e) => `"${e}"`).join(' · ')}`)
    if (ctx.note?.trim()) out.push(`Ghi chú riêng của Tôi về người này: ${ctx.note.replace(/\s+/g, ' ').trim().slice(0, 300)}`)
    if (ctx.examples?.length)
      out.push(`Những lần Tôi trả lời tin tương tự. Viết đúng giọng này: viết hoa hay viết thường như Tôi, dùng từ đệm và emoji Tôi hay dùng, dài ngắn như Tôi; chỉ không chép nguyên câu:\n${ctx.examples.map((e) => `- Họ: ${e.them}\n  Tôi: ${e.me}`).join('\n')}`)
  } else {
    out.push(`The user ("Me")${me ? ` is ${me}` : ''}${them ? `, chatting with ${ctx.isGroup ? `the group "${them}"` : them}` : ''}.`)
    if (ctx.tags?.length || ctx.closeFriend) out.push(`Relationship: ${[...(ctx.tags ?? []), ...(ctx.closeFriend ? ['close friend'] : [])].join(', ')}.`)
    if (address.self || address.other) out.push(`In Vietnamese they address each other as: Me = "${address.self ?? '?'}", them = "${address.other ?? '?'}". Keep it.`)
    const traits = [style.avgLength ? (style.avgLength < 25 ? 'very short messages' : style.avgLength < 60 ? 'short messages' : 'medium messages') : '', style.emoji ? 'uses emoji' : 'rarely uses emoji', style.lowercase ? 'often starts lowercase' : ''].filter(Boolean)
    if (style.avgLength) out.push(`My style: ${traits.join(', ')}.`)
    if (style.examples.length) out.push(`Messages I sent before: ${style.examples.map((e) => `"${e}"`).join(' · ')}`)
    if (ctx.note?.trim()) out.push(`My private note about them: ${ctx.note.replace(/\s+/g, ' ').trim().slice(0, 300)}`)
    if (ctx.examples?.length)
      out.push(`How I answered similar messages before. Write in exactly this voice: same capitalisation, the fillers and emoji I use, the same length; just do not copy the sentences:\n${ctx.examples.map((e) => `- They: ${e.them}\n  Me: ${e.me}`).join('\n')}`)
  }
  return out.join('\n')
}
