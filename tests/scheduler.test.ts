import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeEvent, Message, ScheduledMessage, Settings } from '../src/shared/types'
import { isRetryableSend, Scheduler } from '../src/main/scheduler'

const HOUR = 60 * 60 * 1000

function setup(send: () => Promise<Message>) {
  const storage = {
    settings: { scheduled: [] as ScheduledMessage[] } as Settings,
    setSettings: async (patch: Partial<Settings>) => {
      storage.settings = { ...storage.settings, ...patch }
      return storage.settings
    }
  }
  const failed: ScheduledMessage[] = []
  const events: BridgeEvent[] = []
  const sent: string[] = []
  const manager = {
    sendMessage: async (id: string) => {
      sent.push(id)
      return send()
    }
  }
  const scheduler = new Scheduler(storage as never, manager as never, (e) => events.push(e), (item) => failed.push(item), () => undefined)
  const item = (id: string, sendAt: number): ScheduledMessage => ({ id, conversationId: `telegram:1/${id}`, text: id, sendAt, createdAt: 0, status: 'pending' })
  const tick = (): Promise<void> => (scheduler as unknown as { tick(): Promise<void> }).tick()
  return { storage, scheduler, failed, sent, item, tick }
}

const ok = async (): Promise<Message> => ({ id: 'm', conversationId: 'c' }) as Message

describe('Scheduler after the computer slept', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('does not deliver a message hours late: it becomes missed and the user is told', async () => {
    const { storage, failed, sent, item, tick } = setup(ok)
    const now = Date.now()
    storage.settings.scheduled = [item('stale', now - 3 * HOUR), item('fresh', now - 5 * 60_000)]
    await tick()
    expect(sent).toEqual(['telegram:1/fresh'])
    expect(storage.settings.scheduled).toEqual([expect.objectContaining({ id: 'stale', status: 'missed' })])
    expect(failed.map((m) => [m.id, m.status])).toEqual([['stale', 'missed']])
  })

  it('a failing save in start() still installs the timer', async () => {
    const { storage, scheduler, item, sent } = setup(ok)
    storage.settings.scheduled = [item('stale', Date.now() - 3 * HOUR), item('due', Date.now() + 1000)]
    storage.setSettings = async () => {
      throw new Error('disk full')
    }
    await scheduler.start() // does not reject
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    scheduler.stop()
    expect(sent).toEqual([])
  })

  it('a message just past due is still sent', async () => {
    const { storage, sent, item, tick } = setup(ok)
    storage.settings.scheduled = [item('a', Date.now() - HOUR + 60_000)]
    await tick()
    expect(sent).toEqual(['telegram:1/a'])
    expect(storage.settings.scheduled).toEqual([])
  })

  it('tries again on the next tick when sending was only too fast, and gives up after the retry window', async () => {
    const error = 'RATE_LIMIT_SEND: Sending too fast, wait a minute before sending more'
    const { storage, failed, sent, item, tick } = setup(async () => {
      throw new Error(error)
    })
    storage.settings.scheduled = [item('a', Date.now() - 60_000)]
    await tick()
    expect(storage.settings.scheduled[0].status).toBe('pending')
    expect(failed).toEqual([])
    await tick()
    expect(sent).toHaveLength(2)
    // still failing 11 minutes after it was due: now it is a failure
    vi.advanceTimersByTime(11 * 60_000)
    await tick()
    expect(storage.settings.scheduled[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('RATE_LIMIT_SEND') })
    expect(failed).toHaveLength(1)
  })

  it('fails at once on any other error', async () => {
    const { storage, failed, item, tick } = setup(async () => {
      throw new Error('Chat not found')
    })
    storage.settings.scheduled = [item('a', Date.now() - 1000)]
    await tick()
    expect(storage.settings.scheduled[0].status).toBe('failed')
    expect(failed).toHaveLength(1)
  })
})

describe('isRetryableSend', () => {
  it('retries while connecting and when the send limiter said wait', () => {
    expect(isRetryableSend('Still connecting, try again in a moment')).toBe(true)
    expect(isRetryableSend('RATE_LIMIT_SEND: Sending too fast, wait a minute before sending more')).toBe(true)
    expect(isRetryableSend('RATE_LIMIT_FORWARD: This message was already forwarded')).toBe(true)
    expect(isRetryableSend('This account needs you to sign in again before sending')).toBe(false)
    expect(isRetryableSend('Chat not found')).toBe(false)
  })
})
