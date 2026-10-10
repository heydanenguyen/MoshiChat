import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { TMessage } from 'zca-js'
import { describe, expect, it, vi } from 'vitest'
import {
  RELAY_TAKEOVER_MS,
  extFor,
  mediaUrlOf,
  mergeAcks,
  pendingOutbox,
  relayConflict,
  trimState,
  type AckFile,
  type OutboxItem,
  type RelaySnapshot,
  type RelayState
} from '../src/shared/zalo-relay'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('k:' + s),
    decryptString: (b: Buffer) => b.toString().slice(2)
  }
}))

const { ZaloShare, decrypt, encrypt } = await import('../src/main/zalo-share')
const { ZaloRelay } = await import('../src/main/zalo-relay')

const DAY = 24 * 3600_000
const NOW = Date.UTC(2026, 9, 10, 12)
const msg = (msgId: string, ts: number, content: unknown = 'hi', extra: Partial<TMessage> = {}): TMessage =>
  ({
    msgId,
    cliMsgId: msgId,
    ts: String(ts),
    uidFrom: 'u1',
    idTo: 'me',
    msgType: 'webchat',
    content,
    ...extra
  }) as unknown as TMessage

const stateOf = (messages: Record<string, TMessage[]>): RelayState => ({
  version: 1,
  relayDeviceId: 'office',
  writtenAt: NOW,
  me: { id: 'me', name: 'Me' },
  threads: [{ id: 't1', type: 0, name: 'An', unread: 0, lastAt: NOW }],
  messages,
  stickers: []
})

describe('trimState', () => {
  it('drops messages older than the day limit and keeps the rest', () => {
    const state = stateOf({
      t1: [msg('old', NOW - 70 * DAY), msg('new', NOW - 2 * DAY)],
      t2: [msg('older', NOW - 61 * DAY)]
    })
    const trimmed = trimState(state, 50e6, 60, NOW)
    expect(trimmed.messages).toEqual({ t1: [msg('new', NOW - 2 * DAY)] })
    expect(trimmed.threads).toEqual(state.threads)
  })

  it('drops the oldest whole days first when over the byte limit', () => {
    const body = 'x'.repeat(1000)
    const state = stateOf({
      t1: [0, 1, 2, 3, 4].map((d) => msg(`m${d}`, NOW - (5 - d) * DAY, body))
    })
    const full = Buffer.byteLength(JSON.stringify(state))
    const trimmed = trimState(state, full - 2500, 60, NOW)
    expect(Buffer.byteLength(JSON.stringify(trimmed))).toBeLessThanOrEqual(full - 2500)
    // what is left is the newest run, never a gap
    const ids = trimmed.messages.t1.map((m) => m.msgId)
    expect(ids).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'].slice(5 - ids.length))
    expect(ids.length).toBeLessThan(5)
  })

  it('keeps all messages of a day together', () => {
    const body = 'y'.repeat(500)
    const state = stateOf({
      t1: [msg('a1', NOW - 3 * DAY, body), msg('a2', NOW - 3 * DAY + 1000, body), msg('b', NOW - DAY, body)]
    })
    const size = Buffer.byteLength(JSON.stringify(trimState(stateOf({ t1: [msg('b', NOW - DAY, body)] }), 1e9, 60, NOW)))
    const trimmed = trimState(state, size + 10, 60, NOW)
    expect(trimmed.messages.t1.map((m) => m.msgId)).toEqual(['b'])
  })

  it('can end with no messages at all, and a small state is untouched', () => {
    const state = stateOf({ t1: [msg('a', NOW - DAY, 'z'.repeat(2000))] })
    expect(trimState(state, 100, 60, NOW).messages).toEqual({})
    expect(trimState(state, 1e6, 60, NOW)).toEqual(state)
  })
})

