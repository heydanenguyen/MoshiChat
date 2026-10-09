import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

const { ZaloAdapter } = await import('../src/main/adapters/zalo')
let lastAdapter: InstanceType<typeof ZaloAdapter> | undefined

type Emitted = { type: string; message?: { id: string }; account?: { status: string } }

const raw = (msgId: string, ts: number, uidFrom = 'friend') => ({ msgId, cliMsgId: msgId, uidFrom, dName: 'Lan', ts: String(ts), msgType: 'webchat', content: `tin ${msgId}` })

function setup(): { emitted: Emitted[]; listener: EventEmitter; api: { listener: EventEmitter } } {
  const emitted: Emitted[] = []
  const ctx = { emit: (e: Emitted) => emitted.push(e), log: () => undefined, dataDir: () => '', saveSecret: async () => undefined }
  const adapter = new ZaloAdapter({ id: 'zalo:me', platform: 'zalo', displayName: 'Me', status: 'connected' } as never, {}, ctx as never)
  const listener = Object.assign(new EventEmitter(), { requestOldMessages: () => undefined, requestOldReactions: () => undefined })
  const internals = adapter as unknown as { meId: string; raw: Map<string, unknown[]>; threadTypes: Map<string, number>; wireListener(api: unknown, zca: unknown): void }
  internals.meId = 'me-uid'
  // what this computer had: an older message in the chat with Lan
  internals.raw.set('lan', [raw('1', 1_000)])
  internals.threadTypes.set('lan', 0)
  const api = { listener }
  internals.wireListener(api, {})
  lastAdapter = adapter
  return { emitted, listener, api }
}

describe('Zalo messages written on another computer', () => {
  it('reach an open chat as updates once this computer signs in again', () => {
    const { emitted, listener } = setup()
    // the account-wide history feed after signing in: two messages from today, and the old one again
    listener.emit('old_messages', [
      { threadId: 'lan', type: 0, data: raw('2', 5_000, 'me-uid') },
      { threadId: 'lan', type: 0, data: raw('3', 6_000) },
      { threadId: 'lan', type: 0, data: raw('1', 1_000) }
    ], 0)
    const updates = emitted.filter((e) => e.type === 'message:updated').map((e) => e.message!.id)
    expect(updates).toEqual(['2', '3'])
    // never as new messages: no sound and no unread count for what may already have been read elsewhere
    expect(emitted.some((e) => e.type === 'message:new')).toBe(false)
  })

  it('leave older history alone (it is loaded when the chat is scrolled)', () => {
    const { emitted, listener } = setup()
    listener.emit('old_messages', [{ threadId: 'lan', type: 0, data: raw('0', 500) }], 0)
    expect(emitted.filter((e) => e.type === 'message:updated')).toEqual([])
  })
})

describe('Zalo history beyond the cache', () => {
  it('is kept in the archive and read when the chat is scrolled past the cache', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { ZaloArchive } = await import('../src/main/adapters/zalo-archive')
    const { listener } = setup()
    const adapter = lastAdapter!
    const internals = adapter as unknown as { archive: unknown; raw: Map<string, Array<{ msgId: string }>>; flushArchive(): Promise<void> }
    internals.archive = new ZaloArchive(await mkdtemp(join(tmpdir(), 'zalo-archive-')))
    // a full cache (1,000 messages), then the history walk brings 5 older ones
    internals.raw.set('lan', Array.from({ length: 1000 }, (_, i) => raw(`n${i}`, 100_000 + i)))
    listener.emit('old_messages', Array.from({ length: 5 }, (_, i) => ({ threadId: 'lan', type: 0, data: raw(`o${i}`, 10_000 + i) })), 0)
    await internals.flushArchive()
    expect(internals.raw.get('lan')!.length).toBe(1000)
    const oldestCached = internals.raw.get('lan')![0].msgId
    const older = await adapter.fetchMessages('zalo:me/lan', { limit: 50, beforeId: oldestCached })
    expect(older.map((m) => m.id)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4'])
  })

  it('a history sync walks until Zalo has nothing older, with progress', async () => {
    const { listener } = setup()
    const adapter = lastAdapter!
    const asked: Array<[number, string | undefined]> = []
    Object.assign(listener, { requestOldMessages: (type: number, below?: string) => asked.push([type, below]) })
    ;(adapter as unknown as { api: unknown }).api = { listener }
    const progress: number[] = []
    const done = adapter.syncHistory((p) => progress.push(p.pages))
    await Promise.resolve()
    // a page for direct chats, then nothing older for either kind
    listener.emit('old_messages', [{ threadId: 'lan', type: 0, data: raw('9', 900) }], 0)
    listener.emit('old_messages', [], 0)
    listener.emit('old_messages', [], 1)
    const result = await done
    expect(result).toMatchObject({ added: 1, reachedEnd: true })
    expect(progress.length).toBe(3)
  })
})

