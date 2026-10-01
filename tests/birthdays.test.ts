import { describe, expect, it } from 'vitest'
import { Birthdays } from '../src/main/birthdays'
import type { Storage } from '../src/main/storage'
import type { Conversation, Settings } from '../src/shared/types'

const chat = (id: string, isGroup = false): Conversation => ({ id, isGroup, title: id }) as unknown as Conversation

function make(settings: Partial<Settings>, chats: Conversation[]) {
  const storage = { settings: settings as Settings } as unknown as Storage
  return new Birthdays(storage, () => undefined, () => chats, () => undefined, () => undefined)
}

describe('Birthdays.due', () => {
  const morning = new Date(2026, 9, 1, 9, 30)

  it('announces today, from what you set or what the platform said, once a year', () => {
    const b = make(
      {
        contactOverrides: { a: { birthday: '1998-10-01' }, b: { birthday: '--10-02' } },
        knownBirthdays: { c: '--10-01', a: '2000-01-01' },
        birthdaysNotified: {}
      },
      [chat('a'), chat('b'), chat('c')]
    )
    expect(b.due(morning).map((d) => d.conversationId).sort()).toEqual(['a', 'c'])
  })

  it('waits until 9:00 and skips groups, hidden chats, chats already announced and the switch turned off', () => {
    const settings: Partial<Settings> = {
      knownBirthdays: { a: '--10-01', g: '--10-01', h: '--10-01', done: '--10-01' },
      hidden: { h: 1 },
      birthdaysNotified: { done: 2026 }
    }
    const chats = [chat('a'), chat('g', true), chat('h'), chat('done')]
    expect(make(settings, chats).due(new Date(2026, 9, 1, 8, 59))).toEqual([])
    expect(make(settings, chats).due(morning).map((d) => d.conversationId)).toEqual(['a'])
    expect(make({ ...settings, birthdayReminders: false }, chats).due(morning)).toEqual([])
  })
})
