import { describe, expect, it } from 'vitest'
import { MAX_LINES, parseSuggestions, parseSummary, suggestMessages, summaryMessages, transcript } from '../src/shared/ai-prompts'

const at = new Date(2026, 8, 29, 9, 41).getTime()
const lines = [
  { who: 'Lan', text: 'Mai họp 3h nhé', at },
  { who: 'Me', text: 'Ok, phòng nào?', at: at + 60_000, mine: true },
  { who: 'Lan', text: 'Phòng 2, mang laptop', at: at + 120_000 }
]

describe('transcript', () => {
  it('writes timed lines, marks my own, trims long text and keeps only the newest', () => {
    const text = transcript(lines, 'vi')
    expect(text.split('\n')).toEqual(['[09:41] Lan: Mai họp 3h nhé', '[09:42] Tôi: Ok, phòng nào?', '[09:43] Lan: Phòng 2, mang laptop'])
    const long = transcript([{ who: 'A', text: 'x'.repeat(500), at }], 'en')
    expect(long.length).toBeLessThan(260)
    expect(long.endsWith('…')).toBe(true)
    const many = Array.from({ length: MAX_LINES + 10 }, (_, i) => ({ who: 'A', text: `m${i}`, at }))
    expect(transcript(many, 'en').split('\n')).toHaveLength(MAX_LINES)
  })
})

describe('prompts', () => {
  it('speak the app language and put the chat in the user turn', () => {
    const vi = summaryMessages(lines, 'vi')
    expect(vi[0].role).toBe('system')
    expect(vi[0].content).toMatch(/tiếng Việt/)
    expect(vi[1].content).toContain('Lan: Mai họp 3h nhé')
    const en = suggestMessages(lines, 'en')
    expect(en[0].content).toMatch(/exactly 3 short replies/)
  })
})

describe('parsers', () => {
  it('reads bullets, numbers and prose into summary lines', () => {
    expect(parseSummary('- Lan hẹn họp 3h mai\n- Ở phòng 2, mang laptop\n')).toEqual(['Lan hẹn họp 3h mai', 'Ở phòng 2, mang laptop'])
    expect(parseSummary('1. First point\n2) Second point')).toEqual(['First point', 'Second point'])
    expect(parseSummary('Lan set a meeting. Bring a laptop.')).toEqual(['Lan set a meeting.', 'Bring a laptop.'])
  })
  it('keeps three distinct short suggestions without decoration', () => {
    expect(parseSuggestions('Gợi ý:\n1. "Ok em nhé"\n2. Ok em nhé\n- Phòng 2 phải không?\n* Mai bận rồi, dời được không?\n- Extra one')).toEqual([
      'Ok em nhé',
      'Phòng 2 phải không?',
      'Mai bận rồi, dời được không?'
    ])
    expect(parseSuggestions('')).toEqual([])
  })
})
