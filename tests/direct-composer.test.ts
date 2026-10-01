import { afterEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above everything else, so the fake window class has to be too.
const { FakeWindow, windows } = vi.hoisted(() => {
  const windows: InstanceType<typeof FakeWindow>[] = []

  class FakeWindow {
    destroyed = false
    url = ''
    webContents = {
      setAudioMuted: vi.fn(),
      openDevTools: vi.fn(),
      getURL: () => this.url,
      // Every page script answers "no text box", like a thread that never opens.
      executeJavaScript: vi.fn(async () => 'NO_TEXTBOX')
    }
    constructor() {
      windows.push(this)
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    destroy(): void {
      this.destroyed = true
    }
    async loadURL(url: string): Promise<void> {
      this.url = url
    }
  }
  return { FakeWindow, windows }
})

vi.mock('electron', () => ({ BrowserWindow: FakeWindow, app: { getPath: () => '' }, session: { fromPartition: () => ({}) } }))

import { DirectComposer } from '../src/main/direct-composer'

describe('DirectComposer idle close', () => {
  afterEach(() => {
    vi.useRealTimers()
    windows.length = 0
  })

  it('closes the hidden window after a failed send too', async () => {
    vi.useFakeTimers()
    const composer = new DirectComposer('persist:test')
    await expect(composer.send('https://www.instagram.com/direct/t/1/', 'hi')).rejects.toThrow(/could not open/i)
    expect(windows).toHaveLength(1)
    expect(windows[0].destroyed).toBe(false)
    vi.advanceTimersByTime(3 * 60_000)
    expect(windows[0].destroyed).toBe(true)
  })

  it('re-arms after a failed sticker or file send', async () => {
    vi.useFakeTimers()
    const composer = new DirectComposer('persist:test')
    await expect(composer.sendSticker('https://www.instagram.com/direct/t/1/', { id: 'g', queries: ['cat'] })).rejects.toThrow()
    vi.advanceTimersByTime(3 * 60_000)
    expect(windows[0].destroyed).toBe(true)
    await expect(composer.sendFiles('https://www.instagram.com/direct/t/1/', ['a.png'])).rejects.toThrow()
    expect(windows).toHaveLength(2)
    vi.advanceTimersByTime(3 * 60_000)
    expect(windows[1].destroyed).toBe(true)
  })
})
