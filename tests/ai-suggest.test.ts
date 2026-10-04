import { describe, expect, it } from 'vitest'
import { VOICE_SYSTEM, type ChatLine } from '../src/shared/ai-prompts'
import { suggestReplies, type Ask } from '../src/shared/ai-suggest'

const lines: ChatLine[] = [
  { who: 'Tôi', text: 'Mẹ ơi con gửi tiền rồi nha', at: 0, mine: true },
  { who: 'Mẹ', text: 'Tối nay con có về ăn cơm không?', at: 60_000, mine: false }
]
const options = { context: { them: 'Mẹ' }, appLanguage: 'vi', replyLanguage: 'vi' as const, model: 'qwen35-4b' as const }

describe('suggestReplies with a personal voice', () => {
  it('asks the voice three times in its own format and keeps its replies', async () => {
    const calls: Array<{ system: string; voice?: boolean }> = []
    const voiced = ['dạ có nha mẹ hihi', 'con về liền nha mẹ 🥰', 'tối con về trễ xíu nha mẹ']
    const ask: Ask = async (messages, _schema, _max, opts) => {
      calls.push({ system: messages[0].content, voice: opts?.voice })
      return opts?.voice ? voiced[calls.filter((c) => c.voice).length - 1] : 'Dạ con về ạ\nCon chưa biết ạ\nĐể con xem nhé'
    }
    const result = await suggestReplies(lines, { ...options, voice: true }, ask)
    expect(calls.filter((c) => c.voice)).toHaveLength(3)
    expect(calls.every((c) => !c.voice || c.system === VOICE_SYSTEM)).toBe(true)
    expect(result.replies).toEqual(voiced)
  })

  it('falls back to the usual prompt when the voice gives too little', async () => {
    const ask: Ask = async (_messages, _schema, _max, opts) => (opts?.voice ? '' : 'Dạ con về ạ\nCon chưa biết ạ\nĐể con xem nhé')
    const result = await suggestReplies(lines, { ...options, voice: true }, ask)
    expect(result.replies).toEqual(['Dạ con về ạ', 'Con chưa biết ạ', 'Để con xem nhé'])
  })
})
