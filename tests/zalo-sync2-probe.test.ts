import { EventEmitter } from 'events'
import { deflateSync } from 'zlib'
import { webcrypto } from 'crypto'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_FRAME_JSON,
  buildDisposeData,
  buildFrame,
  buildSyncPayload,
  classifyControl,
  decodeBody,
  errorCodeOf,
  parseFrame,
  parseJson,
  redactedJson,
  scrubbedRaw,
  runProbe,
  verdictOf,
  type ProbeListener,
  type WsPayload
} from '../src/main/adapters/zalo-sync2-probe'

afterEach(() => vi.useRealTimers())

const control = (act_type: string, act: string, data: unknown) => ({ content: { act_type, act, data } })
/** A cmd-601 frame the way the socket delivers it (encrypt 0: the body is plain JSON). */
const controlFrame = (...controls: unknown[]): Buffer => buildFrame(601, 0, { encrypt: 0, data: JSON.stringify({ error_code: 0, data: { controls } }) })
const replyFrame = (cmd: number, inner: unknown): Buffer => buildFrame(cmd, 0, { encrypt: 0, data: JSON.stringify(inner) })

function fakeListener(): { listener: ProbeListener; ws: EventEmitter & { readyState: number }; sent: WsPayload[]; requireIds: Array<boolean | undefined> } {
  const ws = Object.assign(new EventEmitter(), { readyState: 1 })
  const sent: WsPayload[] = []
  const requireIds: Array<boolean | undefined> = []
  const listener: ProbeListener = {
    ws: ws as unknown as ProbeListener['ws'],
    sendWs: (payload, requireId) => {
      sent.push(payload)
      requireIds.push(requireId)
    }
  }
  return { listener, ws, sent, requireIds }
}

describe('frames', () => {
  it('lays out 1 byte version, uint16 LE cmd, 1 byte subCmd, then the JSON', () => {
    const frame = buildFrame(590, 0, { a: 1 })
    expect([...frame.subarray(0, 4)]).toEqual([1, 590 & 0xff, 590 >> 8, 0])
    expect(frame.subarray(4).toString('utf8')).toBe('{"a":1}')
    expect(parseFrame(frame)).toMatchObject({ version: 1, cmd: 590, subCmd: 0 })
    expect(parseFrame(Buffer.from([1, 2]))).toBeUndefined()
  })

  it('is byte for byte what zca-js sendWs puts on the wire', async () => {
    // Not in zca-js's export map: loaded by path so the real framing code is the oracle.
    const file = pathToFileURL(resolve('node_modules/zca-js/dist/apis/listen.js')).href
    const { Listener } = (await import(/* @vite-ignore */ file)) as { Listener: { prototype: object } }
    const sentOnWire: Buffer[] = []
    const fake = Object.create(Listener.prototype) as { ws: unknown; sendWs: (p: WsPayload, r?: boolean) => void }
    fake.ws = { send: (d: DataView) => sentOnWire.push(Buffer.from(d.buffer)) }
    fake.sendWs({ version: 1, cmd: 590, subCmd: 0, data: { reqId: 'r', data: { x: 'é' } } }, false)
    expect(sentOnWire[0].equals(buildFrame(590, 0, { reqId: 'r', data: { x: 'é' } }))).toBe(true)
  })
})

