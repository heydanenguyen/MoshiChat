// Go/no-go probe for Zalo's "sync messages from phone" (sync v2; spike: docs/superpowers/specs/2026-10-10-zalo-pc-sync-spike.md).
// It sends ONE cmd-590 request over the live zca-js socket and records exactly what comes back. No crypto, no data decode:
// the question is only whether Zalo's server takes the request from a web session and whether the phone is asked to confirm.
// The owner starts it from Settings; nothing here runs on its own.
import { randomBytes, webcrypto } from 'crypto'
import { unzipSync } from 'zlib'
import type { ProbeFrame, ProbeReport, ProbeVariant, ProbeVerdict } from '@shared/bridge'

export const CMD_SYNC_REQUEST = 590
export const CMD_SYNC_DISPOSE = 591
export const CMD_SYNC_WAKE = 592
export const CMD_CONTROL = 601
/** How long the probe listens for the phone / server before it disposes the session. */
export const PROBE_WINDOW_MS = 60_000
/** After cmd 591 the listeners stay on this long, for its reply and late 590 / 592 answers. */
export const TAIL_MS = 3000
/** Longest raw JSON kept per sync frame. */
export const MAX_FRAME_JSON = 4096
/** Longest body kept of a frame on a cmd the probe does not know, and how many of those are kept. */
export const MAX_UNKNOWN_JSON = 1024
export const MAX_UNKNOWN_FRAMES = 40

/** What zca-js's Listener.sendWs takes. */
export interface WsPayload {
  version: number
  cmd: number
  subCmd: number
  data: Record<string, unknown>
}

/** The bit of the `ws` socket the probe needs (additive 'message' / 'close' listeners: the adapter's own handler is never touched). */
export interface ProbeSocket {
  readyState?: number
  on(event: 'message', fn: (data: unknown) => void): unknown
  on(event: 'close', fn: () => void): unknown
  off(event: 'message', fn: (data: unknown) => void): unknown
  off(event: 'close', fn: () => void): unknown
}

/** zca-js's Listener as far as it is reachable: `ws` and `cipherKey` are private in its typings but plain fields at run time. */
export interface ProbeListener {
  ws?: ProbeSocket | null
  cipherKey?: string
  sendWs?: (payload: WsPayload, requireId?: boolean) => void
}

/** zca-js's own framing (listen.js sendWs): 1 byte version, uint16 LE cmd, 1 byte subCmd, UTF-8 JSON. */
export function buildFrame(cmd: number, subCmd: number, data: unknown, version = 1): Buffer {
  const body = Buffer.from(JSON.stringify(data), 'utf8')
  const out = Buffer.alloc(4 + body.length)
  out.writeUInt8(version, 0)
  out.writeUInt16LE(cmd, 1)
  out.writeUInt8(subCmd, 3)
  body.copy(out, 4)
  return out
}

export function parseFrame(frame: Buffer): { version: number; cmd: number; subCmd: number; body: Buffer } | undefined {
  if (frame.length < 4) return undefined
  return { version: frame[0], cmd: frame.readUInt16LE(1), subCmd: frame[3], body: frame.subarray(4) }
}

export interface SyncPayloadInput {
  hostname: string
  variant?: ProbeVariant
  random?: (size: number) => Buffer
  /** For the reqId only. */
  now?: number
}

/**
 * The cmd-590 JSON, as the PC client sends it (spike 1.2). Guessed where the spike only lists a type:
 * reqId `req_<ms>` (zca-js style), syncId 32 hex chars, priority 0, ussidx 0, empty tempKey (manual path: the phone is tapped).
 * Variant 'default': syncType 1 (OnDemand), one conversation query partition 0 / from 0 / to 0 / limit 10, batchSize 100.
 * Variant 'spike' (spike section 4): syncType 0 (SyncFull), partition "-1" / from 0 / to MAX_SAFE_INTEGER / limit 10, batchSize 2000.
 * ek / ik are random bytes, not key pairs: the probe never decrypts anything.
 */
