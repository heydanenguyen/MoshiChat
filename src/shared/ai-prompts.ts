/**
 * Prompts and parsers for the small on-device chat model (summaries, reply suggestions). Kept apart from
 * the worker so they are unit-tested and the same on every platform.
 */

export interface ChatLine {
  who: string
  text: string
  /** ms since epoch */
  at: number
  mine?: boolean
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** The model reads at most this many lines; older ones are dropped first. */
export const MAX_LINES = 60
const MAX_CHARS = 240

const clock = (at: number): string => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "[09:41] Lan: text" lines, newest last, each cut to a sane length. */
export function transcript(lines: ChatLine[], language: string): string {
  const me = language === 'vi' ? 'Tôi' : 'Me'
  return lines
    .slice(-MAX_LINES)
    .map((l) => {
      const text = l.text.replace(/\s+/g, ' ').trim()
      const cut = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text
      return `[${clock(l.at)}] ${l.mine ? me : l.who}: ${cut}`
    })
    .join('\n')
}

export function summaryMessages(lines: ChatLine[], language: string): ChatMessage[] {
  const vi = language === 'vi'
  const system = vi
    ? 'Bạn là trợ lý tóm tắt tin nhắn. Đọc đoạn chat và tóm tắt bằng tiếng Việt thành 2 đến 5 gạch đầu dòng ngắn, mỗi dòng bắt đầu bằng "- ", mỗi dòng một ý, xếp theo thứ tự thời gian. Ưu tiên: quyết định đã chốt, thời gian, địa điểm, số tiền, việc ai phải làm, câu hỏi còn chờ trả lời. Chỉ dùng thông tin có trong đoạn chat; ít thông tin thì viết ít dòng. Chép đúng con số, số lượng, giá, giờ, địa chỉ như trong tin nhắn; không tự cộng, trừ hay suy ra con số mới. Khi kế hoạch đổi giữa chừng (giá bớt, giao làm hai lần…), ghi phương án cuối cùng và đủ các phần của nó. "Tôi" là người dùng: viết là "bạn". Không thêm lời dẫn, không nhận xét, không lặp lại nguyên văn.\nVí dụ:\n- Lan hẹn họp 15:00 mai ở phòng 2, nhớ mang laptop\n- Nam hỏi ngân sách tháng 10, chưa ai trả lời'
    : 'You summarise chat messages. Read the chat and summarise it in English as 2 to 5 short bullet points, each starting with "- ", one idea per line, in time order. Prefer: decisions made, times, places, amounts, who has to do what, questions still waiting for an answer. Use only what is in the chat; fewer lines when there is little to say. Copy numbers, quantities, prices, times and addresses exactly as written; never add, subtract or work out new figures. When a plan changes along the way (a lower price, delivery in two parts…), give the final version with all its parts. "Me" is the user: write "you". No preamble, no commentary, no verbatim quotes.\nExample:\n- Lan set a meeting for 15:00 tomorrow in room 2, bring a laptop\n- Nam asked about the October budget, nobody has answered yet'
  return [
    { role: 'system', content: system },
    { role: 'user', content: transcript(lines, language) }
  ]
}

/**
 * `replyLanguage`: what the replies are written in. 'auto' follows the message being answered
 * (the model is told to match it), 'vi' / 'en' force a language.
 */
export function suggestMessages(lines: ChatLine[], language: string, replyLanguage: 'auto' | 'vi' | 'en' = 'auto'): ChatMessage[] {
  const vi = language === 'vi'
  const langRule = vi
    ? replyLanguage === 'vi'
      ? 'Viết bằng tiếng Việt.'
      : replyLanguage === 'en'
        ? 'Viết bằng tiếng Anh.'
        : 'Viết đúng ngôn ngữ của tin nhắn cần trả lời (tin nhắn tiếng Anh thì trả lời tiếng Anh).'
    : replyLanguage === 'vi'
      ? 'Write in Vietnamese.'
      : replyLanguage === 'en'
        ? 'Write in English.'
        : 'Write in the language of the message being answered (a Vietnamese message gets Vietnamese replies).'
  const system = vi
    ? `Bạn giúp người dùng ("Tôi") trả lời tin nhắn. Viết đúng 3 câu trả lời ngắn (dưới 12 từ) cho tin nhắn cần trả lời, như chính "Tôi" đang nhắn: tự nhiên, cùng giọng điệu với đoạn chat, xưng hô giống "Tôi" đã dùng. Ba câu khác nhau về ý: một câu đồng ý hoặc xác nhận, một câu hỏi lại cho rõ, một câu từ chối khéo hoặc đùa nhẹ. ${langRule} Mỗi câu một dòng, không đánh số, không giải thích, không dấu ngoặc kép, không emoji.\nVí dụ với tin "Mai họp 3h nhé":\nOk mai 3h em có mặt\n3h ở phòng nào vậy anh?\nMai em kẹt rồi, dời 4h được không?`
    : `You help the user ("Me") reply to messages. Write exactly 3 short replies (under 12 words) to the message being answered, as "Me" would: natural, same tone as the chat. Make them differ in intent: one agrees or confirms, one asks back for a detail, one politely declines or jokes lightly. ${langRule} One per line, no numbering, no explanation, no quotes, no emoji.\nExample for "Meeting at 3 tomorrow?":\nSure, 3 works for me\nWhich room are we in?\nTomorrow is packed, could we do 4?`
  const recent = lines.slice(-12)
  const last = [...recent].reverse().find((l) => !l.mine) ?? recent.at(-1)
  const label = vi ? 'Tin nhắn cần trả lời' : 'Message to answer'
  const user = last ? `${transcript(recent, language)}\n\n${label}: ${last.who}: ${last.text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)}` : transcript(recent, language)
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

/**
 * Three ways to pick a chat back up with a friend after `silentDays` of quiet, written as "Me" from the
 * older lines (how you address each other, what you last talked about). Parsed like suggestions.
 */
export function openerMessages(lines: ChatLine[], language: string, silentDays: number, replyLanguage: 'auto' | 'vi' | 'en' = 'auto', note?: string): ChatMessage[] {
  const vi = language === 'vi'
  const langRule = vi
    ? replyLanguage === 'vi'
      ? 'Viết bằng tiếng Việt.'
      : replyLanguage === 'en'
        ? 'Viết bằng tiếng Anh.'
        : 'Viết đúng ngôn ngữ của đoạn chat.'
    : replyLanguage === 'vi'
      ? 'Write in Vietnamese.'
      : replyLanguage === 'en'
        ? 'Write in English.'
        : 'Write in the language of the chat.'
  const system = vi
    ? `Bạn giúp người dùng ("Tôi") nhắn lại cho một người thân đã lâu không nói chuyện. Đọc đoạn chat cũ để biết hai người xưng hô thế nào và lần trước nói chuyện gì. Viết đúng 3 tin nhắn mở lời ngắn (dưới 15 từ), như chính "Tôi" đang nhắn: tự nhiên, ấm áp, không sến, xưng hô giống "Tôi" đã dùng. Ba câu khác nhau về ý: một câu hỏi thăm dạo này thế nào, một câu nhắc lại chuyện gần nhất trong đoạn chat, một câu rủ gặp hoặc đùa nhẹ. ${langRule} Mỗi câu một dòng, không đánh số, không giải thích, không dấu ngoặc kép, không emoji.\nVí dụ:\nDạo này sao rồi, lâu quá không nghe tin\nVụ chuyển nhà xong xuôi chưa?\nCuối tuần cà phê không, lâu rồi chưa gặp`
    : `You help the user ("Me") write to a close friend they have not talked to in a while. Read the older chat to see how they address each other and what they last talked about. Write exactly 3 short openers (under 15 words), as "Me" would: natural, warm, not cheesy. Make them differ: one asks how they have been, one picks up the last thing from the chat, one suggests meeting up or jokes lightly. ${langRule} One per line, no numbering, no explanation, no quotes, no emoji.\nExample:\nHey, how have you been? It has been ages\nDid the move go okay in the end?\nCoffee this weekend? Long overdue`
  const gap = vi ? `(Lần cuối nói chuyện: ${silentDays} ngày trước)` : `(Last talked: ${silentDays} days ago)`
  const recent = lines.slice(-12)
  // Your own note about them ("just moved to Đà Nẵng") is often the best thing to pick up on.
  const clean = note?.replace(/\s+/g, ' ').trim().slice(0, 300)
  const noteLine = clean ? `\n${vi ? 'Ghi chú của Tôi về người này' : 'My note about them'}: ${clean}` : ''
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${recent.length ? `${transcript(recent, language)}\n\n` : ''}${gap}${noteLine}` }
  ]
}

const strip = (line: string): string =>
  line
    .replace(/^\s*(?:[-–•*]|\d+[.)]|[a-c][.)])\s*/i, '')
    .replace(/^["“'`]+|["”'`]+$/g, '')
    .trim()

/** Bullet lines out of the model's answer; falls back to sentences when it wrote prose. */
export function parseSummary(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map(strip)
    .filter((l) => l.length > 1)
  if (lines.length >= 2) return lines.slice(0, 6)
  return (text.match(/[^.!?。\n]+[.!?。]?/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 5)
}

/** Up to three distinct short replies out of the model's answer. */
export function parseSuggestions(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = strip(raw)
    if (!line || line.length > 80 || /^(here are|dưới đây|gợi ý|suggestion)/i.test(line)) continue
    if (out.some((o) => o.toLowerCase() === line.toLowerCase())) continue
    out.push(line)
    if (out.length === 3) break
  }
  return out
}

// ================================================================== replies with context (llama.cpp models)

import { INTENTS, profileText, type Address, type ChatContext, type Intent, type Style } from './ai-context'

/** "Name: text" lines without clocks, for writing replies: with "[09:41]" in front the model copies the format. */
export function chatLines(lines: ChatLine[], language: string): string {
  const me = language === 'vi' ? 'Tôi' : 'Me'
  return lines
    .slice(-MAX_LINES)
    .map((l) => {
      const text = l.text.replace(/\s+/g, ' ').trim()
      return `${l.mine ? me : l.who}: ${text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text}`
    })
    .join('\n')
}

/** The model's replies, one a line; when it ran them together on one line, one a sentence. */
export function splitReplies(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length >= 3) return lines
  return lines.flatMap((l) => l.split(/(?<=[.!?…])\s+(?=\p{Lu})/u)).map((l) => l.trim()).filter(Boolean)
}

/**
 * The personal voice's prompt: one reply, the user's next message in the chat. The very same shape is used to
 * train the LoRA (tools/voice-lora) and to ask it, so it sees exactly what it learned on.
 */
export const VOICE_SYSTEM = 'Bạn là Tôi. Viết tin nhắn tiếp theo Tôi gửi trong đoạn chat, đúng giọng của Tôi. Chỉ viết nội dung tin.'

export function voiceMessages(lines: Array<{ mine?: boolean; text: string }>): ChatMessage[] {
  const chat = lines
    .slice(-6)
    .map((l) => `${l.mine ? 'Tôi' : 'Họ'}: ${l.text.replace(/\s+/g, ' ').trim().slice(0, 300)}`)
    .join('\n')
  return [
    { role: 'system', content: VOICE_SYSTEM },
    { role: 'user', content: chat }
  ]
}

/** Exactly three short replies, as JSON (llama.cpp keeps the model inside this shape). */
export const REPLIES_SCHEMA = {
  type: 'object',
  properties: { replies: { type: 'array', items: { type: 'string', minLength: 2, maxLength: 110 }, minItems: 3, maxItems: 3 } }
} as const

/** One kind of message, as JSON. */
export const INTENT_SCHEMA = { type: 'object', properties: { intent: { enum: INTENTS } } } as const

const INTENT_RULE: Record<'vi' | 'en', Record<Intent, string>> = {
  vi: {
    good_news: 'Người kia vừa khoe tin vui. Cả 3 câu chúc mừng thật lòng và vui cùng họ; ít nhất 2 câu hỏi thêm về chuyện đó (chi tiết, cảm xúc, ăn mừng). Đừng lái sang chuyện khác.',
    bad_news: 'Người kia đang buồn hoặc gặp chuyện. Hỏi han, an ủi nhẹ nhàng, đề nghị giúp; không khuyên dạy, không đùa.',
    question: 'Đây là câu hỏi. Một câu trả lời có hoặc đồng ý, một câu trả lời không hoặc chưa, một câu hỏi lại cho rõ.',
    request: 'Người kia nhờ việc. Một câu nhận làm ngay, một câu hẹn thời gian cụ thể, một câu hỏi thêm chi tiết cần thiết.',
    invite: 'Người kia rủ đi đâu hoặc làm gì. Một câu nhận lời hào hứng, một câu hỏi giờ hoặc địa điểm, một câu từ chối khéo kèm hẹn dịp khác.',
    thanks: 'Người kia cảm ơn. Đáp lại nhẹ nhàng, tự nhiên, có thể mời họ cứ nhờ tiếp.',
    apology: 'Người kia xin lỗi. Bỏ qua nhẹ nhàng, cho họ yên tâm.',
    greeting: 'Người kia chào hỏi. Chào lại tự nhiên và mở chuyện.',
    info: 'Một câu xác nhận đã biết, một câu hỏi thêm, một câu nói tiếp chuyện.'
  },
  en: {
    good_news: 'They just shared good news. All 3 replies congratulate them warmly; at least 2 ask more about it (details, how they feel, celebrating). Do not change the subject.',
    bad_news: 'They are upset or going through something. Check in, comfort gently, offer help; no lecturing, no jokes.',
    question: 'This is a question. One reply says yes or agrees, one says no or not yet, one asks back for a detail.',
    request: 'They are asking for something. One reply agrees to do it now, one gives a concrete time, one asks for a needed detail.',
    invite: 'They are inviting you. One reply accepts eagerly, one asks when or where, one declines kindly and suggests another time.',
    thanks: 'They are thanking you. Answer lightly and naturally.',
    apology: 'They are apologising. Let it go kindly and reassure them.',
    greeting: 'They are saying hi. Greet back naturally and open a chat.',
    info: 'One reply acknowledges it, one asks more, one keeps the conversation going.'
  }
}

/** What kind of message is being answered, for when the words alone do not tell. */
export function classifyMessages(text: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'Classify the chat message by what it asks of the reader. good_news: sharing something happy that happened. bad_news: sharing something sad, a worry or a problem. question: asking for information. request: asking the reader to do something. invite: suggesting to meet or do something together. thanks: thanking. apology: apologising. greeting: only a hello with nothing else. info: telling something, a status update, a memory, anything else.'
    },
    { role: 'user', content: text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS) }
  ]
}

