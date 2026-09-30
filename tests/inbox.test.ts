import { describe, expect, it } from 'vitest'
import type { Conversation, Message } from '../src/shared/types'
import { accountNames, archiveMark, foldName, hasReturned, isArchived, isChatMuted, isForMe, isPendingRequest, isStrangerChat, looksLikeCode, maskCode } from '../src/shared/inbox'
import { flatten } from '../src/shared/sync-merge'

const AT = 1_800_000_000_000

const last = (patch: Partial<NonNullable<Conversation['lastMessage']>> = {}): Pick<Conversation, 'lastMessage'> => ({
  lastMessage: { id: 'm', text: 'hi', senderName: 'Lan', isOutgoing: false, sentAt: AT, ...patch }
})

const msg = (text: string, replyTo?: Message['replyTo']): Pick<Message, 'text' | 'replyTo'> => ({ text, replyTo })

describe('archive', () => {
  it('holds until the other side writes again', () => {
    expect(isArchived(last({ sentAt: AT - 1 }), AT, false)).toBe(true)
    expect(isArchived(last({ sentAt: AT + 1 }), AT, false)).toBe(false)
    // Your own new message (sent from the phone) does not bring it back.
    expect(isArchived(last({ sentAt: AT + 1, isOutgoing: true }), AT, false)).toBe(true)
    expect(isArchived({}, AT, false)).toBe(true)
  })

  it('keeps a muted chat archived whatever arrives', () => {
    expect(isArchived(last({ sentAt: AT + 60_000 }), AT, true)).toBe(true)
  })

  it('is not archived without a mark', () => {
    expect(isArchived(last(), undefined, true)).toBe(false)
  })

  it('marks with the platform time of the last message, so a clock running fast cannot hide a new one', () => {
    expect(archiveMark(last({ sentAt: AT }))).toBe(AT)
    expect(archiveMark({})).toBe(0)
    // Archived with no messages yet: the first message brings it back.
    expect(isArchived(last({ sentAt: 5 }), archiveMark({}), false)).toBe(false)
    expect(hasReturned(last({ sentAt: AT }), AT)).toBe(false)
    expect(hasReturned(last({ sentAt: AT + 1 }), AT)).toBe(true)
  })

  it('reads mute from Moshi rules or the platform', () => {
    const settings = { muted: { conversations: [], tags: ['work'], accounts: [], platforms: [] }, tags: { 'z/1': ['work'] } }
    expect(isChatMuted(settings, { id: 'z/1', accountId: 'z', platform: 'zalo' })).toBe(true)
    expect(isChatMuted(settings, { id: 'z/2', accountId: 'z', platform: 'zalo', muted: true })).toBe(true)
    expect(isChatMuted(settings, { id: 'z/2', accountId: 'z', platform: 'zalo' })).toBe(false)
  })
})

describe('messages for me', () => {
  const me = ['Nguyễn Minh Anh', 'minhanh.nguyen']

  it('folds Vietnamese marks and case', () => {
    expect(foldName('  Nguyễn   Minh ANH ')).toBe('nguyen minh anh')
    expect(foldName('Đặng')).toBe('dang')
  })

  it('finds an @mention of any of my names, marks or not', () => {
    expect(isForMe(msg('@Nguyễn Minh Anh chiều nay họp nhé'), me)).toBe(true)
    expect(isForMe(msg('nhờ @nguyen minh anh xem giúp'), me)).toBe(true)
    expect(isForMe(msg('cc @minhanh.nguyen'), me)).toBe(true)
    expect(isForMe(msg('@Nguyễn Minh Anh, ok?'), me)).toBe(true)
  })

  it('ignores a longer name, a bare name and other people', () => {
    expect(isForMe(msg('@Nguyễn Minh Anhh'), me)).toBe(false)
    expect(isForMe(msg('Nguyễn Minh Anh ơi'), me)).toBe(false)
    expect(isForMe(msg('@Trần Văn Bình xem nhé'), me)).toBe(false)
  })

  it('counts call-outs to everyone', () => {
    expect(isForMe(msg('@All mai nghỉ nha'), me)).toBe(true)
    expect(isForMe(msg('@Tất cả chú ý'), me)).toBe(true)
    expect(isForMe(msg('@everyone standup'), me)).toBe(true)
    expect(isForMe(msg('@alloy'), me)).toBe(false)
  })

  it('counts replies to me, by id when known, else by name', () => {
    expect(isForMe(msg('đúng rồi', { id: 'x', senderName: 'Someone', text: '' }), me, new Set(['x']))).toBe(true)
    expect(isForMe(msg('đúng rồi', { id: 'y', senderName: 'Nguyen Minh Anh', text: '' }), me)).toBe(true)
    expect(isForMe(msg('đúng rồi', { id: 'z', senderName: 'Lan', text: '' }), me)).toBe(false)
  })

  it('knows a username stored with "@" and a WhatsApp number', () => {
    expect(accountNames({ displayName: 'Minh Anh', handle: '@minhanh' })).toEqual(['Minh Anh', 'minhanh'])
    expect(accountNames({ displayName: 'Minh Anh', handle: '+84 912 345 678' })).toEqual(['Minh Anh', '+84 912 345 678', '84912345678'])
    expect(accountNames(undefined)).toEqual([])
    expect(isForMe(msg('@minhanh xem giúp'), accountNames({ displayName: 'Minh Anh', handle: '@minhanh' }))).toBe(true)
    expect(isForMe(msg('@84912345678 ok'), accountNames({ displayName: 'Minh Anh', handle: '+84 912 345 678' }))).toBe(true)
  })

  it('never matches with no names', () => {
    expect(isForMe(msg('@ hello'), [])).toBe(false)
    expect(isForMe(msg('@a'), ['a'])).toBe(false)
  })

  it('syncs archive and mentions-only marks per chat', () => {
    const paths = [...flatten({ archived: { 'zalo:1/2': AT }, mentionsOnly: { 'zalo:1/3': true } }).keys()]
    expect(paths).toEqual(['archived\u001fzalo:1/2', 'mentionsOnly\u001fzalo:1/3'])
  })
})

