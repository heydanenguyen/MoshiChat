import { describe, expect, it } from 'vitest'
import { cleanReplies, detectAddress, fillPronouns, guessIntent, replyBank, styleOf } from '../src/shared/ai-context'
import type { ChatLine } from '../src/shared/ai-prompts'

const chat = (rows: Array<[mine: boolean, text: string]>): ChatLine[] => rows.map(([mine, text], i) => ({ who: mine ? 'Tôi' : 'Họ', text, at: i * 60_000, mine }))

describe('detectAddress', () => {
  it('a shop and its customer: em / chị, polite', () => {
    const a = detectAddress(
      chat([
        [false, 'Em ơi lô hàng tuần này còn size M không?'],
        [true, 'Dạ còn 40 cái chị, em giữ cho chị 20 nhé'],
        [false, 'Tuần sau chị lấy thêm 30 cái nữa'],
        [true, 'Dạ em báo giá chị liền ạ']
      ])
    )
    expect(a).toEqual({ self: 'em', other: 'chị', polite: true })
  })

  it('a big brother to his little sister: anh / em', () => {
    expect(detectAddress(chat([[false, 'Anh ơi tối nay anh về không?'], [true, 'Anh về muộn, em ăn trước đi'], [false, 'Dạ em biết rồi']]))).toMatchObject({ self: 'anh', other: 'em' })
  })

  it('friends: tao / mày, and mình / bạn', () => {
    expect(detectAddress(chat([[true, 'Tao tới rồi, mày đâu'], [false, 'Đợi tao 5 phút']]))).toMatchObject({ self: 'tao', other: 'mày' })
    expect(detectAddress(chat([[false, 'Mình gửi file rồi nhé'], [true, 'Mình nhận được rồi, cảm ơn bạn']]))).toMatchObject({ self: 'mình', other: 'bạn' })
  })

  it('a child and their mother: con / mẹ', () => {
    expect(detectAddress(chat([[false, 'Con ăn cơm chưa?'], [true, 'Con ăn rồi mẹ ơi']]))).toMatchObject({ self: 'con', other: 'mẹ' })
  })

  it('says nothing when there are no pronouns', () => {
    expect(detectAddress(chat([[true, 'ok'], [false, 'see you at 5']]))).toEqual({ self: undefined, other: undefined, polite: false })
  })
})

describe('guessIntent', () => {
  it('reads the common kinds of message', () => {
    expect(guessIntent('À con chị vừa đậu đại học rồi em ơi, vui quá')).toBe('good_news')
    expect(guessIntent('Dạo này mệt quá, chắc tao nghỉ việc')).toBe('bad_news')
    expect(guessIntent('Tuần sau chị lấy thêm 30 cái, em báo giá sỉ giúp chị')).toBe('request')
    expect(guessIntent('Mai 3h họp ở đâu vậy?')).toBe('question')
    expect(guessIntent('Tối nay đi ăn lẩu không?')).toBe('invite')
    expect(guessIntent('Cảm ơn em nhiều nha')).toBe('thanks')
    expect(guessIntent('Chào chị')).toBe('greeting')
    expect(guessIntent('Hôm nay trời đẹp')).toBeUndefined()
  })
})

describe('replyBank and fillPronouns', () => {
  it('speaks in the user’s pronouns', () => {
    expect(replyBank('good_news', { self: 'em', other: 'chị', polite: true }, 'vi')[0]).toBe('Chúc mừng chị nhé! 🎉')
    expect(replyBank('request', { self: 'em', other: 'chị', polite: true }, 'vi')[0]).toBe('Dạ ok để em làm ngay')
  })

  it('drops pronouns it does not know, with their "ơi"', () => {
    expect(fillPronouns('Tuyệt quá {other} ơi, kể {self} nghe với', { polite: false })).toBe('Tuyệt quá, kể nghe với')
    expect(fillPronouns('{Other} ổn không?', { polite: false })).toBe('Ổn không?')
  })
})

describe('styleOf', () => {
  it('measures the user’s own messages only', () => {
    const s = styleOf(chat([[true, 'ok nha'], [true, 'tới liền nha 😆'], [false, 'Nhanh lên'], [true, '[Ảnh]'], [true, 'đợi xíu nha']]))
    expect(s.particles).toEqual(['nha'])
    expect(s.lowercase).toBe(true)
    expect(s.emoji).toBe(true)
    expect(s.examples).toEqual(['ok nha', 'tới liền nha 😆', 'đợi xíu nha'])
  })
})

describe('cleanReplies', () => {
  it('keeps usable, distinct replies in the right language', () => {
    const out = cleanReplies(['- Tôi: Chúc mừng chị nhé!', 'Chúc mừng chị nhé!', 'Here are some replies', 'Congratulations to you and your family', 'Em giữ hàng cho chị rồi ạ'], { language: 'vi', answering: 'Con chị đậu đại học' })
    expect(out).toEqual(['Chúc mừng chị nhé!', 'Em giữ hàng cho chị rồi ạ'])
  })
})

describe('guessIntent with Vietnamese word edges', () => {
  it('matches words that end in accented letters', () => {
    expect(guessIntent('Em ăn gì chưa')).toBe('question')
    expect(guessIntent('Mai đi đâu')).toBe('question')
    expect(guessIntent('Cuối tuần đi xem phim không')).toBe('invite')
  })
})

describe('cleanReplies, the model in the wrong seat', () => {
  const address = { self: 'em', other: 'anh', polite: false }
  it('drops a reply calling out to the user', () => {
    expect(cleanReplies(['Anh tới rồi em', 'Em ơi anh tới rồi', 'Anh để đó cho em nhé', 'Em ra ngay anh ơi'], { language: 'vi', address })).toEqual(['Anh để đó cho em nhé', 'Em ra ngay anh ơi'])
  })
  it('drops the model talking about its task', () => {
    expect(cleanReplies(['Sure. Let me write three responses for Sam.', '*Option 1 (Yes):**', 'Yeah, I am free then.'], { language: 'en' })).toEqual(['Yeah, I am free then.'])
  })
})

describe('splitReplies', () => {
  it('one a line, or one a sentence when the model ran them together', async () => {
    const { splitReplies } = await import('../src/shared/ai-prompts')
    expect(splitReplies('A một.\nB hai.\nC ba.')).toEqual(['A một.', 'B hai.', 'C ba.'])
    expect(splitReplies('Con biết mẹ lo. Con về ngay nhé! Mẹ nghỉ ngơi đi.')).toEqual(['Con biết mẹ lo.', 'Con về ngay nhé!', 'Mẹ nghỉ ngơi đi.'])
  })
})