export function buildSyncPayload({ hostname, variant = 'default', random = randomBytes, now = Date.now() }: SyncPayloadInput): { syncId: string; json: Record<string, unknown> } {
  const syncId = random(16).toString('hex')
  const spike = variant === 'spike'
  return {
    syncId,
    json: {
      reqId: `req_${now}`,
      data: {
        syncId,
        syncType: spike ? 0 : 1,
        ek: random(32).toString('base64'),
        ik: random(32).toString('base64'),
        toDevice: 0,
        tempKey: '',
        deviceName: hostname,
        req: {
          type: 'conversation',
          priority: 0,
          queries: [{ partition: spike ? '-1' : 0, from: 0, to: spike ? Number.MAX_SAFE_INTEGER : 0, limit: 10 }],
          batchSize: spike ? 2000 : 100
        },
        ver: 1,
        ussidx: 0
      }
    }
  }
}

/** cmd 591 {syncId, toDevice, reason}: lets the server (and phone) drop the session. */
export function buildDisposeData(syncId: string): Record<string, unknown> {
  return { syncId, toDevice: 0, reason: 'probe' }
}

// ---- reading what comes back -----------------------------------------------------------------------------------

/** transfer_status values (spike 1.3). */
export type ProbeSignal =
  | { kind: 'status'; status: number }
  | { kind: 'upload_batch'; hasMsgUrl: boolean }
  | { kind: 'other' }
  | { kind: 'error'; code: number }
  | { kind: 'ack' }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The payload of a control ('data' is sometimes a JSON string). */
function controlData(content: Record<string, unknown>): Record<string, unknown> {
  let data = content.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return {}
    }
  }
  return isRecord(data) ? data : {}
}

/** A cmd-601 control that belongs to sync (transfer_*), as a signal; undefined for every other control (group events, uploads...). */
export function classifyControl(content: unknown): ProbeSignal | undefined {
  if (!isRecord(content)) return undefined
  const type = typeof content.act_type === 'string' ? content.act_type : ''
  const act = typeof content.act === 'string' ? content.act : ''
  if (act === 'upload_batch') return { kind: 'upload_batch', hasMsgUrl: typeof controlData(content).msgUrl === 'string' && controlData(content).msgUrl !== '' }
  if (act === 'transfer_status') {
    const status = Number(controlData(content).status)
    return Number.isFinite(status) ? { kind: 'status', status } : { kind: 'other' }
  }
  return type.startsWith('transfer') ? { kind: 'other' } : undefined
}

/** The status the phone/server reported, as the probe's answer. */
export function statusVerdict(status: number): ProbeVerdict {
  if (status === 3) return 'accepted-waiting-confirm'
  if (status === 4 || status === 5) return 'confirmed'
  if (status === 6 || status === 7) return 'rejected'
  return 'other-status'
}

/** The furthest the exchange got: data offered, else the last status, else an error reply, else a bare ack, else nothing. */
export function verdictOf(signals: ProbeSignal[]): ProbeVerdict {
  if (signals.some((s) => s.kind === 'upload_batch')) return 'upload_batch'
  const statuses = signals.filter((s): s is Extract<ProbeSignal, { kind: 'status' }> => s.kind === 'status')
  if (statuses.length) return statusVerdict(statuses[statuses.length - 1].status)
  if (signals.some((s) => s.kind === 'error')) return 'server-error'
  if (signals.some((s) => s.kind === 'ack')) return 'ack-only'
  return 'silent'
}

/** A reply frame's error_code: Zalo puts it beside `data` or inside the decoded body. Undefined when there is none. */
export function errorCodeOf(...bodies: unknown[]): number | undefined {
  for (const body of bodies) {
    if (!isRecord(body)) continue
    for (const holder of [body, body.data]) {
      if (isRecord(holder) && typeof holder.error_code === 'number') return holder.error_code
    }
  }
  return undefined
}

/** Fields of a sync control that are kept; every other field is recorded as redacted. */
const SYNC_FIELDS = new Set(['status', 'fromDevice', 'syncId', 'idx', 'isLast', 'err', 'batchType', 'scopes'])
const SYNC_TOP = new Set(['act', 'act_type'])
const REDACTED = '<redacted>'
/** Keys whose values never reach a report from a body the probe does not know. */
const SECRET_KEY = /imei|key|secret|token|cookie|msgurl|temp_key|tempkey|password|passwd/i

