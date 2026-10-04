/**
 * Do the user's own earlier replies change the suggestions? A made-up user with habits that are easy to see
 * (writes in lower case, "nha", "hihi", 🥰), on every Vietnamese fixture, with and without the examples.
 * Off by default, like ai-eval. Run with:
 *   MOSHI_AI_EVAL=path/to/model.gguf MOSHI_AI_MODEL=qwen35-4b MOSHI_AI_REPORT=style.md npx vitest run tests/ai-style-eval.test.ts
 */
import { writeFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import type { ChatModel } from '../src/shared/ai'
import type { ChatLine, ChatMessage } from '../src/shared/ai-prompts'
import { suggestReplies } from '../src/shared/ai-suggest'
import { FIXTURES } from './fixtures/ai-chats'

const MODEL_PATH = process.env.MOSHI_AI_EVAL
const MODEL = (process.env.MOSHI_AI_MODEL ?? 'qwen35-4b') as ChatModel
const REPORT = process.env.MOSHI_AI_REPORT

/** How this user answers, in the pronouns of the chat at hand. */
function persona(self: string, other: string): Array<{ them: string; me: string }> {
  return [
    { them: 'Mai rảnh không?', me: `mai ${self} rảnh nha ${other} ơi hihi` },
    { them: 'Cảm ơn nhé', me: `có gì đâu ${other} 🥰` },
    { them: 'Xong chưa?', me: `${self} xong rồi nha, gửi ${other} liền 🥰` }
  ]
}

const MARKERS = /\bnha\b|hihi|🥰/u
const styled = (r: string): boolean => MARKERS.test(r) || /^\p{Ll}/u.test(r)

describe.skipIf(!MODEL_PATH)('suggestions in the user’s own voice', () => {
  it(
    'with and without examples',
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
      const total = { without: 0, with: 0, count: 0 }
      for (const f of FIXTURES.filter((f) => f.expect.self && f.expect.other && !f.id.startsWith('en-'))) {
        const lines: ChatLine[] = f.lines.map(([mine, text], i) => ({ who: mine ? 'Tôi' : (f.context.them ?? 'Họ'), text, at: Date.parse('2026-10-04T08:00:00Z') + i * 60_000, mine }))
        const plain = await suggestReplies(lines, { context: f.context, appLanguage: 'vi', replyLanguage: 'vi', model: MODEL }, ask)
        const voiced = await suggestReplies(lines, { context: { ...f.context, examples: persona(f.expect.self!, f.expect.other!) }, appLanguage: 'vi', replyLanguage: 'vi', model: MODEL }, ask)
        const a = plain.written.filter(styled).length
        const b = voiced.written.filter(styled).length
        total.without += a
        total.with += b
        total.count++
        rows.push(`### ${f.id}\n\n| Không có câu mẫu | Có câu mẫu |\n|---|---|\n` + [0, 1, 2].map((i) => `| ${plain.replies[i] ?? ''} | ${voiced.replies[i] ?? ''} |`).join('\n') + `\n\nĐúng giọng: ${a} → ${b}\n`)
      }
      const head = `# Gợi ý theo giọng người dùng (${MODEL}, ${total.count} đoạn chat)\n\nCâu mang dấu hiệu giọng của người dùng (viết thường, "nha", "hihi", 🥰): không có câu mẫu ${total.without}, có câu mẫu ${total.with}.\n\n`
      if (REPORT) writeFileSync(REPORT, head + rows.join('\n'))
      await context.dispose()
      await model.dispose()
      expect(total.count).toBeGreaterThan(0)
    },
    20 * 60_000
  )
})
