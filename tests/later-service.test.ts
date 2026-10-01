import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Later, type LaterDue } from '../src/main/later'
import type { Storage } from '../src/main/storage'
import type { MessagePreview, Settings } from '../src/shared/types'

const H = 60 * 60 * 1000

function setup(latest: Record<string, MessagePreview[]> = {}) {
  const store = { settings: {} as Settings }
  const storage = {
    get settings() {
      return store.settings
    },
    async setSettings(patch: Partial<Settings>) {
      store.settings = { ...store.settings, ...patch }
      return store.settings
    }
  } as unknown as Storage
  const fired: LaterDue[][] = []
  const events: unknown[] = []
  const later = new Later(storage, (e) => events.push(e), (due) => fired.push(due), (id) => latest[id] ?? [], () => undefined)
  const tick = (): Promise<void> => (later as unknown as { tick(): Promise<void> }).tick()
  return { later, store, fired, events, tick }
}

const preview = (sentAt: number, isOutgoing: boolean): MessagePreview => ({ id: String(sentAt), text: 'hi', senderName: 'Lan', isOutgoing, sentAt })

describe('Later', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 1, 10))
  })
  afterEach(() => vi.useRealTimers())

  it('fires a snooze once when its time comes, and settles it when the chat is opened', async () => {
    const { later, store, fired, events, tick } = setup()
    await later.snooze('a', Date.now() + H)
    expect(events).toHaveLength(1) // the window hears of every change
    await tick()
    expect(fired).toHaveLength(0)
    vi.advanceTimersByTime(H + 1000)
    await tick()
    await tick()
    expect(fired).toHaveLength(1)
    expect(fired[0][0]).toMatchObject({ kind: 'snooze', conversationId: 'a' })
    expect(store.settings.snoozed?.a.firedAt).toBeDefined()
    await later.seen('a')
    expect(store.settings.snoozed).toEqual({})
  })

  it('wakes a snooze and settles a follow-up when they write, but not for my own messages or older ones', async () => {
    const { later, store } = setup()
    await later.snooze('a', Date.now() + H)
    await later.follow('b', Date.now() + H)
    const t0 = Date.now()
    later.onMessage('a', { isOutgoing: true, sentAt: t0 + 1 })
    later.onMessage('b', { isOutgoing: false, sentAt: t0 - 1 })
    await Promise.resolve()
    expect(Object.keys(store.settings.snoozed ?? {})).toEqual(['a'])
    expect(Object.keys(store.settings.followUps ?? {})).toEqual(['b'])
    later.onMessage('a', { isOutgoing: false, sentAt: t0 + 1 })
    later.onMessage('b', { isOutgoing: false, sentAt: t0 + 1 })
    await Promise.resolve()
    expect(store.settings.snoozed).toEqual({})
    expect(store.settings.followUps).toEqual({})
  })

  it('drops a follow-up quietly when the chat list shows they answered while Moshi was closed', async () => {
    const t0 = Date.now()
    const { later, store, fired, tick } = setup({ answered: [preview(t0 + 30 * 60 * 1000, false)], silent: [preview(t0 + 60_000, true)] })
    await later.follow('answered', t0 + H)
    await later.follow('silent', t0 + H)
    vi.advanceTimersByTime(H + 1000)
    await tick()
    expect(fired.flat().map((d) => d.conversationId)).toEqual(['silent'])
    expect(Object.keys(store.settings.followUps ?? {})).toEqual(['silent'])
  })

  it('never sets a time in the past, and cancelling removes only that chat', async () => {
    const { later, store } = setup()
    await later.snooze('a', Date.now() - H)
    expect(store.settings.snoozed!.a.until).toBeGreaterThan(Date.now())
    await later.snooze('b', Date.now() + H)
    await later.unsnooze('a')
    expect(Object.keys(store.settings.snoozed ?? {})).toEqual(['b'])
  })
})