describe('payload', () => {
  const fixed = (size: number): Buffer => Buffer.alloc(size, 7)

  it('has the shape the PC client sends (spike 1.2)', () => {
    const { syncId, json } = buildSyncPayload({ hostname: 'MY-PC', random: fixed, now: 1234 })
    const data = (json as { data: Record<string, unknown> }).data
    expect(json.reqId).toBe('req_1234')
    expect(syncId).toHaveLength(32)
    expect(data).toEqual({
      syncId,
      syncType: 1,
      ek: fixed(32).toString('base64'),
      ik: fixed(32).toString('base64'),
      toDevice: 0,
      tempKey: '',
      deviceName: 'MY-PC',
      req: { type: 'conversation', priority: 0, queries: [{ partition: 0, from: 0, to: 0, limit: 10 }], batchSize: 100 },
      ver: 1,
      ussidx: 0
    })
    expect(Buffer.from(data.ek as string, 'base64')).toHaveLength(32)
  })

  it('has a second variant with the spike values', () => {
    const data = (buildSyncPayload({ hostname: 'h', variant: 'spike', random: fixed }).json as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({ syncType: 0, req: { queries: [{ partition: '-1', from: 0, to: Number.MAX_SAFE_INTEGER, limit: 10 }], batchSize: 2000 } })
    expect(JSON.stringify(data)).toContain('"to":9007199254740991')
  })

  it('draws a new session every time', () => {
    const a = buildSyncPayload({ hostname: 'h' })
    const b = buildSyncPayload({ hostname: 'h' })
    expect(a.syncId).not.toBe(b.syncId)
    expect(buildDisposeData(a.syncId)).toEqual({ syncId: a.syncId, toDevice: 0, reason: 'probe' })
  })
})

describe('control classifier', () => {
  it('maps transfer_status values to verdicts', () => {
    const status = (n: number) => verdictOf([classifyControl(control('transfer_sync2', 'transfer_status', { status: n, fromDevice: 0 }).content)!])
    expect(status(3)).toBe('accepted-waiting-confirm')
    expect(status(4)).toBe('confirmed')
    expect(status(5)).toBe('confirmed')
    expect(status(6)).toBe('rejected')
    expect(status(7)).toBe('rejected')
    expect(status(8)).toBe('other-status')
  })

  it('reads data given as a JSON string, and ignores controls that are not sync', () => {
    expect(classifyControl({ act_type: 'transfer_msg', act: 'transfer_status', data: '{"status":3}' })).toEqual({ kind: 'status', status: 3 })
    expect(classifyControl({ act_type: 'group', act: 'join', data: {} })).toBeUndefined()
    expect(classifyControl('nope')).toBeUndefined()
    expect(classifyControl({ act_type: 'transfer_after_login', act: 'x', data: { temp_key: 'k' } })).toEqual({ kind: 'other' })
  })

  it('counts upload_batch and whether a msgUrl came', () => {
    expect(classifyControl({ act_type: 'transfer_sync2', act: 'upload_batch', data: { idx: 0, msgUrl: 'https://cdn/x' } })).toEqual({ kind: 'upload_batch', hasMsgUrl: true })
    expect(classifyControl({ act_type: 'transfer_sync2', act: 'upload_batch', data: { idx: 0 } })).toEqual({ kind: 'upload_batch', hasMsgUrl: false })
  })

  it('takes the furthest outcome', () => {
    expect(verdictOf([])).toBe('silent')
    expect(verdictOf([{ kind: 'ack' }])).toBe('ack-only')
    expect(verdictOf([{ kind: 'error', code: 211 }])).toBe('server-error')
    expect(verdictOf([{ kind: 'error', code: 211 }, { kind: 'status', status: 3 }])).toBe('accepted-waiting-confirm')
    expect(verdictOf([{ kind: 'status', status: 3 }, { kind: 'status', status: 6 }])).toBe('rejected')
    expect(verdictOf([{ kind: 'status', status: 4 }, { kind: 'upload_batch', hasMsgUrl: true }])).toBe('upload_batch')
  })

  it('finds error_code beside or inside the body', () => {
    expect(errorCodeOf({ error_code: 211 })).toBe(211)
    expect(errorCodeOf({ error_code: 0 }, { data: { error_code: 5 } })).toBe(0)
    expect(errorCodeOf(undefined, { data: { error_code: 5 } })).toBe(5)
    expect(errorCodeOf({ data: 'x' }, 'y')).toBeUndefined()
  })
})

describe('recording', () => {
  it('blanks secret-looking keys anywhere, and cuts long bodies', () => {
    const json = redactedJson({ msgUrl: 'https://cdn.example/secret?sig=abc', temp_key: 'k1', idx: 2, deep: { imei: 'IMEI-1', cookie: 'c', sessionKey: 'sk' } })
    for (const leaked of ['secret', 'k1', 'IMEI-1', '"c"', '"sk"']) expect(json).not.toContain(leaked)
    expect(json).toContain('"idx":2')
    expect(redactedJson({ big: 'x'.repeat(10_000) }).length).toBeLessThan(MAX_FRAME_JSON + 40)
    expect(redactedJson({ big: 'x'.repeat(5000) }, 100).length).toBeLessThan(140)
  })

  it('scrubs a body that could not be decoded', () => {
    const raw = scrubbedRaw('{"imei":"IMEI-2","data":"abc","x_token":"t"}')
    expect(raw).not.toContain('IMEI-2')
    expect(raw).not.toContain('"t"')
    expect(raw).toContain('"data":"abc"')
  })

  it('keeps ids beyond 2^53 exactly', () => {
    expect(parseJson('{"id":9007199254740993,"n":5,"f":1.5}')).toEqual({ id: '9007199254740993', n: 5, f: 1.5 })
  })

  it('reads plain, deflated and AES-GCM bodies like zca-js decodeEventData', async () => {
    const inner = { data: { controls: [] }, error_code: 0 }
    const text = JSON.stringify(inner)
    expect((await decodeBody(Buffer.from(JSON.stringify({ encrypt: 0, data: text })))).inner).toEqual(inner)
    expect((await decodeBody(Buffer.from(JSON.stringify({ encrypt: 1, data: deflateSync(text).toString('base64') })))).inner).toEqual(inner)

    const keyBytes = Buffer.alloc(16, 9)
    const iv = Buffer.alloc(16, 1)
    const aad = Buffer.alloc(16, 2)
    const algorithm = { name: 'AES-GCM', iv, tagLength: 128, additionalData: aad }
    const key = await webcrypto.subtle.importKey('raw', keyBytes, algorithm, false, ['encrypt'])
    const cipher = Buffer.from(await webcrypto.subtle.encrypt(algorithm, key, deflateSync(text)))
    const body = Buffer.from(JSON.stringify({ encrypt: 2, data: Buffer.concat([iv, aad, cipher]).toString('base64'), error_code: 0 }))
    const decoded = await decodeBody(body, keyBytes.toString('base64'))
    expect(decoded.inner).toEqual(inner)
    expect(decoded.outer).toEqual({ encrypt: 2, error_code: 0 })
    expect((await decodeBody(body)).note).toMatch(/could not decode/)
  })
})

describe('runProbe with a fake listener', () => {
  const WINDOW = 60_000
  const TAIL = 3000

  it('sends 590 without a req_id, reports the phone prompt, then disposes with 591 and keeps listening for its reply', async () => {
    vi.useFakeTimers()
    const { listener, ws, sent, requireIds } = fakeListener()
    const done = runProbe(listener, { hostname: 'MY-PC', windowMs: WINDOW })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ version: 1, cmd: 590, subCmd: 0 })
    expect(requireIds[0]).toBe(false)
    const syncId = (sent[0].data.data as Record<string, unknown>).syncId as string

    await vi.advanceTimersByTimeAsync(1500)
    ws.emit('message', replyFrame(590, { error_code: 0, data: {} }))
    ws.emit('message', buildFrame(501, 0, { encrypt: 0, data: '{}' }))
    ws.emit('message', controlFrame(control('transfer_sync2', 'transfer_status', { status: 3, fromDevice: 0 }), control('group', 'join', {})))
    await vi.advanceTimersByTimeAsync(WINDOW - 1500)
    // 591 is out, and the listener is still attached for its reply
    expect(sent[1]).toMatchObject({ cmd: 591, subCmd: 0, data: { syncId, toDevice: 0, reason: 'probe' } })
    expect(ws.listenerCount('message')).toBe(1)
    ws.emit('message', replyFrame(591, { error_code: 0, data: {} }))
    await vi.advanceTimersByTimeAsync(TAIL)
    const report = await done

    expect(report.verdict).toBe('accepted-waiting-confirm')
    expect(report.payload).toBe(JSON.stringify(sent[0].data))
    expect(report.frames.map((f) => f.cmd)).toEqual([590, 601, 591])
    expect(report.frames[1].at).toBe(1500)
    expect(JSON.parse(report.frames[1].json)).toMatchObject({ act: 'transfer_status', data: { status: 3 } })
    expect(report.frames[2].at).toBe(WINDOW)
    expect(JSON.parse(report.frames[2].json)).toEqual({ encrypt: 0, data: { error_code: 0, data: {} } })
    expect(report.notes[0]).toBe('payload variant: default')
    expect(report.notes.join('\n')).toMatch(/chat frames .*501x1/)
    expect(sent).toHaveLength(2)
    expect(ws.listenerCount('message')).toBe(0)
    expect(ws.listenerCount('close')).toBe(0)
  })

  it('a late 590 reply inside the tail still counts', async () => {
    vi.useFakeTimers()
    const { listener, ws } = fakeListener()
    const done = runProbe(listener, { hostname: 'h', windowMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    ws.emit('message', replyFrame(590, { error_code: 211 }))
    await vi.advanceTimersByTimeAsync(TAIL)
    expect((await done).verdict).toBe('server-error')
  })

  it('does not take a 591 error reply for the answer to the request', async () => {
    vi.useFakeTimers()
    const { listener, ws } = fakeListener()
    const done = runProbe(listener, { hostname: 'h', windowMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    ws.emit('message', replyFrame(591, { error_code: 5 }))
    await vi.advanceTimersByTimeAsync(TAIL)
    const report = await done
    expect(report.verdict).toBe('silent')
    expect(report.frames).toHaveLength(1)
  })

  it('records a reply on an unknown cmd, redacted and short, but not chat traffic', async () => {
    vi.useFakeTimers()
    const { listener, ws } = fakeListener()
    const done = runProbe(listener, { hostname: 'h', windowMs: 1000 })
    ws.emit('message', buildFrame(595, 2, { encrypt: 0, data: JSON.stringify({ error_code: 0, data: { state: 'queued', imei: 'IMEI-3', pad: 'x'.repeat(3000) } }) }))
    ws.emit('message', buildFrame(501, 0, { encrypt: 0, data: JSON.stringify({ msgs: [{ content: 'hello' }] }) }))
    ws.emit('message', buildFrame(595, 3, { encrypt: 2, data: 'AAAA' }))
    await vi.advanceTimersByTimeAsync(1000 + TAIL)
    const report = await done
    expect(report.frames.map((f) => [f.cmd, f.subCmd])).toEqual([[595, 2], [595, 3]])
    expect(report.frames[0].json).toContain('queued')
    expect(report.frames[0].json).not.toContain('IMEI-3')
    expect(report.frames[0].json.length).toBeLessThan(1100)
    expect(report.frames[0].size).toBeGreaterThan(3000)
    // undecodable (no cipher key): the raw body is kept, cut
    expect(report.frames[1].json).toContain('AAAA')
    expect(JSON.stringify(report)).not.toContain('hello')
    expect(report.verdict).toBe('silent')
  })

  it('never lets imei (or other fields outside the allow-list) into the saved report', async () => {
    vi.useFakeTimers()
    const { listener, ws } = fakeListener()
    const done = runProbe(listener, { hostname: 'h', windowMs: 1000 })
    ws.emit('message', controlFrame({ content: { act_type: 'transfer_sync2', act: 'transfer_status', imei: 'IMEI-4', data: { status: 4, fromDevice: 0, imei: 'IMEI-5', device_name: 'My iPhone', syncId: 's1' } } }))
    await vi.advanceTimersByTimeAsync(1000 + TAIL)
    const report = await done
    const text = JSON.stringify(report)
    expect(text).not.toContain('IMEI-4')
    expect(text).not.toContain('IMEI-5')
    expect(text).not.toContain('My iPhone')
    expect(JSON.parse(report.frames[0].json)).toEqual({ act_type: 'transfer_sync2', act: 'transfer_status', imei: '<redacted>', data: { status: 4, fromDevice: 0, imei: '<redacted>', device_name: '<redacted>', syncId: 's1' } })
    expect(report.verdict).toBe('confirmed')
  })

  it('a frame it cannot read does not break the listener', async () => {
    vi.useFakeTimers()
    const { listener, ws } = fakeListener()
    const done = runProbe(listener, { hostname: 'h', windowMs: 1000 })
    expect(() => ws.emit('message', ['not a buffer'])).not.toThrow()
    expect(() => ws.emit('message', Buffer.from([1, 2]))).not.toThrow()
    expect(() => ws.emit('message', buildFrame(590, 0, 'plain string body'))).not.toThrow()
    ws.emit('message', controlFrame(control('transfer_sync2', 'upload_batch', { syncId: 's', idx: 0, isLast: true, msgUrl: 'https://cdn.example/blob?sig=zzz' })))
    await vi.advanceTimersByTimeAsync(1000 + TAIL)
    const report = await done
    expect(report.notes.join('\n')).toContain('frame not read')
    expect(report.verdict).toBe('upload_batch')
    expect(report.frames.at(-1)!.json).not.toContain('zzz')
    expect(report.notes.join('\n')).toContain('msgUrl present in 1')
  })

  it('reports a server error reply', async () => {
    vi.useFakeTimers()
    const { listener, ws } = fakeListener()
    const done = runProbe(listener, { hostname: 'h', windowMs: 1000 })
    ws.emit('message', replyFrame(590, { error_code: 211, error_message: 'ClientNotSupport' }))
    await vi.advanceTimersByTimeAsync(1000 + TAIL)
    const report = await done
    expect(report.verdict).toBe('server-error')
    expect(report.notes.join('\n')).toContain('211 (ClientNotSupport)')
  })

  it('is silent when nothing comes', async () => {
    vi.useFakeTimers()
    const { listener } = fakeListener()
    const done = runProbe(listener, { hostname: 'h', windowMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000 + TAIL)
    expect((await done).verdict).toBe('silent')
  })

  it('sends the variant asked for', async () => {
    vi.useFakeTimers()
    const { listener, sent } = fakeListener()
    const done = runProbe(listener, { hostname: 'h', windowMs: 10, variant: 'spike' })
    await vi.advanceTimersByTimeAsync(10 + TAIL)
    const report = await done
    expect(sent[0].data.data).toMatchObject({ syncType: 0, req: { batchSize: 2000 } })
    expect(report.notes[0]).toBe('payload variant: spike')
  })

  it('runs one probe at a time, across listeners', async () => {
    vi.useFakeTimers()
    const first = fakeListener()
    const second = fakeListener()
    const done = runProbe(first.listener, { hostname: 'h', windowMs: 1000 })
    await expect(runProbe(second.listener, { hostname: 'h', windowMs: 1000 })).rejects.toThrow(/already running/)
    expect(second.sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000 + TAIL)
    await done
    const again = runProbe(second.listener, { hostname: 'h', windowMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000 + TAIL)
    await again
  })

  it('stops when the socket closes and does not try to dispose over it', async () => {
    vi.useFakeTimers()
    const { listener, ws, sent } = fakeListener()
    const done = runProbe(listener, { hostname: 'h', windowMs: WINDOW })
    ws.emit('close')
    const report = await done
    expect(sent).toHaveLength(1)
    expect(report.notes.join('\n')).toContain('socket closed')
    expect(ws.listenerCount('message')).toBe(0)
  })

  it('refuses without an open socket and cleans up when sending throws', async () => {
    await expect(runProbe({ ws: null, sendWs: () => {} }, { hostname: 'h' })).rejects.toThrow(/not open/)
    const { listener, ws } = fakeListener()
    ws.readyState = 3
    await expect(runProbe(listener, { hostname: 'h' })).rejects.toThrow(/not open/)
    ws.readyState = 1
    listener.sendWs = () => {
      throw new Error('boom')
    }
    await expect(runProbe(listener, { hostname: 'h' })).rejects.toThrow('boom')
    expect(ws.listenerCount('message')).toBe(0)
    // and the one-at-a-time guard was released
    listener.sendWs = () => {}
    ws.emit('close')
    vi.useFakeTimers()
    const ok = runProbe(listener, { hostname: 'h', windowMs: 10 })
    await vi.advanceTimersByTimeAsync(10 + TAIL)
    await ok
  })
})
