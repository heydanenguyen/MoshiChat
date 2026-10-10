import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { TMessage } from 'zca-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeEvent } from '../src/shared/types'
import { OUTBOX_MAX, messagesSince, outboxAppend, relayOffline, type AckFile, type OutboxItem, type RelayMeta, type RelayState } from '../src/shared/zalo-relay'
import type { AdapterContext } from '../src/main/adapters/types'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  session: { fromPartition: () => ({}) },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from('k:' + s), decryptString: (b: Buffer) => b.toString().slice(2) }
}))

const { encrypt } = await import('../src/main/zalo-share')
const { ZaloRelayAdapter, setRelayEnv } = await import('../src/main/adapters/zalo-relay-adapter')
const { listRelayOwners, readRelayFile } = await import('../src/main/adapters/zalo-relay-files')
const { AccountManager } = await import('../src/main/adapters/manager')

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 10, 12)
const OWNER = 'me1'
const key = randomBytes(32)

let folder = ''
let clock = NOW
let live: string[] = []
let events: BridgeEvent[] = []

const raw = (msgId: string, ts: number, content: unknown = 'hi', uidFrom = 'u1'): TMessage =>
  ({ msgId, cliMsgId: msgId, ts: String(ts), uidFrom, idTo: 'me1', msgType: 'webchat', content, dName: uidFrom === 'u1' ? 'An' : 'Me' }) as unknown as TMessage

const stateOf = (messages: TMessage[], over: Partial<RelayState> = {}): RelayState => ({
  version: 1,
  relayDeviceId: 'office',
  relayDeviceName: 'Office PC',
  writtenAt: clock,
  me: { id: OWNER, name: 'Me' },
  threads: [{ id: 't1', type: 0, name: 'An', unread: 1, lastAt: clock }],
  messages: { t1: messages },
  stickers: [],
  ...over
})

const dirOf = (): string => join(folder, 'zalo-relay', OWNER)

/** What the relay writes: state.zrs, and the sidecar (its heartbeat) beside it. */
function writeState(state: RelayState, meta: Partial<RelayMeta> = {}): void {
  mkdirSync(join(dirOf(), 'media'), { recursive: true })
  writeFileSync(join(dirOf(), 'state.zrs'), encrypt(key, gzipSync(JSON.stringify(state))))
  const m: RelayMeta = { relayDeviceId: state.relayDeviceId, relayDeviceName: state.relayDeviceName, writtenAt: state.writtenAt, stateAt: state.writtenAt, ...meta }
  writeFileSync(join(dirOf(), 'state.meta.json'), JSON.stringify(m))
}

function writeAcks(acks: AckFile): void {
  mkdirSync(join(dirOf(), 'acks'), { recursive: true })
  writeFileSync(join(dirOf(), 'acks', 'office.json'), encrypt(key, Buffer.from(JSON.stringify(acks))))
}

const ctx = (): AdapterContext => ({
  emit: (e) => void events.push(e),
  requestAuth: async () => '',
  presentQr: () => '',
  noteAuth: () => undefined,
  dismissAuth: () => undefined,
  saveSecret: async () => undefined,
  dataDir: () => join(userData, 'adapters'),
  log: () => undefined
})

const env = {
  folder: () => folder,
  device: () => ({ id: 'reader1', name: 'Laptop' }),
  key: async () => key,
  liveOwners: () => live
}