describe('outbox and acks', () => {
  const item = (uuid: string, at: number, type: OutboxItem['type'] = 'message'): OutboxItem => ({ uuid, threadId: 't1', type, text: uuid, at })

  it('lists only unacked items, once each, oldest first', () => {
    const items = [item('c', 30), item('a', 10), item('b', 20), item('a', 10), item('d', 20)]
    const acks: AckFile = { b: { msgId: '9', at: 40 } }
    expect(pendingOutbox(items, acks).map((i) => i.uuid)).toEqual(['a', 'd', 'c'])
    expect(
      pendingOutbox(items, {
        ...acks,
        a: { error: 'x', at: 41 },
        c: { at: 41 },
        d: { at: 41 }
      })
    ).toEqual([])
  })

  it('merges ack files without losing or duplicating answers, whichever order', () => {
    const a: AckFile = {
      x: { error: 'busy', at: 1 },
      y: { msgId: '1', at: 5 }
    }
    const b: AckFile = { x: { msgId: '7', at: 2 }, z: { at: 3 } }
    const merged = mergeAcks(a, b)
    expect(merged).toEqual({
      x: { msgId: '7', at: 2 },
      y: { msgId: '1', at: 5 },
      z: { at: 3 }
    })
    expect(mergeAcks(b, a)).toEqual(merged)
    expect(mergeAcks(merged, merged)).toEqual(merged)
    expect(mergeAcks(merged, a)).toEqual(merged)
  })
})

describe('single relay rule', () => {
  it('refuses only a different relay that wrote within 10 minutes', () => {
    const wrote = (ago: number, id = 'laptop'): Parameters<typeof relayConflict>[0] => ({
      relayDeviceId: id,
      relayDeviceName: 'Laptop',
      writtenAt: NOW - ago
    })
    expect(relayConflict(undefined, 'office', NOW)).toBeUndefined()
    expect(relayConflict(wrote(60_000), 'office', NOW)).toBe('Laptop')
    expect(relayConflict(wrote(RELAY_TAKEOVER_MS - 1), 'office', NOW)).toBe('Laptop')
    expect(relayConflict(wrote(RELAY_TAKEOVER_MS), 'office', NOW)).toBeUndefined()
    expect(relayConflict(wrote(1000, 'office'), 'office', NOW)).toBeUndefined()
  })
})

describe('media helpers', () => {
  it('finds the file of a picture, a sticker and a voice note, and nothing for text', () => {
    const stickers = new Map([[12, { url: 'https://zalo/stk.webp' }]])
    expect(mediaUrlOf(msg('p', NOW, { href: 'https://f1.zdn.vn/a.jpg' }, { msgType: 'chat.photo' }), stickers)).toBe('https://f1.zdn.vn/a.jpg')
    expect(mediaUrlOf(msg('v', NOW, { href: 'https://f1.zdn.vn/v.m4a' }, { msgType: 'chat.voice' }), stickers)).toBe('https://f1.zdn.vn/v.m4a')
    expect(mediaUrlOf(msg('s', NOW, { id: 12 }, { msgType: 'chat.sticker' }), stickers)).toBe('https://zalo/stk.webp')
    expect(mediaUrlOf(msg('s2', NOW, { id: 99 }, { msgType: 'chat.sticker' }), stickers)).toBeUndefined()
    expect(mediaUrlOf(msg('t', NOW, 'hello'), stickers)).toBeUndefined()
  })

  it('picks an extension from the type, then the URL', () => {
    expect(extFor('image/jpeg', 'https://x/y')).toBe('jpg')
    expect(extFor('application/octet-stream', 'https://x/a/photo.PNG?v=1')).toBe('png')
    expect(extFor('', 'https://x/blob')).toBe('bin')
  })
})