describe('message requests', () => {
  it('waits until accepted in Moshi', () => {
    expect(isPendingRequest({ id: 'a', request: true }, undefined)).toBe(true)
    expect(isPendingRequest({ id: 'a', request: true }, { a: AT })).toBe(false)
    expect(isPendingRequest({ id: 'b' }, {})).toBe(false)
  })

  it('treats a Zalo chat with a stranger as a request only until you write or it was yours to begin with', () => {
    const base = { isGroup: false, friendsKnown: true, isFriend: false, startedByMe: false, youWrote: false }
    expect(isStrangerChat(base)).toBe(true)
    expect(isStrangerChat({ ...base, isFriend: true })).toBe(false)
    expect(isStrangerChat({ ...base, youWrote: true })).toBe(false)
    expect(isStrangerChat({ ...base, startedByMe: true })).toBe(false)
    expect(isStrangerChat({ ...base, isGroup: true })).toBe(false)
    // Before the friend list has loaded nothing is a request, so chats do not flicker into Requests.
    expect(isStrangerChat({ ...base, friendsKnown: false })).toBe(false)
  })

  it('lets one-time codes through, in Vietnamese and English', () => {
    expect(looksLikeCode('Mã xác thực của bạn là 482913. Không chia sẻ mã này.')).toBe(true)
    expect(looksLikeCode('Mã OTP: 1234')).toBe(true)
    expect(looksLikeCode('Your verification code is 55012')).toBe(true)
    expect(looksLikeCode('Mã đăng nhập 889900')).toBe(true)
  })

  it('does not take prices, phone numbers or chatter for a code', () => {
    expect(looksLikeCode('Chị cho em xin bảng giá sỉ từ 50 cái với ạ')).toBe(false)
    expect(looksLikeCode('Giá 150.000đ, mã hàng A12')).toBe(false)
    expect(looksLikeCode('Gọi em số 0912345678 nhé')).toBe(false)
    expect(looksLikeCode('Chúc mừng năm mới 2026!')).toBe(false)
    // Promotions that look like codes: a discount code, a power bank.
    expect(looksLikeCode('Mã giảm giá 50000đ cho đơn đầu tiên')).toBe(false)
    expect(looksLikeCode('Pin sạc dự phòng 20000mAh giá sốc')).toBe(false)
    expect(looksLikeCode('Use code SALE 2026 at checkout')).toBe(false)
  })

  it('hides one-time codes in previews and leaves other numbers alone', () => {
    expect(maskCode('Mã xác thực của bạn là 482913. Không chia sẻ mã này.')).toBe('Mã xác thực của bạn là ••••••. Không chia sẻ mã này.')
    expect(maskCode('Your verification code is 55012')).toBe('Your verification code is •••••')
    expect(maskCode('Gọi em số 0912345678 nhé')).toBe('Gọi em số 0912345678 nhé')
    expect(maskCode('Mã giảm giá 50000đ cho đơn đầu tiên')).toBe('Mã giảm giá 50000đ cho đơn đầu tiên')
  })
})
