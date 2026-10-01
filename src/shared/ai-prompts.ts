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
    ? 'Bạn là trợ lý tóm tắt tin nhắn. Đọc đoạn chat và tóm tắt bằng tiếng Việt thành 2 đến 5 gạch đầu dòng ngắn, mỗi dòng bắt đầu bằng "- ", mỗi dòng một ý, xếp theo thứ tự thời gian. Ưu tiên: quyết định đã chốt, thời gian, địa điểm, số tiền, việc ai phải làm, câu hỏi còn chờ trả lời. Chỉ dùng thông tin có trong đoạn chat; ít thông tin thì viết ít dòng. Không thêm lời dẫn, không nhận xét, không lặp lại nguyên văn.\nVí dụ:\n- Lan hẹn họp 15:00 mai ở phòng 2, nhớ mang laptop\n- Nam hỏi ngân sách tháng 10, chưa ai trả lời'
    : 'You summarise chat messages. Read the chat and summarise it in English as 2 to 5 short bullet points, each starting with "- ", one idea per line, in time order. Prefer: decisions made, times, places, amounts, who has to do what, questions still waiting for an answer. Use only what is in the chat; fewer lines when there is little to say. No preamble, no commentary, no verbatim quotes.\nExample:\n- Lan set a meeting for 15:00 tomorrow in room 2, bring a laptop\n- Nam asked about the October budget, nobody has answered yet'
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
