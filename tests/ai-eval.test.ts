/**
 * Reply suggestions on the fixture chats with a real model, old prompt against new, scored and written to a report.
 * Off by default (it needs a downloaded GGUF and a minute or two). Run it with:
 *   MOSHI_AI_EVAL=path/to/Qwen3.5-4B-Q4_K_M.gguf MOSHI_AI_MODEL=qwen35-4b MOSHI_AI_REPORT=report.md npx vitest run tests/ai-eval.test.ts
 */
import { writeFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import type { ChatModel } from '../src/shared/ai'
import { detectLanguage } from '../src/shared/ai'
import { parseSuggestions, suggestMessages, type ChatLine, type ChatMessage } from '../src/shared/ai-prompts'
import { suggestReplies } from '../src/shared/ai-suggest'
import { FIXTURES } from './fixtures/ai-chats'

const MODEL_PATH = process.env.MOSHI_AI_EVAL
const MODEL = (process.env.MOSHI_AI_MODEL ?? 'qwen35-4b') as ChatModel
const REPORT = process.env.MOSHI_AI_REPORT

/** Pronouns that, in a reply, show which way the user is addressing the other person. */
// family words also name other people ("bố con bị ốm"), so only these count as a slip
const KIN = new Set(['bạn', 'cậu', 'mày', 'tao', 'tớ', 'tôi'])
const wordsOf = (t: string): string[] => t.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)

interface Score {
  pronounSlips: number
  wrongLanguage: number
  duplicates: number
}

function score(replies: string[], expect: { self?: string; other?: string }, language: 'vi' | 'en'): Score {
  let pronounSlips = 0
  let wrongLanguage = 0
  for (const r of replies) {
    if (language === 'vi' && (expect.self || expect.other)) {
      const allowed = new Set([expect.self, expect.other].filter(Boolean))
      if (wordsOf(r).some((w) => KIN.has(w) && !allowed.has(w))) pronounSlips++
    }
    const lang = detectLanguage(r)
    if ((language === 'vi' && lang === 'en' && wordsOf(r).length > 3) || (language === 'en' && lang === 'vi')) wrongLanguage++
  }
  const duplicates = replies.length - new Set(replies.map((r) => r.toLowerCase())).size
  return { pronounSlips, wrongLanguage, duplicates }
}

describe.skipIf(!MODEL_PATH)('reply suggestions with a real model', () => {
  it(
    'old prompt against new, on every fixture',
    async () => {
      const lib = await import('node-llama-cpp')
      const llama = await lib.getLlama({ gpu: 'auto' })
      const model = await llama.loadModel({ modelPath: MODEL_PATH! })
      const context = await model.createContext({ contextSize: 4096 })
      const sequence = context.getSequence()
      const ask = async (messages: ChatMessage[], schema: unknown, maxTokens: number): Promise<string> => {
        await sequence.clearHistory()
        const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
        const session = new lib.LlamaChatSession({ contextSequence: sequence, systemPrompt: system || undefined, autoDisposeSequence: false })
        const grammar = schema ? await llama.createGrammarForJsonSchema(schema as never) : undefined
        const text = await session.prompt(messages.at(-1)!.content, { maxTokens, temperature: 0.6, topP: 0.9, repeatPenalty: { penalty: 1.08 }, budgets: { thoughtTokens: 0 }, ...(grammar ? { grammar } : {}) })
        session.dispose({ disposeSequence: false })
        return text.trim()
      }

      const rows: string[] = []
      const totals = { old: { pronounSlips: 0, wrongLanguage: 0, duplicates: 0, count: 0 }, now: { pronounSlips: 0, wrongLanguage: 0, duplicates: 0, count: 0, intentRight: 0, fromModel: 0 } }
      for (const f of FIXTURES) {
        const lines: ChatLine[] = f.lines.map(([mine, text], i) => ({ who: mine ? 'Tôi' : (f.context.them ?? 'Họ'), text, at: Date.parse('2026-10-04T08:00:00Z') + i * 60_000, mine }))
        const language: 'vi' | 'en' = detectLanguage(lines.at(-1)!.text) === 'en' ? 'en' : 'vi'
        const t0 = Date.now()
        const old = parseSuggestions(await ask(suggestMessages(lines, 'vi', 'auto'), undefined, 60))
        const t1 = Date.now()
        const now = await suggestReplies(lines, { context: f.context, appLanguage: 'vi', replyLanguage: language, model: MODEL }, ask)
        const t2 = Date.now()
        const so = score(old, f.expect, language)
        const sn = score(now.replies, f.expect, language)
        for (const k of ['pronounSlips', 'wrongLanguage', 'duplicates'] as const) {
          totals.old[k] += so[k]
          totals.now[k] += sn[k]
        }
        totals.old.count += old.length
        totals.now.count += now.replies.length
        if (now.intent === f.expect.intent) totals.now.intentRight++
        totals.now.fromModel += now.written.length
        rows.push(
          `### ${f.id}\n` +
            f.lines.map(([mine, text]) => `> ${mine ? 'Tôi' : (f.context.them ?? 'Họ')}: ${text}`).join('  \n') +
            `\n\nXưng hô đoán: Tôi "${now.address.self ?? '?'}", gọi "${now.address.other ?? '?'}"${now.address.polite ? ', lễ phép' : ''} · loại tin: ${now.intent} (${now.intentBy})${now.intent === f.expect.intent ? '' : ` ✗ đúng ra ${f.expect.intent}`}\n\n` +
            `| Trước (${t1 - t0} ms) | Sau (${t2 - t1} ms) |\n|---|---|\n` +
            [0, 1, 2].map((i) => `| ${old[i] ?? ''} | ${now.replies[i] ?? ''}${now.written.includes(now.replies[i]) ? '' : now.replies[i] ? ' *(soạn sẵn)*' : ''} |`).join('\n') +
            `\n\nLỗi: trước ${so.pronounSlips} xưng hô, ${so.wrongLanguage} ngôn ngữ · sau ${sn.pronounSlips} xưng hô, ${sn.wrongLanguage} ngôn ngữ\n`
        )
      }
      const summary =
        `# Gợi ý trả lời: trước và sau (${MODEL}, ${FIXTURES.length} đoạn chat)\n\n` +
        `| | Trước | Sau |\n|---|---|---|\n` +
        `| Gợi ý có được | ${totals.old.count} | ${totals.now.count} |\n` +
        `| Câu sai xưng hô | ${totals.old.pronounSlips} | ${totals.now.pronounSlips} |\n` +
        `| Câu sai ngôn ngữ | ${totals.old.wrongLanguage} | ${totals.now.wrongLanguage} |\n` +
        `| Câu trùng | ${totals.old.duplicates} | ${totals.now.duplicates} |\n` +
        `| Đoán đúng loại tin | – | ${totals.now.intentRight}/${FIXTURES.length} |\n` +
        `| Câu do mô hình viết (còn lại là soạn sẵn) | – | ${totals.now.fromModel} |\n\n`
      if (REPORT) writeFileSync(REPORT, summary + rows.join('\n'))
      await context.dispose()
      await model.dispose()
      expect(totals.now.count).toBeGreaterThan(0)
    },
    15 * 60_000
  )
})
