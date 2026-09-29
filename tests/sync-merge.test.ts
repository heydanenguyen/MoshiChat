import { describe, expect, it } from 'vitest'
import type { Settings } from '../src/shared/types'
import { deviceEntries, flatten, mergeRemote, seedStamps, stampChanges, type DeviceFile, type Stamp } from '../src/shared/sync-merge'

const file = (deviceId: string, settings: Partial<Settings>, stamps: Record<string, Stamp>): DeviceFile => ({
  version: 1,
  deviceId,
  deviceName: deviceId,
  updatedAt: 0,
  entries: deviceEntries(settings, stamps)
})

/** A computer: its settings and stamps, changed the way the app changes them. */
function computer(id: string, settings: Partial<Settings> = {}) {
  const pc = {
    id,
    settings: { ...settings },
    stamps: {} as Record<string, Stamp>,
    change(patch: Partial<Settings>, at: number, origin: 'user' | 'tidy' = 'user') {
      const before = pc.settings
      pc.settings = { ...pc.settings, ...patch }
      stampChanges(before, pc.settings, pc.stamps, at, id, origin === 'tidy')
    },
    pull(...others: Array<ReturnType<typeof computer>>) {
      const merged = mergeRemote(pc.settings, pc.stamps, others.map((o) => file(o.id, o.settings, o.stamps)))
      if (!merged) return
      pc.stamps = merged.stamps
      pc.settings = { ...pc.settings, ...merged.patch }
    }
  }
  seedStamps(pc.settings, pc.stamps, id)
  return pc
}

describe('sync between computers', () => {
  it('leaves out what belongs to one computer', () => {
    const paths = [...flatten({ zoom: 1.5, downloadDir: 'D:/x', scheduled: [], theme: 'dark', tags: { 'zalo:1/2': ['work'] } }).keys()]
    expect(paths).toEqual(['theme', 'tags\u001fzalo:1/2'])
  })

  it('a new computer takes what the first one has and keeps its own extras', () => {
    const a = computer('a', { theme: 'dark', tags: { c1: ['work'] }, pins: { c1: true } })
    const b = computer('b', { theme: 'light', tags: { c2: ['family'] } })
    b.pull(a)
    a.pull(b)
    expect(b.settings.tags).toEqual({ c1: ['work'], c2: ['family'] })
    expect(a.settings.tags).toEqual({ c1: ['work'], c2: ['family'] })
    // Both started with a theme: every computer settles on the same one.
    expect(a.settings.theme).toBe(b.settings.theme)
  })

  it('edits to different chats on two computers both survive', () => {
    const a = computer('a', { tags: { c1: ['work'] } })
    const b = computer('b')
    b.pull(a)
    a.change({ tags: { c1: ['work', 'vip'] } }, 100)
    b.change({ tags: { c1: ['work'], c2: ['family'] } }, 110)
    a.pull(b)
    b.pull(a)
    expect(a.settings.tags).toEqual({ c1: ['work', 'vip'], c2: ['family'] })
    expect(b.settings.tags).toEqual(a.settings.tags)
  })

  it('the newer edit of the same thing wins', () => {
    const a = computer('a')
    const b = computer('b')
    a.change({ contactOverrides: { c1: { nickname: 'Mẹ' } } }, 100)
    b.change({ contactOverrides: { c1: { nickname: 'Mom' } } }, 200)
    a.pull(b)
    b.pull(a)
    expect(a.settings.contactOverrides).toEqual({ c1: { nickname: 'Mom' } })
    expect(b.settings.contactOverrides).toEqual({ c1: { nickname: 'Mom' } })
  })

  it('deletions travel, and an old copy does not bring the item back', () => {
    const a = computer('a', { todos: [{ id: 't1', text: 'Gọi khách', createdAt: 1 }, { id: 't2', text: 'Gửi báo giá', createdAt: 2 }] })
    const b = computer('b')
    b.pull(a)
    expect(b.settings.todos?.map((t) => t.id)).toEqual(['t1', 't2'])
    b.change({ todos: b.settings.todos?.filter((t) => t.id !== 't1') }, 300)
    a.pull(b)
    expect(a.settings.todos?.map((t) => t.id)).toEqual(['t2'])
    b.pull(a)
    expect(b.settings.todos?.map((t) => t.id)).toEqual(['t2'])
  })

  it('tidying away chats of accounts this computer does not have is not a deletion', () => {
    const a = computer('a', { tags: { 'zalo:1/c1': ['work'] } })
    const b = computer('b')
    b.pull(a)
    b.change({ tags: {} }, 300, 'tidy')
    a.pull(b)
    expect(a.settings.tags).toEqual({ 'zalo:1/c1': ['work'] })
  })

  it('keeps list order: saved messages newest first, to-dos by creation', () => {
    const saved = (id: string, savedAt: number) => ({ conversationId: 'c', messageId: id, platform: 'zalo' as const, text: id, senderName: 'x', isOutgoing: false, sentAt: 0, savedAt })
    const a = computer('a', { savedMessages: [saved('m2', 20), saved('m1', 10)] })
    const b = computer('b', { savedMessages: [saved('m3', 30)] })
    b.pull(a)
    expect(b.settings.savedMessages?.map((m) => m.messageId)).toEqual(['m3', 'm2', 'm1'])
  })

  it('nothing to do when both already agree', () => {
    const a = computer('a', { pins: { c1: true } })
    const b = computer('b')
    b.pull(a)
    expect(mergeRemote(b.settings, b.stamps, [file('a', a.settings, a.stamps)])).toBeNull()
  })

  it('ignores keys it does not sync and malformed entries', () => {
    const b = computer('b')
    const merged = mergeRemote(b.settings, b.stamps, [
      { version: 1, deviceId: 'a', deviceName: 'a', updatedAt: 0, entries: { zoom: { t: 5, d: 'a', v: 2 }, theme: { t: 'x', d: 'a', v: 'dark' } as never } }
    ])
    expect(merged).toBeNull()
  })
})
