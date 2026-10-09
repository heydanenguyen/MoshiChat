import { mkdtempSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir = ''
vi.mock('electron', () => ({
  app: { getPath: () => dir, getLocale: () => 'en-US' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { Storage } = await import('../src/main/storage')

const file = () => join(dir, 'unison.json')
const read = async (name: string) => JSON.parse(await fs.readFile(join(dir, name), 'utf8'))
const account = (id: string) => ({ id, platform: 'zalo' as const, displayName: id })

/** Make the next `times` renames of the store file fail with the given error code. */
function failRename(times: number, code = 'EPERM') {
  const real = fs.rename.bind(fs)
  let left = times
  return vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === file() && left-- > 0) throw Object.assign(new Error(`${code}: rename`), { code })
    return real(from, to)
  })
}

/** Make the next `times` reads of the store file fail with the given error code. */
function failRead(times: number, code = 'EBUSY') {
  const real = fs.readFile.bind(fs) as (...args: unknown[]) => Promise<unknown>
  let left = times
  return vi.spyOn(fs, 'readFile').mockImplementation((async (path: unknown, ...rest: unknown[]) => {
    if (String(path) === file() && left-- > 0) throw Object.assign(new Error(`${code}: read`), { code })
    return real(path, ...rest)
  }) as never)
}

/** Let the retry sleeps pass without waiting: only setTimeout is faked, the real file I/O still runs. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false
  promise.then(() => (done = true), () => (done = true))
  while (!done) {
    await new Promise((resolve) => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(100)
  }
  return promise
}

describe('Storage durability', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'moshi-storage-'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.useFakeTimers({ toFake: ['setTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('a rename that fails once is retried, and the next persist still works', async () => {
    const storage = new Storage()
    await storage.load()
    const rename = failRename(1)
    await settle(storage.upsertAccount(account('a')))
    expect((await read('unison.json')).accounts.map((a: { id: string }) => a.id)).toEqual(['a'])
    expect(rename.mock.calls.filter(([, to]) => String(to) === file())).toHaveLength(2)
    await storage.upsertAccount(account('b'))
    expect((await read('unison.json')).accounts.map((a: { id: string }) => a.id)).toEqual(['a', 'b'])
  })

  it('a rename that fails three times rejects that persist only', async () => {
    const storage = new Storage()
    await storage.load()
    failRename(3)
    await expect(settle(storage.upsertAccount(account('a')))).rejects.toThrow('EPERM')
    expect(await fs.readdir(dir)).not.toContain('unison.json.tmp')
    await storage.upsertAccount(account('b'))
    // the in-memory data holds both, so the successful write carries the earlier change too
    expect((await read('unison.json')).accounts.map((a: { id: string }) => a.id)).toEqual(['a', 'b'])
  })

  it('does not retry an error that is not a file lock', async () => {
    const storage = new Storage()
    await storage.load()
    const rename = failRename(1, 'ENOSPC')
    await expect(storage.upsertAccount(account('a'))).rejects.toThrow('ENOSPC')
    expect(rename.mock.calls.filter(([, to]) => String(to) === file())).toHaveLength(1)
  })

  it('a corrupt store is set aside and the backup is used', async () => {
    const first = new Storage()
    await first.load()
    await first.upsertAccount(account('a'))
    await first.upsertAccount(account('b'))
    await fs.writeFile(file(), '{"version":1,"accounts":[{"id":"x"', 'utf8')

    const storage = new Storage()
    await storage.load()
    expect(storage.recovered).toBe('backup')
    expect(storage.accounts.map((a) => a.id)).toEqual(['a'])
    const names = await fs.readdir(dir)
    const corrupt = names.filter((n) => n.startsWith('unison.json.corrupt-'))
    expect(corrupt).toHaveLength(1)
    expect(corrupt[0]).not.toContain(':')
    expect(await fs.readFile(join(dir, corrupt[0]), 'utf8')).toContain('"id":"x"')
  })

  it('a corrupt store with no backup starts empty but keeps the broken file', async () => {
    await fs.writeFile(file(), 'not json', 'utf8')
    const storage = new Storage()
    await storage.load()
    expect(storage.recovered).toBe('empty')
    expect(storage.accounts).toEqual([])
    expect((await fs.readdir(dir)).some((n) => n.startsWith('unison.json.corrupt-'))).toBe(true)
  })

  it('a first run (no file) is not a recovery', async () => {
    const storage = new Storage()
    await storage.load()
    expect(storage.recovered).toBe('none')
    expect(await fs.readdir(dir)).toEqual([])
  })

  it('keeps the previous store as unison.json.bak', async () => {
    const storage = new Storage()
    await storage.load()
    await storage.upsertAccount(account('a'))
    await storage.upsertAccount(account('b'))
    expect((await read('unison.json.bak')).accounts.map((a: { id: string }) => a.id)).toEqual(['a'])
    expect((await read('unison.json')).accounts.map((a: { id: string }) => a.id)).toEqual(['a', 'b'])
  })

  it('flush resolves once every queued write has landed, even a failed one', async () => {
    const storage = new Storage()
    await storage.load()
    const writes = [storage.upsertAccount(account('a')), storage.upsertAccount(account('b')), storage.upsertAccount(account('c'))]
    await storage.flush()
    expect((await read('unison.json')).accounts).toHaveLength(3)
    await Promise.all(writes)

    failRename(3)
    const failing = storage.upsertAccount(account('d')).catch((e: Error) => e)
    await expect(settle(storage.flush())).resolves.toBeUndefined()
    expect(await failing).toBeInstanceOf(Error)
  })

  it('a read that is briefly locked is retried and the store is not set aside', async () => {
    const first = new Storage()
    await first.load()
    await first.upsertAccount(account('a'))

    const read1 = failRead(1)
    const storage = new Storage()
    await settle(storage.load())
    expect(read1.mock.calls.filter(([p]) => String(p) === file())).toHaveLength(2)
    expect(storage.recovered).toBe('none')
    expect(storage.accounts.map((a) => a.id)).toEqual(['a'])
    expect((await fs.readdir(dir)).filter((n) => n.includes('corrupt'))).toEqual([])
  })

  it('a read that stays locked is set aside after three tries', async () => {
    const first = new Storage()
    await first.load()
    await first.upsertAccount(account('a'))
    await first.upsertAccount(account('b'))

    const read1 = failRead(3)
    const storage = new Storage()
    await settle(storage.load())
    expect(read1.mock.calls.filter(([p]) => String(p) === file())).toHaveLength(3)
    expect(storage.recovered).toBe('backup')
  })

  it('when the broken file cannot be set aside, the next save does not copy it over the good backup', async () => {
    const first = new Storage()
    await first.load()
    await first.upsertAccount(account('a'))
    await first.upsertAccount(account('b'))
    await fs.writeFile(file(), 'not json', 'utf8')

    const real = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).includes('.corrupt-')) throw Object.assign(new Error('EPERM: rename'), { code: 'EPERM' })
      return real(from, to)
    })
    const storage = new Storage()
    await settle(storage.load())
    expect(storage.recovered).toBe('backup')
    await settle(storage.upsertAccount(account('c')))
    expect((await read('unison.json.bak')).accounts.map((a: { id: string }) => a.id)).toEqual(['a'])
    expect((await read('unison.json')).accounts.map((a: { id: string }) => a.id)).toEqual(['a', 'c'])
    // once a good file is in place, backups resume
    await settle(storage.upsertAccount(account('d')))
    expect((await read('unison.json.bak')).accounts.map((a: { id: string }) => a.id)).toEqual(['a', 'c'])
  })
})
