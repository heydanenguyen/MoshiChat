import { describe, expect, it } from 'vitest'
import type { Settings } from '../src/shared/types'
import { orphanedSettingsPatch, stripMainOwned } from '../src/main/settings-guard'

const base = { theme: 'system', language: 'vi', notifications: true, sendOnEnter: true } as Settings

describe('stripMainOwned', () => {
  it('drops what only the main process writes and says what it dropped', () => {
    const patch = { zoom: 1.25, appLock: undefined, scheduled: [], snoozed: {}, followUps: {}, birthdaysNotified: {}, theme: 'dark' } as Partial<Settings>
    const { clean, dropped } = stripMainOwned(patch)
    expect(clean).toEqual({ zoom: 1.25, theme: 'dark' })
    expect(dropped.sort()).toEqual(['appLock', 'birthdaysNotified', 'followUps', 'scheduled', 'snoozed'])
  })

  it('leaves a harmless patch as it is (acceptedRequests and todos are the renderer’s own)', () => {
    const patch: Partial<Settings> = { acceptedRequests: { 'a/1': 1 }, todos: [] }
    const { clean, dropped } = stripMainOwned(patch)
    expect(clean).toEqual(patch)
    expect(dropped).toEqual([])
  })
})

describe('orphanedSettingsPatch', () => {
  const accounts = new Set(['telegram:1'])
  const later = { at: 1, until: 2 } as never

  it('prunes scheduled messages, snoozes, follow-ups and to-dos of chats whose account is gone', () => {
    const settings: Settings = {
      ...base,
      scheduled: [
        { id: 's1', conversationId: 'telegram:1/a', text: 'x', sendAt: 1, createdAt: 1, status: 'pending' },
        { id: 's2', conversationId: 'zalo:9/b', text: 'y', sendAt: 1, createdAt: 1, status: 'pending' }
      ],
      snoozed: { 'telegram:1/a': later, 'zalo:9/b': later },
      followUps: { 'zalo:9/b': later },
      todos: [
        { id: 't1', text: 'keep', createdAt: 1 },
        { id: 't2', text: 'chat kept', conversationId: 'telegram:1/a', createdAt: 1 },
        { id: 't3', text: 'chat gone', conversationId: 'zalo:9/b', createdAt: 1 }
      ]
    }
    const patch = orphanedSettingsPatch(settings, accounts)
    expect(patch.scheduled?.map((m) => m.id)).toEqual(['s1'])
    expect(Object.keys(patch.snoozed ?? {})).toEqual(['telegram:1/a'])
    expect(patch.followUps).toEqual({})
    expect(patch.todos?.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('has nothing to say when every entry still belongs to an account', () => {
    const settings: Settings = {
      ...base,
      tags: { 'telegram:1/a': ['x'] },
      scheduled: [{ id: 's1', conversationId: 'telegram:1/a', text: 'x', sendAt: 1, createdAt: 1, status: 'pending' }],
      snoozed: { 'telegram:1/a': later },
      todos: [{ id: 't1', text: 'keep', createdAt: 1 }]
    }
    expect(orphanedSettingsPatch(settings, accounts)).toEqual({})
  })

  it('keeps pruning the older per-chat records', () => {
    const settings: Settings = {
      ...base,
      tags: { 'telegram:1/a': ['x'], 'zalo:9/b': ['y'] },
      muted: { conversations: ['zalo:9/b', 'telegram:1/a'], accounts: ['zalo:9'] } as never,
      acceptedRequests: { 'zalo:9/b': 1 }
    }
    const patch = orphanedSettingsPatch(settings, accounts)
    expect(patch.tags).toEqual({ 'telegram:1/a': ['x'] })
    expect(patch.muted).toMatchObject({ conversations: ['telegram:1/a'], accounts: [] })
    expect(patch.acceptedRequests).toEqual({})
  })
})
