import { describe, expect, it } from 'vitest'
import { AI_MODELS, detectLanguage, translationChunks } from '../src/shared/ai'

describe('language detection for translation', () => {
  it('reads the script or Vietnamese cues, else English', () => {
    expect(detectLanguage('Chiều nay mình đi cà phê nhé')).toBe('vi')
    expect(detectLanguage('chieu nay minh di cafe ko ban')).toBe('vi')
    expect(detectLanguage('See you tomorrow at the office')).toBe('en')
    expect(detectLanguage('안녕하세요')).toBe('ko')
    expect(detectLanguage('ありがとう')).toBe('ja')
    expect(detectLanguage('你好，明天见')).toBe('zh')
    expect(detectLanguage('สวัสดีครับ')).toBe('th')
    expect(detectLanguage('Привет')).toBe('ru')
    expect(detectLanguage('Merci beaucoup, je suis là')).toBe('fr')
  })
})

describe('translation chunks', () => {
  it('splits paragraphs into sentences, and very long runs at spaces', () => {
    expect(translationChunks('Hi. See you soon!\n\nHow are you?')).toEqual([['Hi.', 'See you soon!'], ['How are you?']])
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const [sentences] = translationChunks(long, 200)
    expect(sentences.length).toBe(30)
    expect(sentences.join(' ')).toBe(long)
    const [cut] = translationChunks('word '.repeat(200).trim(), 100)
    expect(cut.every((c) => c.length <= 100)).toBe(true)
  })

  it('lists sizes for the download prompt', () => {
    expect(AI_MODELS.voice.turbo.megabytes).toBeGreaterThan(AI_MODELS.voice.small.megabytes)
  })
})
