import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../src/shared/types'

const dir = mkdtempSync(join(tmpdir(), 'moshi-lock-'))
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  powerMonitor: { on: () => undefined, getSystemIdleTime: () => 0 }
}))

const { AppLock, validPasscode } = await import('../src/main/lock')
type Storage = import('../src/main/storage').Storage

function setup(settings: Partial<Settings> = {}) {
  const store = { settings: settings as Settings }
  const storage = {
    get settings() {
      return store.settings
    },
    async setSettings(patch: Partial<Settings>) {
      store.settings = { ...store.settings, ...patch }
      return store.settings
    }
  } as unknown as Storage
  const events: unknown[] = []
  return { lock: new AppLock(storage, (e) => events.push(e), () => undefined), store, events }
}

describe('AppLock', () => {
  beforeEach(async () => {
    // A clean slate: no secret file from the previous test.
    const { lock } = setup()
    await lock.load()
  })

  it('accepts 4 to 8 digits only', () => {
    expect(validPasscode('1234')).toBe(true)
    expect(validPasscode('12345678')).toBe(true)
    expect(validPasscode('123')).toBe(false)
    expect(validPasscode('12a4')).toBe(false)
    expect(validPasscode(1234)).toBe(false)
  })

  it('keeps the code out of settings, starts locked next time and opens only with the right code', async () => {
    const first = setup()
    await first.lock.enable('2468')
    expect(first.store.settings.appLock).toEqual({ length: 4, autoLock: 5 })
    expect(JSON.stringify(first.store.settings)).not.toContain('2468')
    const file = JSON.parse(await readFile(join(dir, 'lock.json'), 'utf8'))
    expect(file.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(file.hash).not.toContain('2468')

    const next = setup(first.store.settings)
    await next.lock.load()
    expect(next.lock.state()).toMatchObject({ enabled: true, locked: true, length: 4 })
    expect((await next.lock.unlock('1111')).ok).toBe(false)
    expect(next.lock.isLocked()).toBe(true)
    expect((await next.lock.unlock('2468')).ok).toBe(true)
    expect(next.lock.isLocked()).toBe(false)
    next.lock.lock()
    expect(next.lock.isLocked()).toBe(true)
  })

  it('makes each try wait after five wrong codes, even the right one', async () => {
    const { lock } = setup()
    await lock.enable('2468')
    lock.lock()
    for (let i = 0; i < 4; i++) expect((await lock.unlock('0000')).retryIn).toBeUndefined()
    const fifth = await lock.unlock('0000')
    expect(fifth.retryIn).toBeGreaterThan(25_000)
    expect((await lock.unlock('2468')).ok).toBe(false)
    expect(lock.isLocked()).toBe(true)
  })

  it('changes and turns off only with the current code', async () => {
    const { lock, store } = setup()
    await lock.enable('2468')
    await expect(lock.change('0000', '135790')).rejects.toThrow('wrong-code')
    await lock.change('2468', '135790')
    expect(store.settings.appLock?.length).toBe(6)
    lock.lock()
    expect((await lock.unlock('135790')).ok).toBe(true)
    await expect(lock.disable('2468')).rejects.toThrow('wrong-code')
    await lock.disable('135790')
    expect(store.settings.appLock).toBeUndefined()
    expect(lock.state()).toMatchObject({ enabled: false, locked: false })
  })

  it('drops a lock setting that has no code on this computer (copied from elsewhere)', async () => {
    const { lock, store } = setup({ appLock: { length: 4, autoLock: 5 } })
    await lock.load()
    expect(store.settings.appLock).toBeUndefined()
    expect(lock.isLocked()).toBe(false)
  })

  it('forgot the code: signs everything out and removes the lock', async () => {
    const { lock, store } = setup()
    await lock.enable('2468')
    lock.lock()
    const signOut = vi.fn(async () => undefined)
    await lock.reset(signOut)
    expect(signOut).toHaveBeenCalledOnce()
    expect(store.settings.appLock).toBeUndefined()
    expect(lock.isLocked()).toBe(false)
  })
})
