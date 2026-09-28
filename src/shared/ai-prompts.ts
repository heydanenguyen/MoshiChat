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
    ? 'Bạn là trợ lý tóm tắt tin nhắn. Đọc đoạn chat và tóm tắt bằng tiếng Việt thành 3 đến 5 gạch đầu dòng ngắn, mỗi dòng bắt đầu bằng "- ". Nêu ai nói gì, quyết định, thời gian, địa điểm và việc cần làm nếu có. Không thêm lời dẫn, không nhận xét, không lặp lại nguyên văn.'
    : 'You summarise chat messages. Read the chat and summarise it in English as 3 to 5 short bullet points, each starting with "- ". Say who said what, any decisions, times, places and to-dos. No preamble, no commentary, no verbatim quotes.'
  return [
    { role: 'system', content: system },
    { role: 'user', content: transcript(lines, language) }
  ]
}

export function suggestMessages(lines: ChatLine[], language: string): ChatMessage[] {
  const vi = language === 'vi'
  const system = vi
    ? 'Bạn giúp người dùng ("Tôi") trả lời tin nhắn. Dựa vào đoạn chat, viết đúng 3 câu trả lời ngắn (dưới 12 từ) cho tin nhắn cuối cùng, cùng giọng điệu và ngôn ngữ với đoạn chat, khác nhau về ý (đồng ý, hỏi lại, từ chối khéo hoặc đùa). Mỗi câu một dòng, không đánh số, không giải thích, không dấu ngoặc kép.'
    : 'You help the user ("Me") reply to messages. From the chat, write exactly 3 short replies (under 12 words) to the last message, in the same tone and language as the chat, differing in intent (agree, ask back, politely decline or joke). One per line, no numbering, no explanation, no quotes.'
  return [
    { role: 'system', content: system },
    { role: 'user', content: transcript(lines.slice(-12), language) }
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
