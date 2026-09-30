import { describe, expect, it } from 'vitest'
import type { Conversation, Message } from '../src/shared/types'
import { candidatesFor, memberIndex, mergeConversation, mergeTimeline, nameScore, pairKey, phoneKey, pickSendVia, type Person } from '../src/shared/people'
import { flatten } from '../src/shared/sync-merge'

const T = 1_800_000_000_000
const MIN = 60_000

function chat(id: string, accountId: string, title: string, patch: Partial<Conversation> = {}, phone?: string): Conversation {
  return {
    id,
    accountId,
    platform: accountId.startsWith('zalo') ? 'zalo' : 'messenger',
    title,
    isGroup: false,
    participants: [
      { id: 'me', name: 'Me', isMe: true },
      { id: `${id}-peer`, name: title, phone }
    ],
    unreadCount: 0,
    updatedAt: T,
    ...patch
  }
}

function msg(id: string, conversationId: string, sentAt: number, isOutgoing = false): Message {
  return { id, conversationId, senderId: isOutgoing ? 'me' : 'them', senderName: 'x', text: id, attachments: [], reactions: [], sentAt, isOutgoing, status: 'sent' }
}

describe('a person across apps', () => {
  const people: Record<string, Person> = { p1: { members: ['zalo:1/lan', 'fb:1/lan'] } }
  const index = memberIndex(people)

  it('knows which person each chat belongs to', () => {
    expect(index.get('fb:1/lan')).toBe('p1')
    expect(index.get('zalo:1/lan')).toBe('p1')
    expect(index.get('zalo:1/other')).toBeUndefined()
  })

  it('merges unread counts and takes the newest message', () => {
    const zalo = chat('zalo:1/lan', 'zalo:1', 'Lan', { unreadCount: 2, lastMessage: { id: 'a', text: 'zalo', senderName: 'Lan', isOutgoing: false, sentAt: T - MIN } })
    const fb = chat('fb:1/lan', 'fb:1', 'Lan Phương', { unreadCount: 1, updatedAt: T + MIN, lastMessage: { id: 'b', text: 'fb', senderName: 'Lan', isOutgoing: false, sentAt: T } })
    const merged = mergeConversation({ name: 'Chị Lan', members: [zalo.id, fb.id] }, [zalo, fb])
    expect(merged.id).toBe(zalo.id)
    expect(merged.title).toBe('Chị Lan')
    expect(merged.unreadCount).toBe(3)
    expect(merged.lastMessage?.text).toBe('fb')
    expect(merged.updatedAt).toBe(T + MIN)
    expect(merged.members).toEqual([zalo.id, fb.id])
    expect(mergeConversation({ members: [zalo.id, fb.id] }, [zalo, fb]).title).toBe('Lan')
  })
})

describe('one timeline', () => {
  it('interleaves by time', () => {
    const { messages } = mergeTimeline([
      { messages: [msg('z1', 'z', 1), msg('z3', 'z', 3)], hasMore: false },
      { messages: [msg('f2', 'f', 2)], hasMore: false }
    ])
    expect(messages.map((m) => m.id)).toEqual(['z1', 'f2', 'z3'])
  })

  it('never shows a hole: stops at the loaded edge of a chat with more history', () => {
    // Zalo has loaded back to 50 and has more; Messenger is complete back to 10.
    const merged = mergeTimeline([
      { messages: [msg('z50', 'z', 50), msg('z90', 'z', 90)], hasMore: true },
      { messages: [msg('f10', 'f', 10), msg('f60', 'f', 60)], hasMore: false }
    ])
    expect(merged.cut).toBe(50)
    expect(merged.messages.map((m) => m.id)).toEqual(['z50', 'f60', 'z90'])
    expect(merged.hasMore).toBe(true)
  })

  it('waits for nothing that has not loaded yet', () => {
    const merged = mergeTimeline([{ messages: [msg('z1', 'z', 1)], hasMore: false }, { messages: undefined, hasMore: false }])
    expect(merged.messages.map((m) => m.id)).toEqual(['z1'])
  })
})

describe('where a reply goes', () => {
  const members = ['zalo', 'fb']

  it('goes where they last wrote', () => {
    expect(pickSendVia({ members, lastIncoming: { zalo: 10, fb: 20 } })).toBe('fb')
    expect(pickSendVia({ members, lastIncoming: { zalo: 30, fb: 20 } })).toBe('zalo')
  })

  it('uses the chosen app, then the anchor, when they never wrote', () => {
    expect(pickSendVia({ members, lastIncoming: {}, via: 'fb' })).toBe('fb')
    expect(pickSendVia({ members, lastIncoming: {} })).toBe('zalo')
  })

  it('keeps a hand-picked app until they write from another one', () => {
    expect(pickSendVia({ members, lastIncoming: { zalo: 10, fb: 20 }, picked: { id: 'zalo', at: 25 } })).toBe('zalo')
    // They wrote on Messenger after the pick: follow them.
    expect(pickSendVia({ members, lastIncoming: { zalo: 10, fb: 40 }, picked: { id: 'zalo', at: 25 } })).toBe('fb')
  })

  it('answers a quoted message in its own app', () => {
    expect(pickSendVia({ members, lastIncoming: { zalo: 10, fb: 20 }, replyTo: 'zalo' })).toBe('zalo')
  })
})

describe('suggesting merges', () => {
  it('reads Vietnamese phone numbers in any form', () => {
    expect(phoneKey('0912 345 678')).toBe('912345678')
    expect(phoneKey('+84 912 345 678')).toBe('912345678')
    expect(phoneKey('84912345678')).toBe('912345678')
    expect(phoneKey('123')).toBeUndefined()
  })

  it('scores names without marks, whole, contained or by given name', () => {
    expect(nameScore('Lan Phương', 'lan phuong')).toBe(1)
    expect(nameScore('Lan Phương', 'Nguyễn Lan Phương')).toBe(0.8)
    expect(nameScore('Trần Minh Anh', 'Nguyễn Minh Anh')).toBe(0.6)
    expect(nameScore('Minh', 'Minh Anh')).toBe(0)
    expect(nameScore('Lan', 'Hùng')).toBe(0)
  })

  it('ranks the same phone above a similar name, and skips the same account and groups', () => {
    const target = chat('zalo:1/a', 'zalo:1', 'Lan Phương', {}, '0912345678')
    const all = [
      target,
      chat('fb:1/b', 'fb:1', 'Nguyễn Lan Phương'),
      chat('wa:1/c', 'wa:1', 'Chị Lan', {}, '+84912345678'),
      chat('zalo:1/d', 'zalo:1', 'Lan Phương'),
      chat('fb:1/e', 'fb:1', 'Lan Phương', { isGroup: true })
    ]
    const found = candidatesFor(target, all, new Map())
    expect(found.map((c) => [c.conversation.id, c.reason])).toEqual([
      ['wa:1/c', 'phone'],
      ['fb:1/b', 'name']
    ])
    // Turned down once: not again.
    expect(candidatesFor(target, all, new Map(), { [pairKey('zalo:1/a', 'wa:1/c')]: T }).map((c) => c.conversation.id)).toEqual(['fb:1/b'])
  })

  it('syncs people and turned-down suggestions one entry each', () => {
    const paths = [...flatten({ people: { p1: { members: ['a', 'b'] } }, mergeDismissed: { 'a|c': T } }).keys()]
    expect(paths).toEqual(['people\u001fp1', 'mergeDismissed\u001fa|c'])
  })
})
