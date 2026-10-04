import { describe, expect, it } from 'vitest'
import { stripQuoted } from '../src/main/adapters/gmail'

describe('stripQuoted', () => {
  it('keeps the new reply and drops the quoted mail under "On … wrote:"', () => {
    const text = 'Sounds good, see you Monday.\n\nOn Fri, Oct 3, 2026 at 9:12 AM Ana <ana@example.com> wrote:\n> Shall we meet Monday?\n> Ana'
    expect(stripQuoted(text)).toBe('Sounds good, see you Monday.')
  })

  it('handles the Vietnamese header and one split over two lines', () => {
    expect(stripQuoted('Dạ em nhận rồi ạ\n\nVào Th 6, 3 thg 10, 2026 lúc 09:12 Chị Hạnh <h@x.vn> đã viết:\n> Em nhận chưa')).toBe('Dạ em nhận rồi ạ')
    expect(stripQuoted('Thanks!\n\nOn Fri, Oct 3, 2026 at 9:12 AM Ana Lee <ana@example.com>\nwrote:\n> hi')).toBe('Thanks!')
  })

  it('drops a trailing block of > lines and leaves a mail with no quote alone', () => {
    expect(stripQuoted('Yes\n\n> earlier\n> more')).toBe('Yes')
    expect(stripQuoted('Line one\nLine two')).toBe('Line one\nLine two')
  })
})
