import { describe, expect, it } from 'vitest'
import { parseDue } from '../src/shared/todos'

// Saturday 3 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 3, 10, 0, 0, 0).getTime()
const at = (d: number, h: number, m = 0): number => new Date(2026, 9, d, h, m, 0, 0).getTime()

describe('parseDue', () => {
  it.each([
    ['gọi mẹ tối nay', 'gọi mẹ', at(3, 20)],
    ['nộp báo cáo mai 9h', 'nộp báo cáo', at(4, 9)],
    ['họp thứ 6 14h30', 'họp', at(9, 14, 30)],
    ['đón con chiều mai', 'đón con', at(4, 15)],
    ['ăn trưa 12h', 'ăn trưa', at(3, 12)],
    ['xem phim tối mai lúc 8h', 'xem phim', at(4, 20)],
    ['đi chợ chủ nhật', 'đi chợ', at(4, 9)],
    ['call Ann tomorrow 3pm', 'call Ann', at(4, 15)],
    ['pay rent friday', 'pay rent', at(9, 9)],
    ['gym 7am', 'gym', at(4, 7)],
    ['meeting 14:00', 'meeting', at(3, 14)]
  ])('%s', (input, text, due) => {
    expect(parseDue(input, NOW)).toEqual({ text, due })
  })

  it('reads a relative time', () => {
    expect(parseDue('uống nước 30 phút nữa', NOW)).toEqual({ text: 'uống nước', due: NOW + 30 * 60_000 })
    expect(parseDue('stretch in 2 hours', NOW)).toEqual({ text: 'stretch', due: NOW + 120 * 60_000 })
  })

  it('leaves text without a time alone', () => {
    expect(parseDue('mua sữa', NOW)).toEqual({ text: 'mua sữa' })
    expect(parseDue('đọc 3 chương sách', NOW)).toEqual({ text: 'đọc 3 chương sách' })
    expect(parseDue('Merged 👍', NOW)).toEqual({ text: 'Merged 👍' })
  })

  it('does not take words that only contain a day name', () => {
    expect(parseDue('mailbox cleanup', NOW)).toEqual({ text: 'mailbox cleanup' })
  })
})
