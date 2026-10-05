/**
 * Summaries of a longer Vietnamese chat with a real model, to read by eye. Off by default, like ai-eval:
 *   MOSHI_AI_EVAL=path/to/model.gguf MOSHI_AI_REPORT=summary.md npx vitest run tests/ai-summary-eval.test.ts
 */
import { appendFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { parseSummary, summaryMessages, type ChatLine } from '../src/shared/ai-prompts'

const MODEL_PATH = process.env.MOSHI_AI_EVAL
const REPORT = process.env.MOSHI_AI_REPORT

const CHAT: Array<[mine: boolean, who: string, text: string]> = [
  [false, 'Chị Hạnh', 'Em ơi chị muốn lấy thêm 30 áo thun basic, 15 trắng 15 đen nha'],
  [true, 'Tôi', 'Dạ chị, size gì chị?'],
  [false, 'Chị Hạnh', 'Trắng size M 10 cái, L 5 cái. Đen thì L hết'],
  [true, 'Tôi', 'Dạ áo đen size L em chỉ còn 8 cái, thứ 6 mới về hàng chị ạ'],
  [false, 'Chị Hạnh', 'Vậy lấy 8 cái trước, 7 cái thứ 6 giao sau nha'],
  [true, 'Tôi', 'Dạ ok chị, giá sỉ 85k/cái, tổng 30 cái là 2tr550 ạ'],
  [false, 'Chị Hạnh', 'Bớt chị còn 80k đi em, chị lấy thường xuyên mà'],
  [true, 'Tôi', 'Dạ em để 82k nha chị, tổng 2tr460'],
  [false, 'Chị Hạnh', 'Ok em. Chị chuyển cọc 1 triệu trước, còn lại giao xong chị trả'],
  [false, 'Chị Hạnh', 'Giao về shop chị ở 45 Lê Lợi Q1 nhé, trước 5h chiều mai'],
  [true, 'Tôi', 'Dạ em nhận cọc rồi ạ. Mai em cho shipper giao trước 5h'],
  [false, 'Chị Hạnh', 'À mà có mẫu áo polo không em? Gửi chị xem hình với'],
  [true, 'Tôi', 'Dạ có, tối nay em chụp gửi chị nha']
]

describe.skipIf(!MODEL_PATH)('summaries', () => {
  it(
    'a Vietnamese order chat, in Vietnamese and in English',
    async () => {
      const lib = await import('node-llama-cpp')
      const llama = await lib.getLlama({ gpu: 'auto' })
      const model = await llama.loadModel({ modelPath: MODEL_PATH! })
      const context = await model.createContext({ contextSize: 4096 })
      const sequence = context.getSequence()
      const lines: ChatLine[] = CHAT.map(([mine, who, text], i) => ({ who, text, at: Date.parse('2026-10-04T08:00:00Z') + i * 60_000, mine }))
      for (const language of ['vi', 'en']) {
        await sequence.clearHistory()
        const messages = summaryMessages(lines, language)
        const session = new lib.LlamaChatSession({ contextSequence: sequence, systemPrompt: messages[0].content, autoDisposeSequence: false })
        const text = await session.prompt(messages[1].content, { maxTokens: 220, temperature: 0.6, topP: 0.9, budgets: { thoughtTokens: 0 } })
        session.dispose({ disposeSequence: false })
        if (REPORT) appendFileSync(REPORT, `--- ${language}\n${parseSummary(text).join('\n')}\n`)
      }
      await context.dispose()
      await model.dispose()
      expect(true).toBe(true)
    },
    10 * 60_000
  )
})