const make = (): InstanceType<typeof ZaloRelayAdapter> => new ZaloRelayAdapter(`zalo:relay-${OWNER}`, OWNER, ctx(), env, { now: () => clock, pollMs: 1e9 })
const ofType = <T extends BridgeEvent['type']>(type: T): Array<Extract<BridgeEvent, { type: T }>> => events.filter((e): e is Extract<BridgeEvent, { type: T }> => e.type === type)

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'moshi-reader-'))
  userData = mkdtempSync(join(tmpdir(), 'moshi-reader-ud-'))
  clock = NOW
  live = []
  events = []
  setRelayEnv(env)
})
afterEach(() => {
  setRelayEnv(undefined)
  rmSync(folder, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

describe('helpers', () => {
  it('relayOffline: more than 5 minutes since the heartbeat', () => {
    expect(relayOffline(NOW - 5 * MIN, NOW)).toBe(false)
    expect(relayOffline(NOW - 5 * MIN - 1, NOW)).toBe(true)
    expect(relayOffline(Number.NaN, NOW)).toBe(true)
  })

  it('messagesSince: the messages whose ids are not known yet', () => {
    const out = messagesSince({ a: [raw('1', 1), raw('2', 2)], b: [raw('3', 3)] }, new Set(['1', '3']))
    expect(out.map((x) => [x.threadId, x.message.msgId])).toEqual([['a', '2']])
  })

  it('outboxAppend: drops answered items, caps at 200, a newer seen replaces an older one', () => {
    const item = (uuid: string, extra: Partial<OutboxItem> = {}): OutboxItem => ({ uuid, threadId: 't1', type: 'message', text: uuid, at: 1, ...extra })
    expect(outboxAppend([item('a'), item('b')], item('c'), { a: { at: 2 } }).map((x) => x.uuid)).toEqual(['b', 'c'])
    const many = Array.from({ length: OUTBOX_MAX }, (_, i) => item(`m${i}`))
    const capped = outboxAppend(many, item('new'))
    expect(capped).toHaveLength(OUTBOX_MAX)
    expect(capped[0].uuid).toBe('m1')
    expect(capped.at(-1)?.uuid).toBe('new')
    const seen = outboxAppend([item('s1', { type: 'seen' }), item('s2', { type: 'seen', threadId: 't2' })], item('s3', { type: 'seen' }))
    expect(seen.map((x) => x.uuid)).toEqual(['s2', 's3'])
  })
})

describe('ZaloRelayAdapter', () => {
  it('first load: connected, the chats and messages are there, nothing is announced as new', async () => {
    writeState(stateOf([raw('1', NOW - 5000), raw('2', NOW - 4000)]))
    const adapter = make()
    await adapter.connect()
    expect(adapter.account.status).toBe('connected')
    expect(adapter.account.displayName).toBe('Me · relay')
    expect(adapter.account.features).toMatchObject({ react: false, unsend: false, call: 'none', attachments: true, reply: true })
    expect(ofType('message:new')).toEqual([])
    const [conv] = await adapter.listConversations()
    expect(conv).toMatchObject({ id: `zalo:relay-${OWNER}/t1`, title: 'An', unreadCount: 1, isGroup: false })
    const messages = await adapter.fetchMessages(conv.id, { limit: 10 })
    expect(messages.map((m) => m.id)).toEqual(['1', '2'])
    expect(await adapter.fetchMessages(conv.id, { limit: 1, beforeId: '2' })).toHaveLength(1)
    await adapter.disconnect()
  })

  it('a later state with one new message announces exactly that one', async () => {
    writeState(stateOf([raw('1', NOW - 5000)]))
    const adapter = make()
    await adapter.connect()
    clock += MIN
    writeState(stateOf([raw('1', NOW - 5000), raw('2', clock - 1000, 'new one')]))
    await adapter.pollNow()
    expect(ofType('message:new').map((e) => [e.message.id, e.message.text, e.message.isOutgoing])).toEqual([['2', 'new one', false]])
    expect(ofType('conversations:reset')).toHaveLength(1)
    // the same state again: nothing more
    clock += MIN
    writeState(stateOf([raw('1', NOW - 5000), raw('2', clock - MIN - 1000, 'new one')]))
    await adapter.pollNow()
    expect(ofType('message:new')).toHaveLength(1)
    await adapter.disconnect()
  })

  it('no state: needs_auth with relay-missing, and it recovers when the state appears', async () => {
    const adapter = make()
    await adapter.connect()
    expect(adapter.account).toMatchObject({ status: 'needs_auth', error: 'relay-missing' })
    writeState(stateOf([raw('1', NOW - 1000)]))
    await adapter.pollNow()
    expect(adapter.account.status).toBe('connected')
    expect(adapter.account.error).toBeUndefined()
    expect(ofType('message:new')).toEqual([])
    await adapter.disconnect()
  })

  it('a state that cannot be decrypted (another passphrase) is relay-missing', async () => {
    mkdirSync(dirOf(), { recursive: true })
    writeFileSync(join(dirOf(), 'state.zrs'), encrypt(randomBytes(32), gzipSync('{}')))
    const adapter = make()
    await adapter.connect()
    expect(adapter.account).toMatchObject({ status: 'needs_auth', error: 'relay-missing' })
    await adapter.disconnect()
  })

  it('waits for the state when the sidecar arrives first (state older than meta.stateAt)', async () => {
    writeState(stateOf([raw('1', NOW - 5000)]))
    const adapter = make()
    await adapter.connect()
    clock += MIN
    const next = stateOf([raw('1', NOW - 5000), raw('2', clock - 100)])
    // sidecar of the new state, but the old state.zrs is still what the drive has delivered
    writeState(stateOf([raw('1', NOW - 5000)], { writtenAt: NOW }), { writtenAt: clock, stateAt: clock })
    await adapter.pollNow()
    expect(ofType('message:new')).toEqual([])
    writeState(next)
    await adapter.pollNow()
    expect(ofType('message:new').map((e) => e.message.id)).toEqual(['2'])
    await adapter.disconnect()
  })

  it('relay offline: heartbeat older than 5 minutes shows relay-offline:<iso>, and clears when it beats again', async () => {
    writeState(stateOf([raw('1', NOW - 5000)]))
    const adapter = make()
    await adapter.connect()
    expect(adapter.account.error).toBeUndefined()
    clock += 6 * MIN
    await adapter.pollNow()
    expect(adapter.account.status).toBe('connected')
    expect(adapter.account.error).toBe(`relay-offline:${new Date(NOW).toISOString()}`)
    expect(ofType('account:updated').at(-1)?.account.error).toBe(`relay-offline:${new Date(NOW).toISOString()}`)
    // heartbeat only: the sidecar moves, the state does not
    writeFileSync(join(dirOf(), 'state.meta.json'), JSON.stringify({ relayDeviceId: 'office', writtenAt: clock, stateAt: NOW }))
    await adapter.pollNow()
    expect(adapter.account.error).toBeUndefined()
    await adapter.disconnect()
  })

  it('a live Zalo of the same owner here wins: the relay account waits as needs_auth live-account', async () => {
    writeState(stateOf([raw('1', NOW - 5000)]))
    live = [OWNER]
    const adapter = make()
    await adapter.connect()
    expect(adapter.account).toMatchObject({ status: 'needs_auth', error: 'live-account' })
    expect(await adapter.listConversations()).toEqual([])
    live = []
    await adapter.pollNow()
    expect(adapter.account.status).toBe('connected')
    await adapter.disconnect()
  })

  describe('sending', () => {
    const conv = `zalo:relay-${OWNER}/t1`
    const readOutbox = async (): Promise<OutboxItem[]> => JSON.parse((await readRelayFile(key, join(dirOf(), 'outbox', 'reader1.json'))).toString('utf8'))

    it('queues an encrypted outbox item and returns a sending stand-in', async () => {
      writeState(stateOf([raw('1', NOW - 5000)]))
      const adapter = make()
      await adapter.connect()
      const sent = await adapter.sendMessage(conv, 'hello', { replyToId: '1' })
      expect(sent).toMatchObject({ status: 'sending', isOutgoing: true, text: 'hello', conversationId: conv })
      expect(sent.id).toMatch(/^relay:/)
      // on disk it is ciphertext
      expect(readFileSync(join(dirOf(), 'outbox', 'reader1.json')).subarray(0, 4).toString()).toBe('MZS1')
      const items = await readOutbox()
      expect(items).toEqual([{ uuid: sent.id.slice(6), threadId: 't1', type: 'message', text: 'hello', replyTo: '1', at: NOW }])
      // still in the chat while it waits
      expect((await adapter.fetchMessages(conv, { limit: 10 })).map((m) => m.id)).toEqual(['1', sent.id])
      await adapter.disconnect()
    })

    it('copies attachments encrypted into outbox/files and refuses files over 25 MB', async () => {
      writeState(stateOf([]))
      const adapter = make()
      await adapter.connect()
      const file = join(userData, 'pic.png')
      writeFileSync(file, Buffer.from('PNGDATA'))
      const sent = await adapter.sendMessage(conv, '', { attachments: [{ path: file, name: 'pic.png', mime: 'image/png', size: 7 }] })
      const [item] = await readOutbox()
      expect(item.attachments).toEqual([{ name: 'pic.png', mime: 'image/png', path: `${sent.id.slice(6)}-pic.png` }])
      const stored = join(dirOf(), 'outbox', 'files', item.attachments![0].path)
      expect(readFileSync(stored).subarray(0, 4).toString()).toBe('MZS1')
      expect((await readRelayFile(key, stored)).toString()).toBe('PNGDATA')
      // the size is the file's own, whatever the caller says
      const big = join(userData, 'big.bin')
      writeFileSync(big, Buffer.alloc(26 * 1024 * 1024))
      await expect(adapter.sendMessage(conv, '', { attachments: [{ path: big, name: 'big.bin', mime: 'application/octet-stream', size: 1 }] })).rejects.toThrow(/25 MB/)
      await adapter.disconnect()
    })

    it('markRead queues a seen item', async () => {
      writeState(stateOf([]))
      const adapter = make()
      await adapter.connect()
      await adapter.markRead(conv)
      expect(await readOutbox()).toMatchObject([{ threadId: 't1', type: 'seen' }])
      await adapter.disconnect()
    })

    it('an ack with a msgId swaps the stand-in for the real id; the state copy later is an update, not new', async () => {
      writeState(stateOf([raw('1', NOW - 5000)]))
      const adapter = make()
      await adapter.connect()
      const sent = await adapter.sendMessage(conv, 'hello')
      clock += 20_000
      writeAcks({ [sent.id.slice(6)]: { msgId: '900', at: clock } })
      await adapter.pollNow()
      const updated = ofType('message:updated')
      expect(updated).toHaveLength(1)
      expect(updated[0]).toMatchObject({ replacesId: sent.id, message: { id: '900', status: 'sent', text: 'hello', conversationId: conv } })
      expect((await adapter.fetchMessages(conv, { limit: 10 })).map((m) => m.id)).toEqual(['1'])
      // the relay's state now carries it
      clock += 20_000
      writeState(stateOf([raw('1', NOW - 5000), raw('900', NOW + 1000, 'hello', OWNER)]))
      await adapter.pollNow()
      expect(ofType('message:new')).toEqual([])
      expect(ofType('message:updated').at(-1)).toMatchObject({ message: { id: '900', isOutgoing: true, status: 'delivered' } })
      expect((await adapter.fetchMessages(conv, { limit: 10 })).map((m) => m.id)).toEqual(['1', '900'])
      await adapter.disconnect()
    })

    it('the state shows the sent message before its ack: the stand-in is swapped at once, the ack changes nothing', async () => {
      writeState(stateOf([raw('1', NOW - 5000)]))
      const adapter = make()
      await adapter.connect()
      const sent = await adapter.sendMessage(conv, 'hello')
      // someone else's identical text in the same chat is not it
      clock += 20_000
      writeState(stateOf([raw('1', NOW - 5000), raw('50', NOW + 100, 'hello', 'u1')]))
      await adapter.pollNow()
      expect(ofType('message:new').map((e) => e.message.id)).toEqual(['50'])
      expect(ofType('message:updated')).toEqual([])
      clock += 20_000
      writeState(stateOf([raw('1', NOW - 5000), raw('50', NOW + 100, 'hello', 'u1'), raw('777', NOW + 500, 'hello', OWNER)]))
      await adapter.pollNow()
      expect(ofType('message:new')).toHaveLength(1)
      expect(ofType('message:updated')).toHaveLength(1)
      expect(ofType('message:updated')[0]).toMatchObject({ replacesId: sent.id, message: { id: '777', isOutgoing: true, text: 'hello' } })
      clock += 20_000
      writeAcks({ [sent.id.slice(6)]: { msgId: '777', at: clock } })
      await adapter.pollNow()
      expect(ofType('message:updated')).toHaveLength(1)
      expect((await adapter.fetchMessages(conv, { limit: 10 })).map((m) => m.id)).toEqual(['1', '50', '777'])
      await adapter.disconnect()
    })

    it('an ack with an error marks it failed', async () => {
      writeState(stateOf([]))
      const adapter = make()
      await adapter.connect()
      const sent = await adapter.sendMessage(conv, 'hello')
      writeAcks({ [sent.id.slice(6)]: { error: 'expired', at: clock } })
      await adapter.pollNow()
      expect(ofType('message:updated').at(-1)).toMatchObject({ message: { id: sent.id, status: 'failed' } })
      expect((await adapter.fetchMessages(conv, { limit: 10 })).map((m) => [m.id, m.status])).toEqual([[sent.id, 'failed']])
      await adapter.disconnect()
    })

    it('no ack within 10 minutes: failed', async () => {
      writeState(stateOf([]))
      const adapter = make()
      await adapter.connect()
      const sent = await adapter.sendMessage(conv, 'hello')
      clock += 9 * MIN
      writeState(stateOf([], { writtenAt: clock }))
      await adapter.pollNow()
      expect(ofType('message:updated')).toEqual([])
      clock += 2 * MIN
      writeState(stateOf([], { writtenAt: clock }))
      await adapter.pollNow()
      expect(ofType('message:updated').at(-1)).toMatchObject({ message: { id: sent.id, status: 'failed' } })
      await adapter.disconnect()
    })
  })

  it('serves a relayed picture from this computer\'s own cache, decrypted', async () => {
    const photo = raw('5', NOW - 1000, { href: 'https://f1.zdn.vn/x.jpg', thumb: 'https://f1.zdn.vn/t.jpg' })
    ;(photo as { msgType: string }).msgType = 'chat.photo'
    writeState(stateOf([photo]))
    mkdirSync(join(dirOf(), 'media'), { recursive: true })
    writeFileSync(join(dirOf(), 'media', '5.jpg'), encrypt(key, Buffer.from('JPEGBYTES')))
    const adapter = make()
    await adapter.connect()
    const [message] = await adapter.fetchMessages(`zalo:relay-${OWNER}/t1`, { limit: 5 })
    expect(message.attachments[0].kind).toBe('image')
    expect(message.attachments[0].url).toMatch(/^file:\/\//)
    const data = await adapter.downloadAttachment(`zalo:relay-${OWNER}/t1`, '5')
    expect(data).toBe(`data:image/jpeg;base64,${Buffer.from('JPEGBYTES').toString('base64')}`)
    await adapter.disconnect()
  })
})

describe('plain files are refused', () => {
  it('readRelayFile throws on anything without the encrypted envelope', async () => {
    const path = join(folder, 'plain.json')
    writeFileSync(path, '[{"uuid":"x"}]')
    await expect(readRelayFile(key, path)).rejects.toThrow()
    writeFileSync(path, encrypt(key, Buffer.from('ok')))
    expect((await readRelayFile(key, path)).toString()).toBe('ok')
  })

  it('a plain state.zrs is not a state; a plain ack file answers nothing', async () => {
    mkdirSync(dirOf(), { recursive: true })
    writeFileSync(join(dirOf(), 'state.zrs'), gzipSync(JSON.stringify(stateOf([raw('1', NOW)]))))
    const adapter = make()
    await adapter.connect()
    expect(adapter.account).toMatchObject({ status: 'needs_auth', error: 'relay-missing' })
    writeState(stateOf([]))
    await adapter.pollNow()
    const sent = await adapter.sendMessage(`zalo:relay-${OWNER}/t1`, 'hello')
    mkdirSync(join(dirOf(), 'acks'), { recursive: true })
    writeFileSync(join(dirOf(), 'acks', 'forger.json'), JSON.stringify({ [sent.id.slice(6)]: { msgId: '1', at: clock } }))
    await adapter.pollNow()
    expect(ofType('message:updated')).toEqual([])
    await adapter.disconnect()
  })
})

describe('failures while connecting', () => {
  it('a poll that throws before any status is set leaves an error, not "connecting"', async () => {
    const adapter = new ZaloRelayAdapter(`zalo:relay-${OWNER}`, OWNER, ctx(), { ...env, key: async () => Promise.reject(new Error('keychain locked')) }, { now: () => clock, pollMs: 1e9 })
    await adapter.connect()
    expect(adapter.account).toMatchObject({ status: 'error', error: 'keychain locked' })
    await adapter.disconnect()
  })
})

describe('owners listing', () => {
  it('lists owners whose state this key can read, with the relay computer and last heartbeat', async () => {
    writeState(stateOf([raw('1', NOW - 5000)]), { writtenAt: NOW - 3 * MIN })
    mkdirSync(join(folder, 'zalo-relay', 'other'), { recursive: true })
    writeFileSync(join(folder, 'zalo-relay', 'other', 'state.zrs'), encrypt(randomBytes(32), gzipSync('{}')))
    mkdirSync(join(folder, 'zalo-relay', 'empty'), { recursive: true })
    expect(await listRelayOwners(folder, key)).toEqual([{ ownerId: OWNER, name: 'Me', relayDeviceName: 'Office PC', writtenAt: NOW - 3 * MIN }])
    expect(await listRelayOwners(join(folder, 'nothing'), key)).toEqual([])
  })
})

describe('AccountManager with relay accounts', () => {
  const stored: Array<{ id: string; platform: string; displayName: string; secret?: unknown }> = []
  const secrets = new Map<string, unknown>()
  const storage = (): never =>
    ({
      get accounts() {
        return stored
      },
      settings: { language: 'en' },
      upsertAccount: async (a: { id: string; platform: string; displayName: string }, secret?: unknown) => {
        const i = stored.findIndex((s) => s.id === a.id)
        const row = { id: a.id, platform: a.platform, displayName: a.displayName, secret: secret === undefined ? undefined : 'x' }
        if (i >= 0) Object.assign(stored[i], row)
        else stored.push(row)
        if (secret !== undefined) secrets.set(a.id, secret)
      },
      removeAccount: async () => undefined,
      readSecret: (id: string) => secrets.get(id)
    }) as never

  beforeEach(() => {
    stored.length = 0
    secrets.clear()
  })

  it('addRelayAccount stores {ownerId} as the secret and a relay account that restore() builds again', async () => {
    writeState(stateOf([raw('1', NOW - 5000)]))
    const manager = new AccountManager(storage(), (e) => void events.push(e), () => undefined)
    const account = await manager.addRelayAccount(OWNER)
    expect(account).toMatchObject({ id: `zalo:relay-${OWNER}`, platform: 'zalo', displayName: 'Me · relay', status: 'connected' })
    expect(secrets.get(account.id)).toEqual({ ownerId: OWNER })
    expect(manager.listConversations().map((c) => c.id)).toEqual([`zalo:relay-${OWNER}/t1`])
    expect(manager.zaloAdapters()).toEqual([])
    // adding it again is the same account
    expect((await manager.addRelayAccount(OWNER)).id).toBe(account.id)

    const again = new AccountManager(storage(), (e) => void events.push(e), () => undefined)
    await again.restore()
    expect(again.listAccounts().map((a) => a.id)).toEqual([`zalo:relay-${OWNER}`])
    await manager.remove(account.id)
    await again.remove(account.id)
  })

  it('addRelayAccount refuses an owner whose state cannot be read, and keeps nothing', async () => {
    const manager = new AccountManager(storage(), (e) => void events.push(e), () => undefined)
    await expect(manager.addRelayAccount('nobody')).rejects.toThrow(/cannot read this relay/)
    expect(manager.listAccounts()).toEqual([])
    expect(stored).toEqual([])
  })

  it('with a live Zalo of the same owner the relay account is added but waits (live-account)', async () => {
    writeState(stateOf([raw('1', NOW - 5000)]))
    live = [OWNER]
    const manager = new AccountManager(storage(), (e) => void events.push(e), () => undefined)
    const account = await manager.addRelayAccount(OWNER)
    expect(account).toMatchObject({ status: 'needs_auth', error: 'live-account' })
    await manager.remove(account.id)
  })
})
