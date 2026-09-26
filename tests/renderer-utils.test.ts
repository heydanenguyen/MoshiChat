import { describe, expect, it } from 'vitest'
import type { Message } from '../src/shared/types'
import { formatBytes, gradientFor, initials, sectionize } from '../src/renderer/src/utils'
import { translate } from '../src/renderer/src/i18n'

const msg = (id: string, sender: string, sentAt: number, isOutgoing = false): Message => ({
  id,
  conversationId: 'c',
  senderId: sender,
  senderName: sender,
  text: id,
  attachments: [],
  reactions: [],
  sentAt,
  isOutgoing,
  status: 'delivered'
})

describe('initials', () => {
  it('uses first and last word, ignoring punctuation', () => {
    expect(initials('Nguyễn Minh Anh')).toBe('NA')
    expect(initials('Emma Watson (Client)')).toBe('EC')
    expect(initials('linh.ng')).toBe('LN')
    expect(initials('   ')).toBe('?')
    expect(initials('Gia đình mình ❤️')).toBe('GM')
  })
})

describe('formatBytes', () => {
  it('scales units and trims decimals', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB')
  })
})

describe('gradientFor', () => {
  it('is deterministic per name', () => {
    expect(gradientFor('Lan')).toBe(gradientFor('Lan'))
    expect(gradientFor('Lan')).not.toBe(gradientFor('Nam'))
  })
})

describe('sectionize', () => {
  it('splits by day and groups consecutive messages from one sender within three minutes', () => {
    const day1 = new Date(2026, 8, 25, 9, 0).getTime()
    const day2 = new Date(2026, 8, 26, 9, 0).getTime()
    const sections = sectionize([
      msg('1', 'a', day1),
      msg('2', 'a', day1 + 60_000),
      msg('3', 'a', day1 + 10 * 60_000), // gap > 3 min: new group
      msg('4', 'b', day1 + 11 * 60_000),
      msg('5', 'me', day2, true)
    ])
    expect(sections.length).toBe(2)
    expect(sections[0].groups.map((g) => g.messages.map((m) => m.id))).toEqual([['1', '2'], ['3'], ['4']])
    expect(sections[1].groups[0].isOutgoing).toBe(true)
  })
})

describe('translate', () => {
  it('interpolates params and falls back to English', () => {
    expect(translate('vi', 'typingIn', { name: 'Lan' })).toBe('Lan đang nhập…')
    expect(translate('en', 'members', { count: 4 })).toBe('4 members')
    expect(translate('vi', 'forwarded', { name: 'Nam' })).toBe('Đã chuyển tiếp đến Nam')
  })
})