/**
 * Three replies to the newest message, written as the user: told who they are talking to, how they address each
 * other, how the user writes, and what kind of message it is. Returns JSON (REPLIES_SCHEMA).
 */
export function replyMessages(lines: ChatLine[], language: string, replyLanguage: 'vi' | 'en', context: ChatContext, address: Address, style: Style, intent: Intent): ChatMessage[] {
  const vi = language === 'vi'
  const writeIn = replyLanguage === 'vi' ? (vi ? 'Viết bằng tiếng Việt.' : 'Write in Vietnamese.') : vi ? 'Viết bằng tiếng Anh.' : 'Write in English.'
  const system = vi
    ? `Bạn viết sẵn câu trả lời tin nhắn giúp người dùng ("Tôi"), như chính Tôi đang gõ. Viết 3 câu ngắn (dưới 20 từ), tự nhiên như người Việt nhắn tin hằng ngày, đúng cách xưng hô và văn phong của Tôi trong hồ sơ. ${INTENT_RULE.vi[intent]} Ba câu phải khác hướng nhau. Mỗi câu chỉ là nội dung tin nhắn: không kèm tên người gửi, không kèm giờ, không giải thích. Không lặp lại tin của người kia. ${writeIn} Trả lời đúng 3 dòng, mỗi dòng một câu, không đánh số.`
    : `You draft replies for the user ("Me"), as if Me were typing. Write 3 short replies (under 20 words), natural like everyday texting, matching how Me addresses them and Me's style in the profile. ${INTENT_RULE.en[intent]} The three must go in different directions. Each reply is only the message text: no sender name, no time, no explanation. Do not repeat their message. ${writeIn} Answer with exactly 3 lines, one reply per line, no numbering.`
  const recent = lines.slice(-12)
  const answering = [...recent].reverse().find((l) => !l.mine) ?? recent.at(-1)
  const profile = profileText(context, address, style, vi ? 'vi' : 'en')
  const label = vi ? 'Tin cần trả lời' : 'Message to answer'
  const chatLabel = vi ? 'Đoạn chat' : 'Chat'
  // who is writing to whom, said last: small models otherwise answer as the other person
  const ask = answering && !answering.mine ? (vi ? `\n\nViết 3 tin Tôi nhắn lại cho ${answering.who}, mỗi tin một dòng:` : `\n\nWrite 3 messages Me sends back to ${answering.who}, one per line:`) : ''
  const user = `${profile}\n\n${chatLabel}:\n${chatLines(recent, language)}${answering ? `\n\n${label}: ${answering.who}: ${answering.text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)}` : ''}${ask}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

/** Openers with the same profile (pronouns, style, the user's note), as JSON (REPLIES_SCHEMA). */
export function openerWithContext(lines: ChatLine[], language: string, silentDays: number, replyLanguage: 'vi' | 'en', context: ChatContext, address: Address, style: Style): ChatMessage[] {
  const vi = language === 'vi'
  const writeIn = replyLanguage === 'vi' ? (vi ? 'Viết bằng tiếng Việt.' : 'Write in Vietnamese.') : vi ? 'Viết bằng tiếng Anh.' : 'Write in English.'
  const system = vi
    ? `Bạn giúp người dùng ("Tôi") nhắn lại cho một người đã lâu không nói chuyện (${silentDays} ngày). Viết 3 tin mở lời ngắn (dưới 20 từ), như chính Tôi đang gõ: ấm áp, tự nhiên, không sến, đúng cách xưng hô và văn phong trong hồ sơ. Ba câu khác nhau: một câu hỏi thăm dạo này thế nào, một câu nhắc lại chuyện cụ thể (từ ghi chú hoặc lần nói chuyện trước), một câu rủ gặp hoặc đùa nhẹ. Chỉ viết nội dung tin, không kèm tên hay giờ. ${writeIn} Trả lời đúng 3 dòng, mỗi dòng một câu, không đánh số.`
    : `You help the user ("Me") write to someone they have not talked to in ${silentDays} days. Write 3 short openers (under 20 words) as Me would type them: warm, natural, not cheesy, matching Me's pronouns and style in the profile. Make them differ: one asks how they have been, one picks up something specific (from the note or the last chat), one suggests meeting up or jokes lightly. Only the message text, no name or time. ${writeIn} Answer with exactly 3 lines, one per line, no numbering.`
  const recent = lines.slice(-12)
  const profile = profileText(context, address, style, vi ? 'vi' : 'en')
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${profile}${recent.length ? `\n\n${vi ? 'Lần nói chuyện trước' : 'Last time'}:\n${chatLines(recent, language)}` : ''}` }
  ]
}

/**
 * The model's JSON, read forgivingly: llama.cpp sometimes hands the text back without the opening brace the grammar
 * made it write, or with stray text around it.
 */
export function parseJsonLoose<T>(text: string): T {
  const t = text.trim()
  const tries = [t, `{${t}`, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)]
  for (const candidate of tries) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      /* next */
    }
  }
  throw new Error('The model did not answer in JSON')
}