describe('A Zalo socket that drops', () => {
  const statusOf = (emitted: Emitted[]): string | undefined => emitted.filter((e) => e.type === 'account:updated').at(-1)?.account?.status

  it('is started again with growing waits once zca-js stops retrying, until Zalo hands out a key', () => {
    vi.useFakeTimers()
    try {
      const { emitted, listener, api } = setup()
      ;(lastAdapter as unknown as { api: unknown }).api = api
      const start = vi.fn()
      Object.assign(listener, { start })
      listener.emit('closed', 1006, '')
      expect(statusOf(emitted)).toBe('connecting')
      vi.advanceTimersByTime(1_500)
      expect(start).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1_000)
      expect(start).toHaveBeenCalledWith({ retryOnClose: true })
      // failing again waits longer (about 4 s)
      listener.emit('closed', 1006, '')
      vi.advanceTimersByTime(3_000)
      expect(start).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(2_000)
      expect(start).toHaveBeenCalledTimes(2)
      // a working socket gets its key: connected again, and the next drop starts from 2 s
      listener.emit('cipher_key', 'key')
      expect(statusOf(emitted)).toBe('connected')
      listener.emit('closed', 1006, '')
      vi.advanceTimersByTime(2_500)
      expect(start).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('tries again when starting the socket throws', () => {
    vi.useFakeTimers()
    try {
      const { listener, api } = setup()
      ;(lastAdapter as unknown as { api: unknown }).api = api
      const start = vi.fn(() => {
        throw new Error('Already started')
      })
      Object.assign(listener, { start })
      listener.emit('closed', 1006, '')
      vi.advanceTimersByTime(2_500)
      expect(start).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(5_000)
      expect(start).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is not started again when Zalo signed the session out', () => {
    vi.useFakeTimers()
    try {
      const { emitted, listener, api } = setup()
      ;(lastAdapter as unknown as { api: unknown }).api = api
      const start = vi.fn()
      Object.assign(listener, { start })
      listener.emit('closed', 3000, '')
      expect(statusOf(emitted)).toBe('needs_auth')
      vi.advanceTimersByTime(120_000)
      expect(start).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('The Zalo message cache on disk', () => {
  async function tempDir(): Promise<string> {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    return mkdtemp(join(tmpdir(), 'zalo-cache-'))
  }

  it('is written before disconnect returns, whole, with no temporary file left', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = await tempDir()
    const { listener } = setup()
    const adapter = lastAdapter!
    ;(adapter as unknown as { cacheFile: string }).cacheFile = join(dir, 'zalo-cache-me.json')
    listener.emit('message', { threadId: 'lan', type: 0, isSelf: false, data: raw('5', 9_000) })
    await adapter.disconnect()
    // read right away (synchronously): nothing may still be on its way to the disk
    expect(readdirSync(dir)).toEqual(['zalo-cache-me.json'])
    const saved = JSON.parse(readFileSync(join(dir, 'zalo-cache-me.json'), 'utf8')) as { threads: Array<[string, number, Array<{ msgId: string }>]> }
    expect(saved.threads.find(([id]) => id === 'lan')![2].map((m) => m.msgId)).toEqual(['1', '5'])
  })

  it('keeps the previous copy and falls back to it when the main file is damaged', async () => {
    const { readFile, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const dir = await tempDir()
    const file = join(dir, 'zalo-cache-me.json')
    setup()
    const internals = lastAdapter as unknown as {
      cacheFile: string
      raw: Map<string, Array<{ msgId: string }>>
      loadCache(): Promise<void>
      disconnect(): Promise<void>
      scheduleSave(): void
    }
    internals.cacheFile = file
    await writeFile(file, JSON.stringify({ version: 1, threads: [['lan', 0, [raw('7', 7_000)]]] }))
    internals.scheduleSave()
    await internals.disconnect()
    expect(JSON.parse(await readFile(`${file}.bak`, 'utf8')).threads[0][2][0].msgId).toBe('7')
    // the main file cut short (power lost mid-write): the previous copy is read instead
    await writeFile(file, '{"version":1,"threads":[["lan",0,[{"msgId":')
    internals.raw.clear()
    await internals.loadCache()
    expect(internals.raw.get('lan')!.map((m) => m.msgId)).toEqual(['7'])
  })
})

describe('A Zalo socket that keeps failing to come back', () => {
  const statusOf = (emitted: Emitted[]): string | undefined => emitted.filter((e) => e.type === 'account:updated').at(-1)?.account?.status

  async function failRestarts(listener: EventEmitter, times: number): Promise<void> {
    listener.emit('closed', 1006, '')
    for (let i = 0; i < times; i++) {
      await vi.advanceTimersByTimeAsync(80_000)
      listener.emit('closed', 1006, '')
    }
    await vi.advanceTimersByTimeAsync(0)
  }

  // what zca-js throws from an account-info call (dist/utils.js handleZaloResponse)
  const zaloError = (message: string, code?: number): Error => Object.assign(new Error(message), { name: 'ZcaApiError', code: code ?? null })

  for (const [name, error] of [
    ['an answer with a Zalo error code', zaloError('Session expired', 114)],
    ['an HTTP 401', zaloError('Request failed with status code 401')]
  ] as const) {
    it(`asks Zalo after 8 and again after 16 failed restarts whether the session still exists, and stops at the second refusal (${name})`, async () => {
      vi.useFakeTimers()
      try {
        const { emitted, listener, api } = setup()
        const fetchAccountInfo = vi.fn(async () => {
          throw error
        })
        Object.assign(api, { fetchAccountInfo })
        ;(lastAdapter as unknown as { api: unknown }).api = api
        const start = vi.fn()
        Object.assign(listener, { start })
        await failRestarts(listener, 7)
        expect(fetchAccountInfo).not.toHaveBeenCalled()
        await failRestarts(listener, 0)
        expect(fetchAccountInfo).toHaveBeenCalledTimes(1)
        // one refusal is not enough
        expect(statusOf(emitted)).toBe('connecting')
        await failRestarts(listener, 8)
        expect(fetchAccountInfo).toHaveBeenCalledTimes(2)
        expect(statusOf(emitted)).toBe('needs_auth')
        const started = start.mock.calls.length
        await vi.advanceTimersByTimeAsync(120_000)
        expect(start).toHaveBeenCalledTimes(started)
      } finally {
        vi.useRealTimers()
      }
    })
  }

  it('does not give up on the session over a dropped network, however often it is asked', async () => {
    vi.useFakeTimers()
    try {
      const { emitted, listener, api } = setup()
      const fetchAccountInfo = vi.fn(async () => {
        throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
      })
      Object.assign(api, { fetchAccountInfo })
      ;(lastAdapter as unknown as { api: unknown }).api = api
      Object.assign(listener, { start: vi.fn() })
      await failRestarts(listener, 24)
      expect(fetchAccountInfo).toHaveBeenCalledTimes(3)
      expect(statusOf(emitted)).toBe('connecting')
    } finally {
      vi.useRealTimers()
    }
  })

  it('needs two refusals in a row: another answer in between starts the count again', async () => {
    vi.useFakeTimers()
    try {
      const { emitted, listener, api } = setup()
      const answers = [zaloError('Session expired', 114), new Error('read ECONNRESET'), zaloError('Session expired', 114)]
      const fetchAccountInfo = vi.fn(async () => {
        throw answers.shift()
      })
      Object.assign(api, { fetchAccountInfo })
      ;(lastAdapter as unknown as { api: unknown }).api = api
      Object.assign(listener, { start: vi.fn() })
      await failRestarts(listener, 24)
      expect(fetchAccountInfo).toHaveBeenCalledTimes(3)
      expect(statusOf(emitted)).toBe('connecting')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps trying when the session is fine (only the socket is down)', async () => {
    vi.useFakeTimers()
    try {
      const { emitted, listener, api } = setup()
      const fetchAccountInfo = vi.fn(async () => ({ profile: { displayName: 'Me' } }))
      Object.assign(api, { fetchAccountInfo })
      ;(lastAdapter as unknown as { api: unknown }).api = api
      const start = vi.fn()
      Object.assign(listener, { start })
      await failRestarts(listener, 8)
      expect(fetchAccountInfo).toHaveBeenCalledTimes(1)
      expect(statusOf(emitted)).toBe('connecting')
      const started = start.mock.calls.length
      await vi.advanceTimersByTimeAsync(80_000)
      expect(start.mock.calls.length).toBeGreaterThan(started)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is not restarted after disconnect, nor once a key arrived some other way', () => {
    vi.useFakeTimers()
    try {
      const { listener, api } = setup()
      const adapter = lastAdapter!
      ;(adapter as unknown as { api: unknown }).api = api
      const start = vi.fn()
      Object.assign(listener, { start, stop: () => undefined })
      listener.emit('closed', 1006, '')
      listener.emit('cipher_key', 'key')
      vi.advanceTimersByTime(60_000)
      expect(start).not.toHaveBeenCalled()
      listener.emit('closed', 1006, '')
      // the restart is waiting; disconnect must drop that timer itself (the callback also checks the api, which would hide a leftover)
      const waiting = vi.getTimerCount()
      void adapter.disconnect()
      expect(vi.getTimerCount()).toBe(waiting - 1)
      vi.advanceTimersByTime(60_000)
      expect(start).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Signing in to Zalo', () => {
  it('does not open the socket when the account was disconnected while signing in', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'zalo-connect-'))
    const emitted: Emitted[] = []
    const saveSecret = vi.fn(async () => undefined)
    const ctx = { emit: (e: Emitted) => emitted.push(e), log: () => undefined, dataDir: () => dir, saveSecret }
    const adapter = new ZaloAdapter('zalo:me-uid', { credentials: { cookie: [], imei: 'i', userAgent: 'u' } } as never, ctx as never)
    const listener = Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn(), requestOldMessages: () => undefined, requestOldReactions: () => undefined })
    let profileAsked!: (value: unknown) => void
    const api = { listener, getOwnId: () => 'me-uid', fetchAccountInfo: () => new Promise((resolve) => (profileAsked = resolve)) }
    ;(adapter as unknown as { zca: unknown }).zca = {
      Zalo: class {
        login = async (): Promise<unknown> => api
      }
    }
    const connecting = adapter.connect()
    await vi.waitFor(() => expect(profileAsked).toBeDefined())
    await adapter.disconnect()
    profileAsked({ profile: { displayName: 'Me' } })
    await connecting
    expect(listener.start).not.toHaveBeenCalled()
    expect(saveSecret).not.toHaveBeenCalled()
    expect(adapter.account.status).toBe('disconnected')
  })

  it('does not open the socket when the account was disconnected while its secret and cache were being read', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'zalo-connect-'))
    const emitted: Emitted[] = []
    let secretSaved!: () => void
    const saveSecret = vi.fn(() => new Promise<void>((resolve) => (secretSaved = resolve)))
    const ctx = { emit: (e: Emitted) => emitted.push(e), log: () => undefined, dataDir: () => dir, saveSecret }
    const adapter = new ZaloAdapter('zalo:me-uid', { credentials: { cookie: [], imei: 'i', userAgent: 'u' } } as never, ctx as never)
    const listener = Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn(), requestOldMessages: () => undefined, requestOldReactions: () => undefined })
    const api = { listener, getOwnId: () => 'me-uid', fetchAccountInfo: async () => ({ profile: { displayName: 'Me' } }) }
    ;(adapter as unknown as { zca: unknown }).zca = {
      Zalo: class {
        login = async (): Promise<unknown> => api
      }
    }
    const connecting = adapter.connect()
    await vi.waitFor(() => expect(saveSecret).toHaveBeenCalled())
    // removed (or quit) after the last check, while the awaits that follow it are still running: a socket opened now would be a stray session
    await adapter.disconnect()
    secretSaved()
    await connecting
    expect(listener.start).not.toHaveBeenCalled()
    expect(adapter.account.status).toBe('disconnected')
  })
})

describe('Disconnecting Zalo', () => {
  it('writes the archive before the cache, so the saved walk never counts messages that are on no disk', async () => {
    const { existsSync } = await import('node:fs')
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'zalo-order-'))
    setup()
    const internals = lastAdapter as unknown as {
      cacheFile: string
      archive: unknown
      archiveQueue: Map<string, unknown[]>
      archiveTimer?: NodeJS.Timeout
      scheduleSave(): void
      disconnect(): Promise<void>
    }
    internals.cacheFile = join(dir, 'zalo-cache-me.json')
    let cacheWrittenFirst: boolean | undefined
    internals.archive = { add: async () => void (cacheWrittenFirst = existsSync(internals.cacheFile)) }
    internals.archiveQueue.set('lan', [raw('o1', 10)])
    internals.archiveTimer = setTimeout(() => undefined, 60_000)
    internals.scheduleSave()
    await internals.disconnect()
    expect(cacheWrittenFirst).toBe(false)
    expect(existsSync(internals.cacheFile)).toBe(true)
  })
})

describe('Disconnecting Zalo while the archive is being written', () => {
  it('waits for a write already under way before saving the cache', async () => {
    const { existsSync } = await import('node:fs')
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'zalo-flight-'))
    setup()
    const internals = lastAdapter as unknown as {
      cacheFile: string
      archive: unknown
      archiveQueue: Map<string, unknown[]>
      flushArchive(): Promise<void>
      scheduleSave(): void
      disconnect(): Promise<void>
    }
    internals.cacheFile = join(dir, 'zalo-cache-me.json')
    let written!: () => void
    internals.archive = { add: () => new Promise<void>((resolve) => (written = resolve)) }
    internals.archiveQueue.set('lan', [raw('o1', 10)])
    // the flush has begun (its timer is gone) and the write is still running when the app quits
    void internals.flushArchive()
    internals.scheduleSave()
    let disconnected = false
    const closing = internals.disconnect().then(() => (disconnected = true))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(disconnected).toBe(false)
    expect(existsSync(internals.cacheFile)).toBe(false)
    written()
    await closing
    expect(existsSync(internals.cacheFile)).toBe(true)
  })
})