/** A sync control for the record: only the allow-listed fields keep their value (the signed msgUrl, imei, keys... do not). */
export function syncControlRecord(content: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(content)) if (k !== 'data') out[k] = SYNC_TOP.has(k) ? v : REDACTED
  out.data = Object.fromEntries(Object.entries(controlData(content)).map(([k, v]) => [k, SYNC_FIELDS.has(k) ? v : REDACTED]))
  return out
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…[+${text.length - max} chars]` : text)

/** JSON for the record with secret-looking keys blanked, cut at `max` characters. */
export function redactedJson(value: unknown, max = MAX_FRAME_JSON): string {
  return cut(JSON.stringify(value, (key, v: unknown) => (key && SECRET_KEY.test(key) ? REDACTED : v)) ?? 'null', max)
}

/** A body that could not be decoded, as a cut string with secret-looking pairs blanked. */
export function scrubbedRaw(raw: string, max = MAX_UNKNOWN_JSON): string {
  return cut(raw.replace(/"([^"]*)"\s*:\s*"[^"]*"/g, (m, k: string) => (SECRET_KEY.test(k) ? `"${k}":"${REDACTED}"` : m)), max)
}

/** JSON.parse that keeps integers beyond 2^53 as exact strings (ids), where the engine passes the source text. */
export function parseJson(text: string): unknown {
  const reviver = (_key: string, value: unknown, context?: { source?: string }): unknown =>
    typeof value === 'number' && !Number.isSafeInteger(value) && Number.isInteger(value) && context?.source && /^-?\d+$/.test(context.source) ? context.source : value
  return JSON.parse(text, reviver)
}

const fromBase64 = (s: string): Buffer => Buffer.from(s, 'base64')

/**
 * zca-js decodeEventData, for a frame body: { data, encrypt } where encrypt 0 plain, 1 base64+zlib, 2 AES-GCM+zlib, 3 AES-GCM.
 * Returns the envelope fields (`outer`, without data) and the decoded `inner`; a body that is not an envelope is `inner` alone.
 * `note` when it could not be read (the raw body is kept then).
 */
export async function decodeBody(body: Buffer, cipherKey?: string): Promise<{ outer?: Record<string, unknown>; inner?: unknown; note?: string; raw: string }> {
  const raw = body.toString('utf8')
  let outer: unknown
  try {
    outer = parseJson(raw)
  } catch {
    return { raw, note: 'body is not JSON' }
  }
  if (!isRecord(outer) || typeof outer.data !== 'string' || typeof outer.encrypt !== 'number') return { inner: outer, raw }
  try {
    const encrypt = outer.encrypt
    let text: string
    if (encrypt === 0) {
      text = outer.data
    } else {
      let buffer = fromBase64(encrypt === 1 ? outer.data : decodeURIComponent(outer.data))
      if (encrypt !== 1) {
        if (!cipherKey || buffer.length < 48) throw new Error('missing cipher key or short data')
        // Plain Uint8Array copies: webcrypto's typings refuse Buffer's ArrayBufferLike.
        const bytes = new Uint8Array(buffer)
        const algorithm = { name: 'AES-GCM', iv: bytes.slice(0, 16), tagLength: 128, additionalData: bytes.slice(16, 32) }
        const key = await webcrypto.subtle.importKey('raw', new Uint8Array(fromBase64(cipherKey)), algorithm, false, ['decrypt'])
        buffer = Buffer.from(await webcrypto.subtle.decrypt(algorithm, key, bytes.slice(32)))
      }
      text = (encrypt === 3 ? buffer : unzipSync(buffer)).toString('utf8')
    }
    const { data: _data, ...rest } = outer
    return { outer: rest, inner: parseJson(text), raw }
  } catch (err) {
    return { outer, raw, note: `could not decode body: ${(err as Error).message}` }
  }
}

// ---- the probe ---------------------------------------------------------------------------------------------------

export interface RunProbeOptions {
  hostname: string
  variant?: ProbeVariant
  tailMs?: number
  windowMs?: number
  now?: () => number
  random?: (size: number) => Buffer
  log?: (...args: unknown[]) => void
}

const WATCHED = new Set([CMD_SYNC_REQUEST, CMD_SYNC_DISPOSE, CMD_SYNC_WAKE, CMD_CONTROL])
/** Chat traffic zca-js already handles (or the cipher-key handshake): never recorded, only counted. */
const CHAT_CMDS = new Set([1, 2, 501, 502, 510, 511, 521, 522, 602, 610, 611, 612, 3000])

/** Whether the socket is up (ws: OPEN = 1). */
const isOpen = (ws: ProbeSocket): boolean => ws.readyState === undefined || ws.readyState === 1

/** One probe at a time, whatever the account. */
let running = false

/**
 * Sends the request over `listener`, listens for `windowMs`, sends the dispose, keeps listening `tailMs` more for its reply, and
 * reports. The listening is a second, read-only 'message' listener on the same socket, removed afterwards: zca-js's own
 * handler is never replaced or wrapped, and nothing the probe does with a frame can reach it.
 */
export async function runProbe(listener: ProbeListener, options: RunProbeOptions): Promise<ProbeReport> {
  const { hostname, variant = 'default', windowMs = PROBE_WINDOW_MS, tailMs = TAIL_MS, now = Date.now, random = randomBytes, log = () => {} } = options
  const ws = listener.ws
  if (!ws || !isOpen(ws) || typeof listener.sendWs !== 'function') throw new Error('The Zalo socket is not open')
  if (running) throw new Error('The probe is already running')
  running = true
  try {
    return await probe(listener, ws, { hostname, variant, windowMs, tailMs, now, random, log })
  } finally {
    running = false
  }
}

async function probe(
  listener: ProbeListener,
  ws: ProbeSocket,
  { hostname, variant, windowMs, tailMs, now, random, log }: Required<RunProbeOptions>
): Promise<ProbeReport> {
  const send = (cmd: number, data: Record<string, unknown>): void => listener.sendWs!({ version: 1, cmd, subCmd: 0, data }, false)

  const { syncId, json } = buildSyncPayload({ hostname, variant, random, now: now() })
  const frames: ProbeFrame[] = []
  const signals: ProbeSignal[] = []
  const notes: string[] = [`payload variant: ${variant}`]
  const seen = new Map<number, number>()
  const pending: Promise<void>[] = []
  let otherControls = 0
  let unknownKept = 0
  let sentAt = now()

  const inspect = async (frame: Buffer): Promise<void> => {
    const head = parseFrame(frame)
    if (!head) return
    seen.set(head.cmd, (seen.get(head.cmd) ?? 0) + 1)
    if (CHAT_CMDS.has(head.cmd)) return
    const at = now() - sentAt
    const decoded = await decodeBody(head.body, listener.cipherKey)
    if (decoded.note) notes.push(`cmd ${head.cmd}: ${decoded.note}`)
    const body = decoded.outer ? { ...decoded.outer, data: decoded.inner } : decoded.inner
    if (!WATCHED.has(head.cmd)) {
      // A reply on a cmd nobody here knows: it may be how Zalo answers the request, so keep it (redacted, short).
      if (++unknownKept > MAX_UNKNOWN_FRAMES) return
      const kept = body === undefined || decoded.note?.startsWith('could not') ? scrubbedRaw(decoded.raw) : redactedJson(body, MAX_UNKNOWN_JSON)
      frames.push({ at, cmd: head.cmd, subCmd: head.subCmd, size: head.body.length, json: kept })
      return
    }
    if (head.cmd !== CMD_CONTROL) {
      const kept = body === undefined || decoded.note?.startsWith('could not') ? scrubbedRaw(decoded.raw, MAX_FRAME_JSON) : redactedJson(body)
      frames.push({ at, cmd: head.cmd, subCmd: head.subCmd, size: head.body.length, json: kept })
      // The dispose's reply is recorded but is not an answer to the request.
      if (head.cmd === CMD_SYNC_DISPOSE) return
      const code = errorCodeOf(decoded.outer, decoded.inner)
      signals.push(code ? { kind: 'error', code } : { kind: 'ack' })
      return
    }
    const inner = decoded.inner
    const controls = isRecord(inner) ? (isRecord(inner.data) ? inner.data.controls : inner.controls) : undefined
    for (const control of Array.isArray(controls) ? controls : []) {
      const content = isRecord(control) ? control.content : undefined
      const signal = classifyControl(content)
      if (!signal || !isRecord(content)) {
        otherControls++
        continue
      }
      signals.push(signal)
      frames.push({ at, cmd: head.cmd, subCmd: head.subCmd, json: redactedJson(syncControlRecord(content)) })
    }
  }

  const toBuffer = (data: unknown): Buffer | undefined => {
    if (Buffer.isBuffer(data)) return data
    if (Array.isArray(data)) return Buffer.concat(data as Buffer[])
    if (data instanceof ArrayBuffer) return Buffer.from(data)
    return undefined
  }
  // Never throws into the socket's emitter: a frame the probe cannot read is a note, not a broken listener.
  const onMessage = (data: unknown): void => {
    try {
      const frame = toBuffer(data)
      if (frame) pending.push(inspect(frame).catch((err: Error) => void notes.push(`frame not read: ${err.message}`)))
    } catch (err) {
      notes.push(`frame not read: ${(err as Error).message}`)
    }
  }
  let closed = false
  let stop: () => void = () => {}
  const closedWait = new Promise<void>((resolve) => (stop = resolve))
  const onClose = (): void => {
    closed = true
    stop()
  }
  const wait = (ms: number): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    return Promise.race([new Promise<void>((resolve) => (timer = setTimeout(resolve, ms))), closedWait]).finally(() => clearTimeout(timer))
  }
  ws.on('message', onMessage)
  ws.on('close', onClose)
  try {
    sentAt = now()
    send(CMD_SYNC_REQUEST, json)
    log('zalo sync2 probe: cmd 590 sent', variant, syncId)
    await wait(windowMs)
    if (closed) {
      notes.push('the socket closed before the listening window ended')
    } else {
      try {
        send(CMD_SYNC_DISPOSE, buildDisposeData(syncId))
        notes.push(`cmd 591 (dispose) sent at +${now() - sentAt} ms`)
        await wait(tailMs)
      } catch (err) {
        notes.push(`cmd 591 not sent: ${(err as Error).message}`)
      }
    }
  } finally {
    ws.off('message', onMessage)
    ws.off('close', onClose)
  }
  await Promise.allSettled(pending)

  const verdict = verdictOf(signals)
  for (const sig of signals) {
    if (sig.kind === 'error') notes.push(`reply with error_code ${sig.code}${sig.code === 211 ? ' (ClientNotSupport)' : ''}`)
    if (sig.kind === 'ack') notes.push('reply to 590/592 without an error_code')
  }
  const statuses = signals.filter((x): x is Extract<ProbeSignal, { kind: 'status' }> => x.kind === 'status').map((x) => x.status)
  if (statuses.length) notes.push(`transfer_status: ${statuses.join(' > ')}`)
  const batches = signals.filter((x): x is Extract<ProbeSignal, { kind: 'upload_batch' }> => x.kind === 'upload_batch')
  if (batches.length) notes.push(`upload_batch x${batches.length}, msgUrl present in ${batches.filter((b) => b.hasMsgUrl).length} (never fetched)`)
  if (signals.some((x) => x.kind === 'other')) notes.push('other transfer_* controls arrived (see frames)')
  if (otherControls) notes.push(`${otherControls} unrelated control(s) ignored`)
  if (unknownKept > MAX_UNKNOWN_FRAMES) notes.push(`${unknownKept - MAX_UNKNOWN_FRAMES} more frames on unknown cmds not kept`)
  const chat = [...seen].filter(([cmd]) => CHAT_CMDS.has(cmd)).map(([cmd, n]) => `${cmd}x${n}`)
  if (chat.length) notes.push(`chat frames in the window (not kept): ${chat.join(', ')}`)
  return { sentAt, payload: JSON.stringify(json), frames, verdict, notes }
}