describe('relay writer in a sync folder', () => {
  /** A Zalo account that remembers what the relay asked of it. */
  function fakeZalo(): {
    account: { id: string; status: string }
    shareOwner: string
    shareVersion: number
    sent: Array<{
      id: string
      text: string
      options?: {
        replyToId?: string
        attachments?: Array<{ path: string; name: string }>
      }
    }>
    seen: string[]
    relaySnapshot(days: number): Promise<RelaySnapshot>
    sendMessage(id: string, text: string, options?: never): Promise<{ id: string }>
    markRead(id: string): Promise<void>
  } {
    const zalo = {
      account: { id: 'zalo:me', status: 'connected' },
      shareOwner: 'me',
      shareVersion: 1,
      sent: [] as never[],
      seen: [] as string[],
      relaySnapshot: async (): Promise<RelaySnapshot> => ({
        me: { id: 'me', name: 'Me' },
        threads: [{ id: 't1', type: 0, name: 'An', unread: 2, lastAt: Date.now() }],
        messages: {
          t1: [
            msg('m1', Date.now() - 1000, 'xin chào'),
            msg('m2', Date.now() - 500, { href: 'https://f1.zdn.vn/pic.jpg' }, { msgType: 'chat.photo' }),
            msg('m3', Date.now() - 400, { href: 'https://f1.zdn.vn/huge.jpg' }, { msgType: 'chat.photo' })
          ]
        },
        stickers: []
      }),
      sendMessage: async (id: string, text: string, options?: never): Promise<{ id: string }> => {
        ;(zalo.sent as unknown[]).push({ id, text, options })
        return { id: `z${zalo.sent.length}` }
      },
      markRead: async (id: string): Promise<void> => void zalo.seen.push(id)
    }
    return zalo
  }

  async function setup(): Promise<{
    folder: string
    relay: InstanceType<typeof ZaloRelay>
    zalo: ReturnType<typeof fakeZalo>
    key: Buffer
    ownerDir: string
    downloads: string[]
    advance(ms: number): void
  }> {
    const folder = mkdtempSync(join(tmpdir(), 'moshi-relay-sync-'))
    userData = mkdtempSync(join(tmpdir(), 'moshi-relay-user-'))
    // the key comes from Zalo sharing, as in the app
    await new ZaloShare(
      () => folder,
      () => ({ id: 'office', name: 'Office' }),
      () => [],
      () => undefined
    ).enable('một cụm mật khẩu dài')
    const key = Buffer.from(readFileSync(join(userData, 'zalo-share.key')).toString().slice(2), 'base64')
    const zalo = fakeZalo()
    const downloads: string[] = []
    let skew = 0
    const relay = new ZaloRelay(
      () => folder,
      () => ({ id: 'office', name: 'Office' }),
      () => [zalo as never],
      () => undefined,
      {
        download: async (url) => {
          downloads.push(url)
          return url.includes('huge') ? undefined : { data: Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), type: 'image/jpeg' }
        },
        now: () => Date.now() + skew,
        sendTimeoutMs: 400
      }
    )
    return {
      folder,
      relay,
      zalo,
      key,
      ownerDir: join(folder, 'zalo-relay', 'me'),
      downloads,
      advance: (ms) => void (skew += ms)
    }
  }

  const readState = (ownerDir: string, key: Buffer): RelayState =>
    JSON.parse(gunzipSync(decrypt(key, readFileSync(join(ownerDir, 'state.zrs')))).toString('utf8')) as RelayState
  const writeOutbox = (ownerDir: string, key: Buffer, reader: string, items: OutboxItem[]): void => {
    mkdirSync(join(ownerDir, 'outbox'), { recursive: true })
    writeFileSync(join(ownerDir, 'outbox', `${reader}.json`), encrypt(key, Buffer.from(JSON.stringify(items))))
  }
  const readAcks = (ownerDir: string, key: Buffer): AckFile =>
    JSON.parse(decrypt(key, readFileSync(join(ownerDir, 'acks', 'office.json'))).toString('utf8')) as AckFile

  it('writes an encrypted state at once, with the picture beside it', async () => {
    const { relay, zalo, key, ownerDir, downloads } = await setup()
    const status = await relay.enable()
    expect(status).toMatchObject({ enabled: true, owner: 'me', errors: [] })
    expect(status.lastWriteAt).toBeTypeOf('number')
    const raw = readFileSync(join(ownerDir, 'state.zrs'))
    expect(raw.includes(Buffer.from('xin chào'))).toBe(false)
    const state = readState(ownerDir, key)
    expect(state).toMatchObject({
      version: 1,
      relayDeviceId: 'office',
      relayDeviceName: 'Office',
      me: { id: 'me', name: 'Me' }
    })
    expect(state.messages.t1.map((m) => m.msgId)).toEqual(['m1', 'm2', 'm3'])
    expect(state.threads[0]).toMatchObject({ id: 't1', type: 0, unread: 2 })
    // the small picture is copied (encrypted); the one that failed is skipped
    expect(downloads.sort()).toEqual(['https://f1.zdn.vn/huge.jpg', 'https://f1.zdn.vn/pic.jpg'])
    expect(readdirSync(join(ownerDir, 'media'))).toEqual(['m2.jpg'])
    expect([...decrypt(key, readFileSync(join(ownerDir, 'media', 'm2.jpg')))]).toEqual([0xff, 0xd8, 0xff, 1, 2, 3])
    expect(zalo.sent).toEqual([])
  })

  it('sends a queued message once, acks it, and never sends it again', async () => {
    const { relay, zalo, key, ownerDir } = await setup()
    await relay.enable()
    const item: OutboxItem = {
      uuid: 'u-1',
      threadId: 't1',
      type: 'message',
      text: 'chào An',
      at: Date.now()
    }
    writeOutbox(ownerDir, key, 'home', [item])
    await relay.pollNow()
    expect(zalo.sent).toHaveLength(1)
    expect(zalo.sent[0]).toMatchObject({ id: 'zalo:me/t1', text: 'chào An' })
    expect(readAcks(ownerDir, key)['u-1']).toMatchObject({ msgId: 'z1' })
    // the same file again, and a new relay run reading the ack from disk: still one send
    await relay.pollNow()
    writeOutbox(ownerDir, key, 'home', [item, { uuid: 'u-2', threadId: 't1', type: 'seen', at: Date.now() }])
    await relay.pollNow()
    expect(zalo.sent).toHaveLength(1)
    expect(zalo.seen).toEqual(['zalo:me/t1'])
    expect(Object.keys(readAcks(ownerDir, key)).sort()).toEqual(['u-1', 'u-2'])
    expect(relay.status()).toMatchObject({ processed: 2 })
    expect(relay.status().lastOutboxAt).toBeTypeOf('number')
  })

  it('acks a failure with its error, and an old item as expired without sending', async () => {
    const { relay, zalo, key, ownerDir } = await setup()
    await relay.enable()
    zalo.sendMessage = async () => {
      throw new Error('Zalo said no')
    }
    writeOutbox(ownerDir, key, 'home', [
      {
        uuid: 'bad',
        threadId: 't1',
        type: 'message',
        text: 'x',
        at: Date.now()
      },
      {
        uuid: 'late',
        threadId: 't1',
        type: 'message',
        text: 'y',
        at: Date.now() - 3 * 3600_000
      }
    ])
    await relay.pollNow()
    const acks = readAcks(ownerDir, key)
    expect(acks.bad).toMatchObject({ error: 'Zalo said no' })
    expect(acks.late).toMatchObject({ error: 'expired' })
    expect(relay.status().errors.length).toBeGreaterThan(0)
  })

  it('sends a reader’s attachment from outbox/files, then clears it', async () => {
    const { relay, zalo, key, ownerDir } = await setup()
    await relay.enable()
    mkdirSync(join(ownerDir, 'outbox', 'files'), { recursive: true })
    writeFileSync(join(ownerDir, 'outbox', 'files', 'a.png'), encrypt(key, Buffer.from('PNGDATA')))
    writeOutbox(ownerDir, key, 'home', [
      {
        uuid: 'att',
        threadId: 't1',
        type: 'message',
        attachments: [{ name: 'a.png', mime: 'image/png', path: 'a.png' }],
        at: Date.now()
      },
      {
        uuid: 'esc',
        threadId: 't1',
        type: 'message',
        attachments: [{ name: 'x', mime: 'text/plain', path: '../../state.zrs' }],
        at: Date.now()
      }
    ])
    const seen: string[] = []
    const send = zalo.sendMessage
    zalo.sendMessage = async (id, text, options) => {
      const path = (options as { attachments: Array<{ path: string }> }).attachments[0].path
      seen.push(readFileSync(path, 'utf8'))
      return send(id, text, options)
    }
    await relay.pollNow()
    expect(seen).toEqual(['PNGDATA'])
    expect(readAcks(ownerDir, key).esc.error).toMatch(/outside/)
    expect(existsSync(join(ownerDir, 'outbox', 'files', 'a.png'))).toBe(false)
  })

  it('never acts on plain (unencrypted) files in the folder: a forged outbox or attachment is ignored', async () => {
    const { relay, zalo, key, ownerDir } = await setup()
    await relay.enable()
    const item: OutboxItem = { uuid: 'forged', threadId: 't1', type: 'message', text: 'pay me', at: Date.now() }
    mkdirSync(join(ownerDir, 'outbox', 'files'), { recursive: true })
    writeFileSync(join(ownerDir, 'outbox', 'forger.json'), JSON.stringify([item]))
    await relay.pollNow()
    expect(zalo.sent).toEqual([])
    // an encrypted outbox with a plain attachment: the item fails, the plain bytes are never sent
    writeFileSync(join(ownerDir, 'outbox', 'files', 'p.txt'), 'PLAIN')
    writeOutbox(ownerDir, key, 'home', [{ uuid: 'pl', threadId: 't1', type: 'message', attachments: [{ name: 'p.txt', mime: 'text/plain', path: 'p.txt' }], at: Date.now() }])
    await relay.pollNow()
    expect(zalo.sent).toEqual([])
    expect(readAcks(ownerDir, key).pl.error).toBeTruthy()
    // a plain ack file counts for nothing and does not stall the queue
    mkdirSync(join(ownerDir, 'acks'), { recursive: true })
    writeFileSync(join(ownerDir, 'acks', 'forger.json'), JSON.stringify({ ok: { msgId: '1', at: Date.now() } }))
    writeOutbox(ownerDir, key, 'home', [queued('ok')])
    await relay.pollNow()
    expect(zalo.sent).toHaveLength(1)
  })

  it('refuses to relay while another computer relays the same Zalo', async () => {
    const { relay, key, ownerDir } = await setup()
    mkdirSync(ownerDir, { recursive: true })
    const other: RelayState = {
      ...stateOf({}),
      relayDeviceId: 'laptop',
      relayDeviceName: 'Laptop',
      writtenAt: Date.now() - 60_000
    }
    writeFileSync(join(ownerDir, 'state.zrs'), encrypt(key, gzipSync(JSON.stringify(other))))
    const status = await relay.enable()
    expect(status.enabled).toBe(false)
    expect(status.errors[0]).toMatch(/Laptop is already the relay/)
    expect(readState(ownerDir, key).relayDeviceId).toBe('laptop')
  })

  const writeMeta = (ownerDir: string, meta: object): void => {
    mkdirSync(ownerDir, { recursive: true })
    writeFileSync(join(ownerDir, 'state.meta.json'), JSON.stringify(meta))
  }
  const ackFile = (ownerDir: string, key: Buffer, name: string, acks: AckFile): void => {
    mkdirSync(join(ownerDir, 'acks'), { recursive: true })
    writeFileSync(join(ownerDir, 'acks', name), encrypt(key, Buffer.from(JSON.stringify(acks))))
  }
  const queued = (uuid: string): OutboxItem => ({ uuid, threadId: 't1', type: 'message', text: uuid, at: Date.now() })

  it('keeps a plain state.meta.json beside the state, and only beats it while nothing new arrives', async () => {
    const { relay, zalo, ownerDir, advance } = await setup()
    await relay.enable()
    const first = JSON.parse(readFileSync(join(ownerDir, 'state.meta.json'), 'utf8'))
    expect(first).toMatchObject({ relayDeviceId: 'office', relayDeviceName: 'Office' })
    expect(Object.keys(first).sort()).toEqual(['relayDeviceId', 'relayDeviceName', 'stateAt', 'writtenAt'])
    const stateBytes = readFileSync(join(ownerDir, 'state.zrs'))
    const snapshot = vi.spyOn(zalo, 'relaySnapshot')
    advance(2 * 60_000)
    await relay.writeNow()
    const beat = JSON.parse(readFileSync(join(ownerDir, 'state.meta.json'), 'utf8'))
    expect(snapshot).not.toHaveBeenCalled()
    expect(readFileSync(join(ownerDir, 'state.zrs')).equals(stateBytes)).toBe(true)
    expect(beat.writtenAt).toBeGreaterThan(first.writtenAt)
    expect(beat.stateAt).toBe(first.stateAt)
    // a new message rebuilds the state
    zalo.shareVersion++
    await relay.writeNow()
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(join(ownerDir, 'state.meta.json'), 'utf8')).stateAt).toBeGreaterThan(first.stateAt)
  })

  it('treats a sidecar from another relay as a conflict and an unreadable one as a conflict too', async () => {
    const { relay, ownerDir, key } = await setup()
    writeMeta(ownerDir, { relayDeviceId: 'laptop', relayDeviceName: 'Laptop', writtenAt: Date.now() - 60_000, stateAt: 0 })
    expect((await relay.enable()).errors[0]).toMatch(/Laptop is already the relay/)
    writeMeta(ownerDir, { relayDeviceId: 'laptop', relayDeviceName: 'Laptop', writtenAt: Date.now() - 11 * 60_000, stateAt: 0 })
    expect((await relay.enable()).enabled).toBe(true)
    await relay.disable()
    writeFileSync(join(ownerDir, 'state.meta.json'), '{"relayDevi')
    writeFileSync(join(ownerDir, 'state.zrs'), 'garbage')
    expect((await relay.enable()).enabled).toBe(false)
    expect(existsSync(join(ownerDir, 'state.zrs'))).toBe(true)
    expect(key.length).toBe(32)
  })

  it('fails safe on a sidecar that is unreadable or the wrong shape, and trusts the state only when there is no sidecar', async () => {
    const { relay, key, ownerDir } = await setup()
    mkdirSync(ownerDir, { recursive: true })
    const stateFrom = (id: string, ago: number): void =>
      writeFileSync(
        join(ownerDir, 'state.zrs'),
        encrypt(key, gzipSync(JSON.stringify({ ...stateOf({}), relayDeviceId: id, relayDeviceName: id, writtenAt: Date.now() - ago })))
      )
    // a stale state (a heartbeat-only relay can look like this) must not release a sidecar that cannot be read
    stateFrom('office', 25 * 60_000)
    writeFileSync(join(ownerDir, 'state.meta.json'), '{"relayDevi')
    expect((await relay.enable()).enabled).toBe(false)
    writeFileSync(join(ownerDir, 'state.meta.json'), '{}')
    expect((await relay.enable()).enabled).toBe(false)
    writeMeta(ownerDir, { relayDeviceId: 'laptop', writtenAt: 'now' })
    expect((await relay.enable()).enabled).toBe(false)
    // no sidecar: the state header decides
    rmSync(join(ownerDir, 'state.meta.json'))
    stateFrom('laptop', 60_000)
    expect((await relay.enable()).errors[0]).toMatch(/laptop is already the relay/)
    stateFrom('laptop', 20 * 60_000)
    expect((await relay.enable()).enabled).toBe(true)
  })

  it('keeps the heartbeat fresh after a long media pass, and rebuilds after having been blocked', async () => {
    const { relay, zalo, ownerDir } = await setup()
    await relay.enable()
    const snapshot = vi.spyOn(zalo, 'relaySnapshot')
    writeMeta(ownerDir, { relayDeviceId: 'laptop', relayDeviceName: 'Laptop', writtenAt: Date.now() - 1000, stateAt: 0 })
    await relay.writeNow()
    expect(snapshot).not.toHaveBeenCalled()
    writeMeta(ownerDir, { relayDeviceId: 'laptop', relayDeviceName: 'Laptop', writtenAt: Date.now() - 20 * 60_000, stateAt: 0 })
    await relay.writeNow()
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(join(ownerDir, 'state.meta.json'), 'utf8')).relayDeviceId).toBe('office')
  })

  it('does not send anything while another relay owns the folder, and says so', async () => {
    const { relay, zalo, key, ownerDir } = await setup()
    await relay.enable()
    writeMeta(ownerDir, { relayDeviceId: 'laptop', relayDeviceName: 'Laptop', writtenAt: Date.now() - 60_000, stateAt: 0 })
    writeOutbox(ownerDir, key, 'home', [queued('b-1')])
    await relay.pollNow()
    expect(zalo.sent).toHaveLength(0)
    expect(relay.status().errors.join()).toMatch(/Laptop is already the relay/)
    // the other relay goes quiet: this one carries on
    writeMeta(ownerDir, { relayDeviceId: 'laptop', relayDeviceName: 'Laptop', writtenAt: Date.now() - 20 * 60_000, stateAt: 0 })
    await relay.pollNow()
    expect(zalo.sent).toHaveLength(1)
    expect(relay.status().errors).toEqual([])
  })

  it('sends nothing when an ack file cannot be read, and nothing twice once it can', async () => {
    const { relay, zalo, key, ownerDir } = await setup()
    await relay.enable()
    ackFile(ownerDir, key, 'office.json', { 'c-1': { msgId: 'z0', at: Date.now() } })
    writeFileSync(join(ownerDir, 'acks', 'office.json'), 'MZS1 broken')
    writeOutbox(ownerDir, key, 'home', [queued('c-1'), queued('c-2')])
    await relay.pollNow()
    expect(zalo.sent).toHaveLength(0)
    expect(relay.status().errors.join()).toMatch(/unreadable/)
    ackFile(ownerDir, key, 'office.json', { 'c-1': { msgId: 'z0', at: Date.now() } })
    await relay.pollNow()
    expect(zalo.sent.map((x) => x.text)).toEqual(['c-2'])
    await relay.pollNow()
    expect(zalo.sent).toHaveLength(1)
  })

  it('knows what another relay already answered (every ack file counts)', async () => {
    const { relay, zalo, key, ownerDir } = await setup()
    await relay.enable()
    ackFile(ownerDir, key, 'old-relay.json', { 'd-1': { msgId: 'z9', at: Date.now() } })
    ackFile(ownerDir, key, 'third.json', { 'd-2': { error: 'x', at: Date.now() } })
    writeOutbox(ownerDir, key, 'home', [queued('d-1'), queued('d-2'), queued('d-3')])
    await relay.pollNow()
    expect(zalo.sent.map((x) => x.text)).toEqual(['d-3'])
    expect(Object.keys(readAcks(ownerDir, key)).sort()).toEqual(['d-3'])
  })

  it('leaves a signed-out account alone: no heartbeat, queue waits, status says so', async () => {
    const { relay, zalo, key, ownerDir, advance } = await setup()
    await relay.enable()
    const before = readFileSync(join(ownerDir, 'state.meta.json'), 'utf8')
    zalo.account.status = 'needs_auth'
    advance(3 * 60_000)
    writeOutbox(ownerDir, key, 'home', [queued('e-1')])
    await relay.writeNow()
    await relay.pollNow()
    expect(readFileSync(join(ownerDir, 'state.meta.json'), 'utf8')).toBe(before)
    expect(zalo.sent).toHaveLength(0)
    expect(relay.status().errors).toContain('Zalo signed out')
    zalo.account.status = 'connected'
    await relay.pollNow()
    expect(zalo.sent.map((x) => x.text)).toEqual(['e-1'])
    expect(relay.status().errors).not.toContain('Zalo signed out')
  })

  it('answers a send that hangs with a timeout and goes on to the next item', async () => {
    const { relay, zalo, key, ownerDir } = await setup()
    await relay.enable()
    zalo.sendMessage = (async (_id: string, text: string) => (text === 'f-1' ? new Promise(() => undefined) : { id: 'z-ok' })) as never
    writeOutbox(ownerDir, key, 'home', [queued('f-1'), { ...queued('f-2'), at: Date.now() + 1 }])
    await relay.pollNow()
    const acks = readAcks(ownerDir, key)
    expect(acks['f-1']).toMatchObject({ error: 'timeout' })
    expect(acks['f-2']).toMatchObject({ msgId: 'z-ok' })
  })

  it('does not expire a seen mark, and expires a message whose time is not a number', async () => {
    const { relay, zalo, key, ownerDir } = await setup()
    await relay.enable()
    writeOutbox(ownerDir, key, 'home', [
      { uuid: 'g-1', threadId: 't1', type: 'seen', at: Date.now() - 5 * 3600_000 },
      { ...queued('g-2'), at: 'soon' as never }
    ])
    await relay.pollNow()
    expect(zalo.seen).toEqual(['zalo:me/t1'])
    expect(zalo.sent).toHaveLength(0)
    expect(readAcks(ownerDir, key)['g-2']).toMatchObject({ error: 'expired' })
  })

  it('keeps copied pictures when the snapshot is short, and retries a failed download a few times only', async () => {
    const { relay, zalo, ownerDir, downloads } = await setup()
    await relay.enable()
    expect(readdirSync(join(ownerDir, 'media'))).toEqual(['m2.jpg'])
    const full = zalo.relaySnapshot
    zalo.relaySnapshot = async () => ({ ...(await full(0)), messages: {} })
    zalo.shareVersion++
    await relay.writeNow()
    expect(readdirSync(join(ownerDir, 'media'))).toEqual(['m2.jpg'])
    // m3 failed at enable (1 try); two more passes and it is given up on
    zalo.relaySnapshot = full
    for (let i = 0; i < 4; i++) {
      zalo.shareVersion++
      await relay.writeNow()
    }
    expect(downloads.filter((u) => u.includes('huge'))).toHaveLength(3)
    expect(downloads.filter((u) => u.includes('pic'))).toHaveLength(1)
  })
})
