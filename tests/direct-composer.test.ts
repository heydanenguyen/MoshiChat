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

describe('DirectComposer sticker outcome', () => {
  afterEach(() => {
    windows.length = 0
  })

  /** The thread opens; the sticker script answers `outcome`; the page description is empty. */
  function composerAnswering(outcome: string): DirectComposer {
    const composer = new DirectComposer('persist:test')
    const answers = ['OK', outcome]
    const ready = (composer as unknown as { ensure(): InstanceType<typeof FakeWindow> }).ensure()
    ready.webContents.executeJavaScript.mockImplementation(async () => answers.shift() ?? '{}')
    return composer
  }

  it('a tray left open with nothing sent is a failure, so the caller falls back', async () => {
    await expect(composerAnswering('TRAY_OPEN').sendSticker('https://www.instagram.com/direct/t/1/', { id: 'g', queries: ['cat'] })).rejects.toThrow(/TRAY_OPEN/)
  })

  it('a tapped sticker, one sent with the send button, or one that landed in the conversation is a success', async () => {
    await expect(composerAnswering('OK_LANDED').sendSticker('https://www.instagram.com/direct/t/1/', { id: 'g', queries: ['cat'] })).resolves.toBeUndefined()
    await expect(composerAnswering('OK').sendSticker('https://www.instagram.com/direct/t/1/', { id: 'g', queries: ['cat'] })).resolves.toBeUndefined()
    await expect(composerAnswering('OK_SEND').sendSticker('https://www.instagram.com/direct/t/1/', { id: 'g', queries: ['cat'] })).resolves.toBeUndefined()
  })

  it('checks, before giving up on an open tray, whether the sticker turned up outside it', async () => {
    const composer = composerAnswering('OK')
    const run = (composer as unknown as { ensure(): InstanceType<typeof FakeWindow> }).ensure().webContents.executeJavaScript
    await composer.sendSticker('https://www.instagram.com/direct/t/1/', { id: 'g', queries: ['cat'] })
    const script = String(run.mock.calls.find((c) => String(c[0]).includes('TRAY_OPEN'))?.[0])
    // the picture must be new, not inside the tray, and carry the sticker's id in its address
    expect(script).toMatch(/!before\.has\(el\) && !tray\.contains\(el\) && srcOf\(el\)\.includes\('\/' \+ id \+ '\/'\)/)
    expect(script.indexOf('OK_LANDED')).toBeLessThan(script.indexOf("'TRAY_OPEN'"))
  })
})
