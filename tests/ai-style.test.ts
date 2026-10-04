import { describe, expect, it } from 'vitest'
import { isPrivate, pickExamples, stylePairs, trainingSamples } from '../src/shared/ai-style'
import type { InsightRecord } from '../src/shared/insights'

const MIN = 60_000
let n = 0
const rec = (conversationId: string, at: number, isOutgoing: boolean, text: string): InsightRecord => ({ conversationId, id: `m${n++}`, sentAt: at, isOutgoing, senderName: isOutgoing ? 'Tôi' : 'Họ', text, hasPhoto: false })

const NOW = Date.parse('2026-10-04T12:00:00Z')
const records: InsightRecord[] = [
  // Mum: con / mẹ
  rec('mum', NOW - 50 * MIN, false, 'Tối nay con có về ăn cơm không?'),
  rec('mum', NOW - 48 * MIN, true, 'dạ có mẹ ơi, con về tầm 7h nha 🥰'),
  rec('mum', NOW - 30 * MIN, false, 'Ừ'),
  rec('mum', NOW - 29 * MIN, false, 'Nhớ mua rau nhé'),
  rec('mum', NOW - 28 * MIN, true, 'okiee mẹ'),
  // a customer: em / chị
  rec('shop', NOW - 20 * MIN, false, 'Em ơi còn size M không?'),
  rec('shop', NOW - 19 * MIN, true, 'Dạ còn chị ơi, em giữ cho chị nhé'),
  // private: never a pair
  rec('shop', NOW - 10 * MIN, false, 'Em gửi chị số tài khoản nhé'),
  rec('shop', NOW - 9 * MIN, true, 'Dạ STK 0123456789 Vietcombank ạ'),
  // too late to be an answer
  rec('friend', NOW - 30 * 60 * MIN, false, 'Mai đi cà phê không?'),
  rec('friend', NOW - 20 * 60 * MIN, true, 'đi luôn'),
  // a group chat
  rec('group', NOW - 5 * MIN, false, 'Mùng 4 họp lớp nhé'),
  rec('group', NOW - 4 * MIN, true, 'ok luôn')
]

describe('stylePairs', () => {
  const pairs = stylePairs(records, (id) => id === 'group')
  it('pairs their message with the first answer, within a few hours', () => {
    expect(pairs.map((p) => [p.them, p.me])).toEqual([
      ['Tối nay con có về ăn cơm không?', 'dạ có mẹ ơi, con về tầm 7h nha 🥰'],
      ['Nhớ mua rau nhé', 'okiee mẹ'],
      ['Em ơi còn size M không?', 'Dạ còn chị ơi, em giữ cho chị nhé']
    ])
  })
  it('leaves out private replies, late answers and skipped chats', () => {
    expect(pairs.some((p) => /0123456789|đi luôn|ok luôn/.test(p.me))).toBe(false)
  })
})

describe('pickExamples', () => {
  const pairs = stylePairs(records, (id) => id === 'group')
  it('prefers this chat and similar messages', () => {
    const out = pickExamples(pairs, { answering: 'Trưa nay con có về ăn cơm không?', conversationId: 'mum', language: 'vi', address: { self: 'con', other: 'mẹ' }, now: NOW })
    expect(out[0].me).toBe('dạ có mẹ ơi, con về tầm 7h nha 🥰')
  })
  it('never borrows another chat’s pronouns', () => {
    const out = pickExamples(pairs, { answering: 'Con ơi chiều nay đón em nhé', conversationId: 'dad', language: 'vi', address: { self: 'con', other: 'bố' }, now: NOW })
    expect(out.map((e) => e.me)).toEqual([])
    const shop = pickExamples(pairs, { answering: 'Em ơi còn size L không?', conversationId: 'shop2', language: 'vi', address: { self: 'em', other: 'chị' }, now: NOW })
    expect(shop.map((e) => e.me)).toEqual(['Dạ còn chị ơi, em giữ cho chị nhé'])
  })
})

describe('training samples', () => {
  it('a reply with the chat before it, nothing private', () => {
    const samples = trainingSamples(records, (id) => id === 'group')
    expect(samples.map((s) => s.reply)).toEqual(['dạ có mẹ ơi, con về tầm 7h nha 🥰', 'okiee mẹ', 'Dạ còn chị ơi, em giữ cho chị nhé'])
    expect(samples[1].lines.at(-1)).toEqual({ mine: false, text: 'Nhớ mua rau nhé' })
  })
  it('spots private details', () => {
    expect(isPrivate('mã OTP là 123456')).toBe(true)
    expect(isPrivate('gọi em số 0912 345 678')).toBe(true)
    expect(isPrivate('mai 7h gặp nhé')).toBe(false)
  })
})
