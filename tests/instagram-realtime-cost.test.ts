import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

import { base64Forms, blockHeavyResources, RefreshThrottle, scanFrame } from '../src/main/instagram-realtime'

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

describe('base64Forms', () => {
  it('finds the marker in a base64 run whatever its byte offset', () => {
    const forms = base64Forms('SlideUQPP')
    for (let pad = 0; pad < 6; pad++) {
      const run = b64('x'.repeat(pad) + 'SlideUQPPNewMessage' + 'y'.repeat(40))
      expect(forms.some((f) => run.includes(f))).toBe(true)
    }
  })
})

describe('scanFrame prefilter', () => {
  it('still finds Slide events nested in base64 at every alignment', () => {
    for (let pad = 0; pad < 3; pad++) {
      const inner = 'p'.repeat(pad) + JSON.stringify({ data: [{ __isSlideUQPPMutationWithThreadKey: 'SlideUQPPCreateReaction' }], pad: 'x'.repeat(80) })
      const envelope = Buffer.concat([Buffer.from([0x30, 0x7f]), Buffer.from(`{"payload":"${b64(inner)}"}`, 'latin1')])
      expect([...scanFrame({ opcode: 2, payloadData: envelope.toString('base64') }).kinds]).toEqual(['CreateReaction'])
    }
  })

  it('does not decode base64 runs in frames without any marker', () => {
    const payloadData = JSON.stringify({ blob: b64(JSON.stringify({ presence: 'online', pad: 'z'.repeat(120) })) })
    const scan = scanFrame({ opcode: 1, payloadData })
    expect(scan.text).toBe(payloadData)
    expect(scan.kinds.size).toBe(0)
  })

  it('skips frames too short to hold a marker', () => {
    expect(scanFrame({ opcode: 2, payloadData: '0AA=' })).toEqual({ text: '', kinds: new Set(), typing: [] })
  })

  it('keeps plain text typing detection', () => {
    const value = JSON.stringify({ sender_id: '7', activity_status: 0 })
    const patch = JSON.stringify({ data: [{ path: '/direct_v2/threads/123/activity_indicator_id/abc', value }] })
    expect(scanFrame({ opcode: 1, payloadData: patch }).typing).toEqual([{ threadId: '123', senderId: '7', typing: false }])
  })
})

describe('blockHeavyResources', () => {
  it('cancels heavy requests of its own web contents only, and installs one listener per session', () => {
    let listener: ((details: { webContentsId?: number }, cb: (r: { cancel?: boolean }) => void) => void) | undefined
    const onBeforeRequest = vi.fn((_filter: unknown, l: typeof listener) => (listener = l))
    const session = { webRequest: { onBeforeRequest } }
    const destroyed: Array<() => void> = []
    const contents = (id: number) => ({ id, session, once: (_e: string, fn: () => void) => destroyed.push(fn) })
    blockHeavyResources(contents(5) as never)
    blockHeavyResources(contents(6) as never)
    expect(onBeforeRequest).toHaveBeenCalledTimes(1)
    expect(onBeforeRequest.mock.calls[0][0]).toEqual({ urls: ['<all_urls>'], types: ['image', 'media', 'font'] })
    const verdict = (webContentsId?: number): boolean | undefined => {
      let cancel: boolean | undefined
      listener!({ webContentsId }, (r) => (cancel = r.cancel))
      return cancel
    }
    expect(verdict(5)).toBe(true)
    expect(verdict(6)).toBe(true)
    // The composer and the web client share the partition: their images still load.
    expect(verdict(9)).toBe(false)
    expect(verdict(undefined)).toBe(false)
    destroyed[0]()
    expect(verdict(5)).toBe(false)
  })
})

describe('RefreshThrottle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces a burst and keeps realtime refreshes at least minGap apart, with a trailing run', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const throttle = new RefreshThrottle(run, 350, 4000)
    throttle.trigger()
    throttle.trigger()
    vi.advanceTimersByTime(350)
    expect(run).toHaveBeenCalledTimes(1)
    // Receipts keep coming: nothing runs before the gap is over, but the last one is not lost.
    for (let t = 0; t < 10; t++) {
      vi.advanceTimersByTime(300)
      throttle.trigger()
    }
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(2)
    // Quiet afterwards: the next event only waits the coalescing delay.
    vi.advanceTimersByTime(10_000)
    throttle.trigger()
    vi.advanceTimersByTime(350)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('cancel drops a pending run', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const throttle = new RefreshThrottle(run, 350, 4000)
    throttle.trigger()
    throttle.cancel()
    vi.advanceTimersByTime(10_000)
    expect(run).not.toHaveBeenCalled()
  })
})
