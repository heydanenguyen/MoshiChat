import { describe, expect, it } from 'vitest'
import type { Conversation, MessagePreview } from '../src/shared/types'
import { applyQuickFilter, AWAITING_WINDOW, countQuickFilters, formatBadge, isAwaitingReply, isUnread, matchesQuickFilter, type QuickFilterContext } from '../src/renderer/src/quickFilter'
import { flatten } from '../src/shared/sync-merge'

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

function chat(id: string, patch: Partial<Conversation> = {}, last?: Partial<MessagePreview>): Conversation {
  return {
    id,
    accountId: 'zalo:1',
    platform: 'zalo',
    title: id,
    participants: [],
    isGroup: false,
    unreadCount: 0,
    updatedAt: NOW,
    lastMessage: last ? { id: `${id}-m`, text: 'hi', senderName: 'Lan', isOutgoing: false, sentAt: NOW - HOUR, ...last } : undefined,
    ...patch
  } as Conversation
}

const ctx = (patch: Partial<QuickFilterContext> = {}): QuickFilterContext => ({ now: NOW, drafts: {}, isMuted: () => false, ...patch })

describe('quick filters', () => {
  it('counts a chat as unread for new messages or a hand-set flag', () => {
    expect(isUnread(chat('a', { unreadCount: 3 }))).toBe(true)
    expect(isUnread(chat('b'))).toBe(false)
    expect(isUnread(chat('b'), { b: NOW })).toBe(true)
  })

  it('needs a reply when the other person wrote last in a recent one-to-one chat', () => {
    expect(isAwaitingReply(chat('a', {}, {}), NOW, false)).toBe(true)
    // You wrote last, or nothing was said.
    expect(isAwaitingReply(chat('b', {}, { isOutgoing: true }), NOW, false)).toBe(false)
    expect(isAwaitingReply(chat('c'), NOW, false)).toBe(false)
    // Groups and muted chats (shops, bots) never ask.
    expect(isAwaitingReply(chat('d', { isGroup: true }, {}), NOW, false)).toBe(false)
    expect(isAwaitingReply(chat('e', {}, {}), NOW, true)).toBe(false)
    // A recalled or unavailable message, a call, a reaction to your story: nothing to answer.
    for (const kind of ['unsent', 'unavailable', 'call', 'story_reaction'] as const) {
      expect(isAwaitingReply(chat('f', {}, { kind }), NOW, false)).toBe(false)
    }
    // Photos and voice notes still want an answer.
    expect(isAwaitingReply(chat('h', {}, { kind: 'voice' }), NOW, false)).toBe(true)
    expect(isAwaitingReply(chat('i', {}, { kind: 'photo' }), NOW, false)).toBe(true)
  })

  it('lets an old unanswered message go after 30 days', () => {
    expect(isAwaitingReply(chat('a', {}, { sentAt: NOW - AWAITING_WINDOW }), NOW, false)).toBe(true)
    expect(isAwaitingReply(chat('a', {}, { sentAt: NOW - AWAITING_WINDOW - 1 }), NOW, false)).toBe(false)
  })

  it('matches groups and drafts, ignoring blank drafts', () => {
    const drafts = { a: 'hẹn mai nhé', b: '   ' }
    expect(matchesQuickFilter(chat('g', { isGroup: true }), 'groups', ctx())).toBe(true)
    expect(matchesQuickFilter(chat('a'), 'drafts', ctx({ drafts }))).toBe(true)
    expect(matchesQuickFilter(chat('b'), 'drafts', ctx({ drafts }))).toBe(false)
    expect(matchesQuickFilter(chat('z'), 'all', ctx())).toBe(true)
  })

  it('uses the mute rules for Needs reply', () => {
    const list = [chat('a', {}, {}), chat('b', {}, {})]
    const muted = ctx({ isMuted: (c) => c.id === 'b' })
    expect(applyQuickFilter(list, 'awaiting', muted).map((c) => c.id)).toEqual(['a'])
  })

  it('counts every chip in one pass', () => {
    const list = [
      chat('a', { unreadCount: 2 }, {}),
      chat('b', { isGroup: true, unreadCount: 1 }, {}),
      chat('c', {}, { isOutgoing: true }),
      chat('d', { isGroup: true })
    ]
    expect(countQuickFilters(list, ctx({ drafts: { c: 'ok' }, markedUnread: { d: NOW } }))).toEqual({
      all: 4,
      unread: 3,
      awaiting: 1,
      groups: 2,
      drafts: 1
    })
  })

  it('keeps open chats in place and preserves order', () => {
    const list = [chat('a', { unreadCount: 1 }), chat('b'), chat('c', { unreadCount: 4 })]
    expect(applyQuickFilter(list, 'unread', ctx()).map((c) => c.id)).toEqual(['a', 'c'])
    // Reading "b" (open on screen) must not yank it out of the Unread list.
    expect(applyQuickFilter(list, 'unread', ctx(), new Set(['b'])).map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(applyQuickFilter(list, 'all', ctx())).not.toBe(list)
  })

  it('keeps badges short', () => {
    expect(formatBadge(7)).toBe('7')
    expect(formatBadge(99)).toBe('99')
    expect(formatBadge(100)).toBe('99+')
  })

  it('syncs chats marked unread between computers, one entry per chat', () => {
    const paths = [...flatten({ markedUnread: { 'zalo:1/2': NOW } }).keys()]
    expect(paths).toEqual(['markedUnread\u001fzalo:1/2'])
  })
})
