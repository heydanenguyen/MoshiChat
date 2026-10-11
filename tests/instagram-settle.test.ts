import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settleOrAbort } from '../src/main/instagram-realtime'

// A page script run through executeJavaScript never answers once the page navigates (Electron 44): the poll that
// waited on one blocked every later poll. settleOrAbort gives such a promise up on a signal or a deadline.
describe('settleOrAbort', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const never = new Promise<string>(() => undefined)

  it('passes the task outcome through and unsubscribes', async () => {
    const unsubscribe = vi.fn()
    const value = await settleOrAbort(Promise.resolve('ok'), () => unsubscribe, 1000)
    expect(value).toBe('ok')
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    await expect(settleOrAbort(Promise.reject(new Error('boom')), () => unsubscribe, 1000)).rejects.toThrow('boom')
    expect(unsubscribe).toHaveBeenCalledTimes(2)
  })

  it('rejects with the abort reason when the subscriber fires', async () => {
    let fire: ((reason: string) => void) | undefined
    const unsubscribe = vi.fn()
    const pending = settleOrAbort(never, (abort) => {
      fire = abort
      return unsubscribe
    }, 60_000)
    fire!('Execution context was destroyed (the page navigated)')
    await expect(pending).rejects.toThrow('Execution context was destroyed (the page navigated)')
    // a second signal after settling changes nothing: no second unsubscribe, no throw
    expect(() => fire!('again')).not.toThrow()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('keeps the task outcome when the unsubscribe throws', async () => {
    await expect(
      settleOrAbort(Promise.resolve('ok'), () => () => {
        throw new Error('off failed')
      }, 1000)
    ).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects after the deadline with a retryable message', async () => {
    const unsubscribe = vi.fn()
    const pending = settleOrAbort(never, () => unsubscribe, 45_000)
    const outcome = expect(pending).rejects.toThrow('Execution context was destroyed (no answer in 45 s)')
    await vi.advanceTimersByTimeAsync(45_000)
    await outcome
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('ignores a late outcome once aborted and clears the deadline once settled', async () => {
    let settle: ((v: string) => void) | undefined
    const task = new Promise<string>((resolve) => {
      settle = resolve
    })
    let fire: ((reason: string) => void) | undefined
    const pending = settleOrAbort(task, (abort) => {
      fire = abort
      return () => undefined
    }, 10_000)
    fire!('gone')
    await expect(pending).rejects.toThrow('gone')
    expect(vi.getTimerCount()).toBe(0)
    const after = vi.fn()
    settle!('late')
    void pending.then(after, after)
    await vi.advanceTimersByTimeAsync(10_000)
    // the late value never reaches the caller a second time; the rejection stands
    expect(after).toHaveBeenCalledTimes(1)
    expect(after.mock.calls[0][0]).toBeInstanceOf(Error)
  })
})
