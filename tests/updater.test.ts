import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../src/shared/types'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  allowDowngrade = true
  logger: unknown
  downloadUpdate = vi.fn(async () => [])
  checkForUpdates = vi.fn(async () => undefined)
  quitAndInstall = vi.fn()
}
let fake = new FakeUpdater()

vi.mock('electron', () => ({ app: { isPackaged: true, getAppPath: () => 'C:/Moshi/resources/app.asar' }, shell: { openExternal: vi.fn() } }))
vi.mock('electron-updater', () => ({
  get autoUpdater() {
    return fake
  }
}))

const { Updater } = await import('../src/main/updater')

async function started(automatic: boolean): Promise<{ states: UpdateState[]; updater: InstanceType<typeof Updater> }> {
  const states: UpdateState[] = []
  const updater = new Updater((s) => states.push(s), () => undefined, () => automatic)
  await updater.start()
  updater.stop()
  return { states, updater }
}

const realPlatform = process.platform
const onPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('updates', () => {
  beforeEach(() => {
    fake = new FakeUpdater()
    vi.useFakeTimers()
    // Windows (and a signed Mac) replace themselves; an unsigned Mac is covered below.
    onPlatform('win32')
  })
  afterEach(() => onPlatform(realPlatform))

  it('only offers the download page on an unsigned Mac', async () => {
    onPlatform('darwin')
    const { states } = await started(true)
    fake.emit('update-available', { version: '0.3.0' })
    expect(fake.downloadUpdate).not.toHaveBeenCalled()
    expect(states.at(-1)).toMatchObject({ phase: 'available', version: '0.3.0', manual: true })
  })

  it('downloads a new version quietly when automatic, then offers the restart', async () => {
    const { states } = await started(true)
    fake.emit('update-available', { version: '0.3.0' })
    expect(fake.downloadUpdate).toHaveBeenCalledOnce()
    expect(states.some((s) => s.phase === 'available')).toBe(false)
    fake.emit('download-progress', { percent: 42.4 })
    expect(states.at(-1)).toEqual({ phase: 'downloading', version: '0.3.0', percent: 42, background: true })
    fake.emit('update-downloaded', { version: '0.3.0' })
    expect(states.at(-1)).toEqual({ phase: 'ready', version: '0.3.0' })
    expect(fake.autoInstallOnAppQuit).toBe(true)
  })

  it('asks first when automatic updates are off', async () => {
    const { states, updater } = await started(false)
    fake.emit('update-available', { version: '0.3.0' })
    expect(fake.downloadUpdate).not.toHaveBeenCalled()
    expect(states.at(-1)).toMatchObject({ phase: 'available', version: '0.3.0' })
    await updater.download()
    expect(fake.downloadUpdate).toHaveBeenCalledOnce()
    expect(states.at(-1)).toMatchObject({ phase: 'downloading', percent: 0 })
    expect(states.at(-1)).not.toHaveProperty('background', true)
  })

  it('falls back to a normal offer when the quiet download fails', async () => {
    const { states } = await started(true)
    fake.emit('update-available', { version: '0.3.0' })
    fake.emit('error', new Error('net::ERR_CONNECTION_RESET'))
    expect(states.at(-1)).toMatchObject({ phase: 'available', version: '0.3.0' })
  })

  it('shows a quiet download once the person asks for it', async () => {
    const { states, updater } = await started(true)
    fake.emit('update-available', { version: '0.3.0' })
    fake.emit('download-progress', { percent: 10 })
    await updater.download()
    expect(fake.downloadUpdate).toHaveBeenCalledOnce()
    expect(states.at(-1)).toEqual({ phase: 'downloading', version: '0.3.0', percent: 10 })
    fake.emit('download-progress', { percent: 60 })
    expect(states.at(-1)).toEqual({ phase: 'downloading', version: '0.3.0', percent: 60 })
  })
})
