import { describe, expect, it } from 'vitest'
import type { Message } from '../src/shared/types'
import { formatBytes, gradientFor, initials, sectionize } from '../src/renderer/src/utils'
import { translate } from '../src/renderer/src/i18n'
import { popoverShift } from '../src/renderer/src/popover'
import { isFresh } from '../src/renderer/src/fresh'

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

describe('reaction toggling', () => {
  it('adds, switches and removes my reaction', async () => {
    const { toggleReaction } = await import('../src/renderer/src/utils')
    const start = [{ emoji: '😂', count: 2, byMe: false }]
    const hearted = toggleReaction(start, '❤️')
    expect(hearted).toEqual([{ emoji: '😂', count: 2, byMe: false }, { emoji: '❤️', count: 1, byMe: true }])
    const laughed = toggleReaction(hearted, '😂')
    expect(laughed).toEqual([{ emoji: '😂', count: 3, byMe: true }])
    expect(toggleReaction(laughed, '😂')).toEqual([{ emoji: '😂', count: 2, byMe: false }])
  })
})

describe('personLook', () => {
  const base = { isGroup: false, title: 'Mai', avatarUrl: 'platform.jpg', participants: [{ id: 'me', name: 'Me', isMe: true }, { id: 'p', name: 'Mai Anh', avatarUrl: 'p.jpg' }] }
  it('keeps the platform photo when nothing is customised', async () => {
    const { personLook } = await import('../src/renderer/src/utils')
    expect(personLook(base, { id: 'p', name: 'Mai Anh', avatarUrl: 'msg.jpg' }).url).toBe('msg.jpg')
    expect(personLook(base, { name: 'Mai Anh' }).url).toBe('platform.jpg')
  })
  it('uses the custom photo and nickname in one-to-one chats, also while typing', async () => {
    const { personLook } = await import('../src/renderer/src/utils')
    const custom = { ...base, title: 'Bé Mai', avatarUrl: 'custom.png', originalAvatarUrl: 'platform.jpg' }
    expect(personLook(custom, { id: 'p', name: 'Mai Anh', avatarUrl: 'msg.jpg' })).toEqual({ name: 'Bé Mai', url: 'custom.png' })
    expect(personLook(custom, { name: 'Mai Anh' })).toEqual({ name: 'Bé Mai', url: 'custom.png' })
    expect(personLook(custom, { id: 'me', name: 'Me', avatarUrl: 'me.jpg', isOutgoing: true }).url).toBe('me.jpg')
  })
  it('shows each member in groups', async () => {
    const { personLook } = await import('../src/renderer/src/utils')
    const group = { ...base, isGroup: true, avatarUrl: 'group.png', originalAvatarUrl: 'g.jpg' }
    expect(personLook(group, { name: 'Mai Anh' }).url).toBe('p.jpg')
  })
})

describe('withStickers', () => {
  const msg = (id: string, over: Record<string, unknown> = {}, att: Record<string, unknown> = {}) => ({
    id, conversationId: 'c', senderId: 'me', senderName: 'Me', text: '', reactions: [], sentAt: 1_000_000, isOutgoing: true, status: 'sent' as const,
    attachments: [{ id: id + 'a', kind: 'image' as const, url: 'x.jpg', ...att }], ...over
  })
  it('turns remembered and tell-tale stickers back into stickers, leaves photos alone', async () => {
    const { withStickers } = await import('../src/renderer/src/utils')
    const sent = [
      { conversationId: 'c', messageId: 'm1', sticker: 'sunny-haha', sentAt: 1_000_000 },
      { conversationId: 'c', messageId: 'gone', sticker: 'grape-cool', sentAt: 5_000_000 },
      { conversationId: 'other', messageId: 'p', sticker: 'sunny-haha', sentAt: 9_000_000 }
    ]
    const list = [
      msg('m1'),
      msg('echo', { sentAt: 5_030_000 }, { width: 384, height: 384 }),
      msg('old', { sentAt: 7_000_000 }, { width: 384, height: 384 }),
      msg('photo', { sentAt: 5_010_000 }, { width: 1080, height: 1350 }),
      msg('p', { sentAt: 9_000_000 }),
      msg('theirs', { isOutgoing: false }, { width: 384, height: 384 })
    ]
    const out = withStickers(list, sent, 'c', 'instagram')
    const look = (i: number) => [out[i].attachments[0].kind, out[i].attachments[0].sticker, out[i].attachments[0].flattened]
    expect(look(0)).toEqual(['sticker', 'sunny-haha', false])
    expect(look(1)).toEqual(['sticker', 'grape-cool', false])
    expect(look(2)).toEqual(['sticker', undefined, true])
    expect(look(3)[0]).toBe('image')
    expect(look(4)[0]).toBe('image')
    expect(look(5)[0]).toBe('image')
    expect(withStickers([msg('photo', {}, { width: 800, height: 600 })], [], 'c', 'messenger')[0].attachments[0].kind).toBe('image')
  })
  it('a record with a changed id claims only the closest photo, and marks guesses for a picture check', async () => {
    const { withStickers } = await import('../src/renderer/src/utils')
    const sent = [{ conversationId: 'c', messageId: 'gone', sticker: 'sunny-sweat', sentAt: 5_000_000 }]
    // Instagram gives no sizes: the sticker echo and a screenshot pasted 20 s later both look alike.
    const list = [msg('echo', { sentAt: 5_002_000 }), msg('shot', { sentAt: 5_020_000 }), msg('later', { sentAt: 5_090_000 }), msg('m1')]
    const out = withStickers(list, sent, 'c', 'instagram')
    expect(out[0].attachments[0]).toMatchObject({ kind: 'sticker', sticker: 'sunny-sweat', guessed: true })
    expect(out[1].attachments[0].kind).toBe('image')
    expect(out[2].attachments[0].kind).toBe('image')
    const exact = withStickers([msg('m1')], [{ conversationId: 'c', messageId: 'm1', sticker: 'sunny-haha', sentAt: 1_000_000 }], 'c', 'instagram')
    expect(exact[0].attachments[0].guessed).toBe(false)
  })
})

describe('popoverShift', () => {
  const panel = { left: 400, right: 1000 }
  it('leaves a popover that already fits alone', () => {
    expect(popoverShift({ left: 500, right: 800 }, panel)).toBe(0)
  })
  it('slides a popover running past the left edge back in, keeping the inset', () => {
    expect(popoverShift({ left: 230, right: 586 }, panel)).toBe(178)
  })
  it('slides a popover running past the right edge back in', () => {
    expect(popoverShift({ left: 900, right: 1100 }, panel)).toBe(-108)
  })
  it('hugs the left edge when the popover is wider than the panel', () => {
    expect(popoverShift({ left: 300, right: 1200 }, { left: 400, right: 700 })).toBe(108)
  })
})

describe('isFresh', () => {
  it('is true for a message that just arrived and false once it is a few seconds old', () => {
    expect(isFresh(10_000, 10_000)).toBe(true)
    expect(isFresh(10_000, 12_999)).toBe(true)
    expect(isFresh(10_000, 13_000)).toBe(false)
    expect(isFresh(0, 60_000)).toBe(false)
  })

  it('treats a timestamp slightly ahead of this clock as fresh', () => {
    expect(isFresh(10_500, 10_000)).toBe(true)
  })
})
