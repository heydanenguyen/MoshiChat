import { describe, expect, it, vi } from 'vitest'

// The pieces of the manager that touch the OS are replaced: a window that says it is closed a tick after close() is asked,
// and a launcher that (like Zalo's) wipes what the window stored from the window's own closed handler.
const wipes: Array<{ started: boolean; finished: boolean }> = []
const launched: number[] = []

vi.mock('electron', () => ({ ipcMain: { on: vi.fn() }, BrowserWindow: class {} }))

vi.mock('../src/main/calls/call-window', () => ({
  CallWindow: class {
    private handlers: Array<() => void> = []
    private gone = false
    private done: Promise<void>
    private settle: () => void = () => undefined
    constructor() {
      this.done = new Promise((resolve) => (this.settle = resolve))
    }
    get isClosed(): boolean {
      return this.gone
    }
    isFrame(): boolean {
      return false
    }
    owns(): boolean {
      return false
    }
    show(): void {}
    minimize(): void {}
    onClosed(handler: () => void): void {
      this.handlers.push(handler)
    }
    closed(): Promise<void> {
      return this.done
    }
    close(): void {
      // Electron's window says 'closed' a tick after close().
      setTimeout(() => {
        this.gone = true
        for (const handler of this.handlers.splice(0)) handler()
        this.settle()
      }, 5)
    }
  }
}))

vi.mock('../src/main/calls/launchers/zalo', () => ({
  zaloLauncher: {
    async start(_target: unknown, _kind: unknown, env: { open(o: unknown): { onClosed(h: () => void): void; close(): void }; track(w: Promise<unknown>): void }) {
      launched.push(Date.now())
      const win = env.open({ partition: 'p', userAgent: 'ua', hosts: [], info: { name: 'x', platform: 'zalo', kind: 'audio' } })
      win.onClosed(() => {
        const wipe = { started: true, finished: false }
        wipes.push(wipe)
        env.track(new Promise((resolve) => setTimeout(resolve, 30)).then(() => void (wipe.finished = true)))
      })
      return { end: () => win.close(), onEnded: (h: () => void) => win.onClosed(h), settled: Promise.resolve('clicked' as const) }
    }
  }
}))
vi.mock('../src/main/calls/launchers/messenger', () => ({ messengerLauncher: {} }))
vi.mock('../src/main/calls/launchers/instagram', () => ({ instagramLauncher: {} }))

import { CallManager } from '../src/main/calls/manager'

function manager() {
  const account = { id: 'zalo:1', platform: 'zalo', displayName: 'Z', status: 'connected', features: { reply: true, react: true, attachments: true } }
  const conversation = { id: 'zalo:1:42', accountId: 'zalo:1', title: 'Lan' }
  const events: Array<{ type: string }> = []
  const calls = new CallManager({
    backend: { account: () => account, conversation: () => conversation, partition: () => 'p', zaloCredentials: () => undefined, zalo: () => undefined } as never,
    emit: (e) => events.push(e),
    log: () => undefined,
    language: () => 'en',
    background: () => '#000',
    icon: () => undefined,
    probeFile: 'does-not-exist.json',
    callSettings: () => ({ incomingMessenger: true, incomingInstagram: true, ring: true })
  })
  return { calls, events }
}

describe('CallManager shutdown', () => {
  it('waits for the window to be closed, and then for the wipe its closed handler starts', async () => {
    wipes.length = 0
    const { calls } = manager()
    await calls.start('zalo:1:42', 'audio')
    expect(calls.state().active).toBeDefined()
    await calls.shutdown()
    // Without waiting for 'closed', pending was empty here and the wipe was still running (or never tracked).
    expect(wipes).toHaveLength(1)
    expect(wipes[0]!.finished).toBe(true)
    expect(calls.state().active).toBeUndefined()
  })
})

describe('back-to-back calls', () => {
  it('does not start the next call before the last one has been tidied', async () => {
    wipes.length = 0
    launched.length = 0
    const { calls } = manager()
    await calls.start('zalo:1:42', 'audio')
    const id = calls.state().active!.id
    calls.end(id)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls.state().active).toBeUndefined()
    expect(wipes[0]!.finished).toBe(false)
    // The window is gone but its wipe (and, for Zalo, the connection coming back) is not done: the next start waits.
    await calls.start('zalo:1:42', 'audio')
    expect(launched).toHaveLength(2)
    expect(wipes[0]!.finished).toBe(true)
    await calls.shutdown()
  })

  it('refuses a second start while one is under way', async () => {
    const { calls } = manager()
    await calls.start('zalo:1:42', 'audio')
    await expect(calls.start('zalo:1:42', 'audio')).rejects.toThrow(/already open/)
    await calls.shutdown()
  })
})
