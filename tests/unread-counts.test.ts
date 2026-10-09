import { describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../src/shared/types'

// The store is a renderer module: it reads localStorage and listens on window when it loads.
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined, unison: { app: { platform: 'win32' } } })
const { unreadCounts } = await import('../src/renderer/src/store')

const chat = (id: string, unreadCount: number, extra: Partial<Conversation> = {}): Conversation =>
  ({ id, accountId: 'a1', platform: 'zalo', title: id, participants: [], unreadCount, updatedAt: 1, ...extra }) as Conversation

describe('unreadCounts', () => {
  it('counts per platform, account and tag, leaving muted chats out', () => {
    const conversations = {
      c1: chat('c1', 2, { accountId: 'a1' }),
      c2: chat('c2', 3, { accountId: 'a2', platform: 'telegram' }),
      c3: chat('c3', 5, { muted: true })
    }
    const counts = unreadCounts(conversations, { c1: ['work'] }, undefined, undefined, undefined, undefined, undefined)
    expect(counts.total).toBe(5)
    expect(counts.byPlatform.zalo).toBe(2)
    expect(counts.byPlatform.telegram).toBe(3)
    expect(counts.byAccount).toEqual({ a1: 2, a2: 3 })
    expect(counts.byTag).toEqual({ work: 2 })
  })

  it('walks once for the same inputs and returns the same object', () => {
    const conversations = { c1: chat('c1', 1) }
    const tags = {}
    const first = unreadCounts(conversations, tags, undefined, undefined, undefined, undefined, undefined)
    expect(unreadCounts(conversations, tags, undefined, undefined, undefined, undefined, undefined)).toBe(first)
  })

  it('keeps the same object when the counts did not change, so a muted chat arriving renders nobody', () => {
    const tags = {}
    const first = unreadCounts({ c1: chat('c1', 1) }, tags, undefined, undefined, undefined, undefined, undefined)
    const again = unreadCounts({ c1: chat('c1', 1), c2: chat('c2', 4, { muted: true }) }, tags, undefined, undefined, undefined, undefined, undefined)
    expect(again).toBe(first)
  })

  it('gives a fresh object once a count moves', () => {
    const tags = {}
    const first = unreadCounts({ c1: chat('c1', 1) }, tags, undefined, undefined, undefined, undefined, undefined)
    const next = unreadCounts({ c1: chat('c1', 2) }, tags, undefined, undefined, undefined, undefined, undefined)
    expect(next).not.toBe(first)
    expect(next.total).toBe(2)
  })
})