describe('The Zalo history walk on the socket', () => {
  type Internals = { api: unknown; syncCursors: Record<0 | 1, unknown>; startSync(api: unknown): void }
  const page = (...ids: Array<[string, number]>) => ids.map(([id, ts]) => ({ threadId: 'lan', type: 0, data: raw(id, ts) }))

  it('skips to a gap and still skips down to the oldest point after it', async () => {
    vi.useFakeTimers()
    try {
      const { listener, api } = setup()
      const internals = lastAdapter as unknown as Internals & { raw: Map<string, unknown[]> }
      internals.api = api
      internals.raw.set('lan', [raw('k300', 300), raw('k4000', 4_000)])
      internals.syncCursors[0] = { oldestId: 'd10', oldestTs: 10, gaps: [{ below: 'g600', ts: 600 }] }
      const asked: Array<string | undefined> = []
      Object.assign(listener, { requestOldMessages: (type: number, below?: string) => type === 0 && asked.push(below) })
      internals.startSync(api)
      listener.emit('old_messages', page(['k4000', 4_000]), 0)
      await vi.advanceTimersByTimeAsync(600)
      listener.emit('old_messages', page(['k300', 300]), 0)
      await vi.advanceTimersByTimeAsync(600)
      expect(asked).toEqual([undefined, 'g600', 'd10'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a page request left over from a walk that was started again', async () => {
    vi.useFakeTimers()
    try {
      const { listener, api } = setup()
      const internals = lastAdapter as unknown as Internals
      internals.api = api
      const asked: Array<string | undefined> = []
      Object.assign(listener, { requestOldMessages: (type: number, below?: string) => type === 0 && asked.push(below) })
      internals.startSync(api)
      listener.emit('old_messages', page(['n9', 9_000]), 0)
      // the socket came back (a new key) before the next page was asked for
      internals.startSync(api)
      await vi.advanceTimersByTimeAsync(600)
      expect(asked).toEqual([undefined, undefined])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Asking groups for their latest messages', () => {
  it('happens at most every 10 minutes, and not again after a round that found nothing', async () => {
    vi.useFakeTimers()
    try {
      const { listener, api: wired } = setup()
      Object.assign(listener, { start: vi.fn() })
      const internals = lastAdapter as unknown as { api: unknown; groups: Map<string, unknown>; backfillGroups(api: unknown): Promise<void> }
      internals.groups.set('g1', { groupId: 'g1', name: 'Nhóm', currentMems: [] })
      let history = [{ data: raw('g-1', 50_000) }]
      const getGroupChatHistory = vi.fn(async () => ({ groupMsgs: history }))
      const api = Object.assign(wired, { getGroupChatHistory })
      internals.api = api
      const round = async (): Promise<void> => {
        const done = internals.backfillGroups(api)
        await vi.advanceTimersByTimeAsync(1_000)
        await done
      }
      await round()
      expect(getGroupChatHistory).toHaveBeenCalledTimes(1)
      await round()
      expect(getGroupChatHistory).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      history = []
      await round()
      expect(getGroupChatHistory).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      await round()
      expect(getGroupChatHistory).toHaveBeenCalledTimes(2)
      // a dropped socket (a night asleep) is what the round is for: it asks again once 10 minutes have passed
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      listener.emit('closed', 1006, '')
      await round()
      expect(getGroupChatHistory).toHaveBeenCalledTimes(3)
      // nothing new again: quiet for an hour at most
      await vi.advanceTimersByTimeAsync(11 * 60_000)
      await round()
      expect(getGroupChatHistory).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      await round()
      expect(getGroupChatHistory).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })
})
