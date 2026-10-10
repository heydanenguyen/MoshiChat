import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { imageTypeOf } from './media/image-type'
import { conversationId } from './adapters/types'
import { decrypt, encrypt } from './zalo-share'
import type { OutgoingAttachment, SendOptions } from '@shared/types'
import type { ZaloRelayStatus } from '@shared/bridge'
import {
  RELAY_DAYS,
  RELAY_MAX_BYTES,
  RELAY_MEDIA_MAX,
  RELAY_SEND_TIMEOUT_MS,
  RELAY_VERSION,
  extFor,
  mediaUrlOf,
  mergeAcks,
  pendingOutbox,
  relayConflict,
  trimState,
  type AckFile,
  type OutboxItem,
  type RelayMeta,
  type RelaySnapshot,
  type RelayState,
  type RelaySticker
} from '@shared/zalo-relay'

/**
 * The computer that keeps the Zalo session, serving the user's other computers ("readers") through the sync folder
 * (spec 2.1/2.2): it writes the chats and the last weeks of messages, copies small pictures/voice notes (Zalo's file
 * host wants a session), and carries out what readers queue to send or mark read. Everything in the folder besides
 * file names (and the tiny state.meta.json) is encrypted with the key of Zalo sharing (zalo-share.ts), so the cloud
 * drive only sees ciphertext.
 */

const DIR = 'zalo-relay'
const STATE_EVERY_MS = 2 * 60_000
/** Without a new message the state is not rebuilt: only state.meta.json is refreshed (the heartbeat), until this long has passed. */
const STATE_FULL_EVERY_MS = 30 * 60_000
/** After a new message, the state is rewritten this soon (bursts count once). */
const STATE_DEBOUNCE_MS = 15_000
const WATCH_MS = 5_000
const OUTBOX_EVERY_MS = 20_000
/** A queued message older than this is not sent any more: the reader already marked it failed (same constant), and sending now would duplicate. */
const OUTBOX_EXPIRES_MS = RELAY_SEND_TIMEOUT_MS
/** One send (or upload) may take this long before it is answered with a timeout and the next item goes on. */
const SEND_TIMEOUT_MS = 60_000
/** Acks older than this are forgotten (a queued message that old is expired anyway). */
const ACK_KEEP_MS = 3 * 24 * 3600_000
const TAKEN_KEEP = 2000
const DAY_MS = 24 * 3600_000
/** Only recent messages get their picture copied: a first run must not download months of photos. */
const MEDIA_DAYS = 14
const MEDIA_PER_PASS = 60
const MEDIA_PARALLEL = 2
const MEDIA_TRIES = 3
const MEDIA_TIMEOUT_MS = 20_000
const MAX_ERRORS = 5
const ZALO_HOST = /(^|\.)(zdn\.vn|zadn\.vn|dlfl\.vn|zaloapp\.com)$/i

/** What the relay needs from a Zalo account (ZaloAdapter in the app). */
export interface RelaySource {
  readonly account: { id: string; status: string }
  readonly shareOwner: string
  shareVersion: number
  relaySnapshot(days: number): Promise<RelaySnapshot>
  sendMessage(conversationId: string, text: string, options?: SendOptions): Promise<{ id: string }>
  markRead(conversationId: string): Promise<void>
}

export type MediaDownloader = (url: string) => Promise<{ data: Buffer; type: string } | undefined>

export interface RelayOptions {
  download?: MediaDownloader
  now?: () => number
  sendTimeoutMs?: number
}

/**
 * Zalo's file host only answers a page of its own: Referer as chat.zalo.me, like the in-app media proxy. Redirects are
 * followed by hand so every hop stays on Zalo's hosts; the body is read as a stream and dropped past the size cap.
 */
const downloadMedia: MediaDownloader = async (url) => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), MEDIA_TIMEOUT_MS)
  try {
    let target = new URL(url)
    for (let hop = 0; hop < 4; hop++) {
      if (target.protocol !== 'https:' || !ZALO_HOST.test(target.hostname)) return undefined
      const res = await fetch(target, { headers: { Referer: 'https://chat.zalo.me/' }, redirect: 'manual', signal: abort.signal })
      const next = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && next) {
        target = new URL(next, target)
        continue
      }
      if (!res.ok || !res.body || Number(res.headers.get('content-length') ?? 0) > RELAY_MEDIA_MAX) return undefined
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length
        if (size > RELAY_MEDIA_MAX) {
          abort.abort()
          return undefined
        }
        chunks.push(chunk)
      }
      return { data: Buffer.concat(chunks), type: res.headers.get('content-type') ?? '' }
    }
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Message ids are digits, but the name is made of them, so keep it a plain file name. */
const safeName = (id: string): string => id.replace(/[^\w-]/g, '_')

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | undefined)?.code

async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  await fs.writeFile(path + '.tmp', data)
  await fs.rename(path + '.tmp', path)
}

export class ZaloRelay {
  private key?: Buffer
  private keyFile = join(app.getPath('userData'), 'zalo-share.key')
  private flagFile = join(app.getPath('userData'), 'zalo-relay.json')
  private enabled = false
  private owner?: string
  private lastWriteAt?: number
  private lastOutboxAt?: number
  private processed = 0
  private errors: string[] = []
  /** Owners another computer relays (nothing is written or sent for them), and why. */
  private blocked = new Map<string, string>()
  private signedOut = false
  private timers: Array<ReturnType<typeof setInterval>> = []
  private debounce?: ReturnType<typeof setTimeout>
  private writing: Promise<void> = Promise.resolve()
  private polling: Promise<void> = Promise.resolve()
  /** shareVersion each owner's state was last written at, and when. */
  private written = new Map<string, number>()
  private stateAt = new Map<string, number>()
  /** Items taken up in this run, so one is never started twice even before its ack reaches the disk. Oldest forgotten first. */
  private taken = new Set<string>()
  /** This computer's own answers per owner: what the ack file holds, kept in memory too in case a write fails. */
  private ownAcks = new Map<string, AckFile>()
  private mediaTried = new Set<string>()
  private mediaFailures = new Map<string, number>()
  private download: MediaDownloader
  private now: () => number
  private sendTimeoutMs: number

  constructor(
    private folder: () => string | undefined,
    private device: () => { id: string; name: string },
    private sources: () => RelaySource[],
    private log: (...args: unknown[]) => void,
    options: RelayOptions = {}
  ) {
    this.download = options.download ?? downloadMedia
    this.now = options.now ?? Date.now
    this.sendTimeoutMs = options.sendTimeoutMs ?? SEND_TIMEOUT_MS
  }

  async start(): Promise<void> {
    try {
      this.enabled = JSON.parse(await fs.readFile(this.flagFile, 'utf8')).enabled === true
    } catch {
      /* never turned on here */
    }
    if (!this.enabled) return
    if (!(await this.loadKey())) {
      this.enabled = false
      return
    }
    // Every write and every outbox pass first checks that no other computer relays this Zalo (refreshBlock).
    this.schedule()
    setTimeout(() => void this.writeNow(), 45_000).unref?.()
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = undefined
  }

  status(): ZaloRelayStatus {
    const standing = this.enabled ? [...this.blocked.values(), ...(this.signedOut ? ['Zalo signed out'] : [])] : []
    return {
      enabled: this.enabled,
      owner: this.owner,
      lastWriteAt: this.lastWriteAt,
      lastOutboxAt: this.lastOutboxAt,
      processed: this.processed,
      errors: [...standing, ...this.errors]
    }
  }

  /** Turn the relay on: refuses when another computer relays this Zalo, otherwise writes the state at once. */
  async enable(): Promise<ZaloRelayStatus> {
    this.errors = []
    this.blocked.clear()
    const fail = (message: string): ZaloRelayStatus => {
      this.errors = [message]
      return this.status()
    }
    if (!this.folder()) return fail('Set up sync first: the relay lives in the sync folder')
    if (!(await this.loadKey())) return fail('Turn on Zalo message sharing first (the relay uses its passphrase)')
    const live = this.live()
    if (!live.length) return fail('Sign in to Zalo on this computer first')
    this.owner = live[0].shareOwner
    for (const source of live) {
      const other = await this.blockedBy(source.shareOwner)
      if (other) return fail(other)
    }
    this.enabled = true
    await writeAtomic(this.flagFile, JSON.stringify({ enabled: true })).catch(() => undefined)
    this.written.clear()
    this.schedule()
    await this.writeNow()
    return this.status()
  }

  async disable(): Promise<ZaloRelayStatus> {
    this.enabled = false
    this.stop()
    this.blocked.clear()
    await writeAtomic(this.flagFile, JSON.stringify({ enabled: false })).catch(() => undefined)
    return this.status()
  }

  private async loadKey(): Promise<boolean> {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false
      this.key = Buffer.from(safeStorage.decryptString(await fs.readFile(this.keyFile)), 'base64')
      return true
    } catch {
      return false
    }
  }

  /** The Zalo accounts that are signed in now; a signed-out one is left alone (no heartbeat, its queue waits). */
  private live(): RelaySource[] {
    const all = this.sources().filter((s) => s.shareOwner)
    this.signedOut = !all.length || all.some((s) => s.account.status !== 'connected')
    return all.filter((s) => s.account.status === 'connected')
  }

  private schedule(): void {
    this.stop()
    const every = (fn: () => void, ms: number): void => {
      const timer = setInterval(fn, ms)
      timer.unref?.()
      this.timers.push(timer)
    }
    every(() => void this.writeNow(), STATE_EVERY_MS)
    every(() => void this.pollNow(), OUTBOX_EVERY_MS)
    // A new Zalo message bumps shareVersion; the state follows 15 s later, however many arrive meanwhile.
    every(() => {
      if (this.debounce || !this.live().some((s) => this.written.get(s.shareOwner) !== s.shareVersion)) return
      this.debounce = setTimeout(() => {
        this.debounce = undefined
        void this.writeNow()
      }, STATE_DEBOUNCE_MS)
      this.debounce.unref?.()
    }, WATCH_MS)
  }

  private fail(message: string): void {
    this.log('zalo relay:', message)
    this.errors = [...this.errors.filter((e) => e !== message), message].slice(-MAX_ERRORS)
  }

  /** Write the state (or just the heartbeat) now; one at a time. */
  writeNow(): Promise<void> {
    this.writing = this.writing.then(() => this.writeAll()).catch((err: Error) => this.fail(err.message))
    return this.writing
  }

  /** Look at the readers' outboxes now; one pass at a time. */
  pollNow(): Promise<void> {
    this.polling = this.polling.then(() => this.pollAll()).catch((err: Error) => this.fail(err.message))
    return this.polling
  }

  private ownerDir(owner: string): string | undefined {
    const folder = this.folder()
    return folder ? join(folder, DIR, owner) : undefined
  }

  /**
   * Who else relays this owner, as text; undefined when nobody does. Read from the small state.meta.json; without one,
   * from the state's own header. When what is there cannot be read, that counts as another relay (fail safe), unless
   * the state file is old enough that nobody can be writing it.
   */
  private async blockedBy(owner: string): Promise<string | undefined> {
    const dir = this.ownerDir(owner)
    if (!dir) return undefined
    const me = this.device()
    const now = this.now()
    const named = (who: string): string => `${who} is already the relay for this Zalo`
    let meta: unknown
    try {
      meta = JSON.parse(await fs.readFile(join(dir, 'state.meta.json'), 'utf8'))
    } catch (err) {
      // A sidecar that is there but cannot be read (half-synced, locked) says nothing about who relays: assume someone does.
      if (codeOf(err) !== 'ENOENT') return named('Another computer')
      const path = join(dir, 'state.zrs')
      try {
        const state = JSON.parse(gunzipSync(decrypt(this.key!, await fs.readFile(path))).toString('utf8')) as RelayState
        const other = relayConflict(state, me.id, now)
        return other ? named(other) : undefined
      } catch (inner) {
        if (codeOf(inner) === 'ENOENT') return undefined
        const stat = await fs.stat(path).catch(() => undefined)
        return !stat || now - stat.mtimeMs < 10 * 60_000 ? named('Another computer') : undefined
      }
    }
    const m = meta as Partial<RelayMeta> | null
    if (!m || typeof m.relayDeviceId !== 'string' || typeof m.writtenAt !== 'number' || !Number.isFinite(m.writtenAt)) return named('Another computer')
    const other = relayConflict(m as RelayMeta, me.id, now)
    return other ? named(other) : undefined
  }

  private async refreshBlock(owner: string): Promise<boolean> {
    const why = await this.blockedBy(owner)
    if (why) {
      this.blocked.set(owner, why)
      // Rebuild when unblocked rather than heartbeat a state from before the other relay.
      this.written.delete(owner)
      this.stateAt.delete(owner)
    } else this.blocked.delete(owner)
    return !!why
  }

  private async writeMeta(dir: string, stateAt: number): Promise<void> {
    const me = this.device()
    const meta: RelayMeta = { relayDeviceId: me.id, relayDeviceName: me.name, writtenAt: this.now(), stateAt }
    await writeAtomic(join(dir, 'state.meta.json'), JSON.stringify(meta))
    this.lastWriteAt = meta.writtenAt
  }

  private async writeAll(): Promise<void> {
    const key = this.key
    if (!this.enabled || !key || !this.folder()) return
    this.errors = []
    for (const source of this.live()) {
      const owner = source.shareOwner
      this.owner ??= owner
      if (await this.refreshBlock(owner)) continue
      const dir = this.ownerDir(owner)!
      const me = this.device()
      const last = this.stateAt.get(owner)
      if (last !== undefined && this.written.get(owner) === source.shareVersion && this.now() - last < STATE_FULL_EVERY_MS) {
        // Nothing new: only prove this relay is alive.
        await this.writeMeta(dir, last)
        continue
      }
      const version = source.shareVersion
      const snapshot = await source.relaySnapshot(RELAY_DAYS)
      const state = trimState<RelayState>(
        { version: RELAY_VERSION, relayDeviceId: me.id, relayDeviceName: me.name, writtenAt: this.now(), ...snapshot },
        RELAY_MAX_BYTES,
        RELAY_DAYS,
        this.now()
      )
      for (const sub of ['media', 'outbox', 'acks']) await fs.mkdir(join(dir, sub), { recursive: true })
      await writeAtomic(join(dir, 'state.zrs'), encrypt(key, gzipSync(JSON.stringify(state))))
      this.written.set(owner, version)
      this.stateAt.set(owner, state.writtenAt)
      await this.writeMeta(dir, state.writtenAt)
      // Pictures after the text: readers get the messages first.
      await this.copyMedia(dir, state).catch((err: Error) => this.fail(`media: ${err.message}`))
      // A long media pass must not leave the heartbeat stale.
      await this.writeMeta(dir, state.writtenAt)
    }
  }

  /** Copy new small pictures, stickers and voice notes (two at a time, newest first), and drop copies of messages that left the window. */
  private async copyMedia(dir: string, state: RelayState): Promise<void> {
    const key = this.key!
    const mediaDir = join(dir, 'media')
    const stickers = new Map<number, RelaySticker>(state.stickers)
    const names = (await fs.readdir(mediaDir)).filter((n) => !n.endsWith('.tmp'))
    const have = new Set(names.map((n) => n.slice(0, n.lastIndexOf('.'))))
    const since = this.now() - MEDIA_DAYS * DAY_MS
    const wanted: Array<{ msgId: string; url: string; ts: number; voice: boolean }> = []
    const all = new Set<string>()
    for (const list of Object.values(state.messages)) {
      for (const message of list) {
        const name = safeName(message.msgId)
        all.add(name)
        const ts = Number(message.ts)
        if (have.has(name) || this.mediaTried.has(message.msgId) || !(ts >= since)) continue
        const url = mediaUrlOf(message, stickers)
        if (url) wanted.push({ msgId: message.msgId, url, ts, voice: message.msgType === 'chat.voice' })
      }
    }
    const queue = wanted.sort((a, b) => b.ts - a.ts).slice(0, MEDIA_PER_PASS)
    const worker = async (): Promise<void> => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          const file = await this.download(job.url)
          if (!file || file.data.length > RELAY_MEDIA_MAX) throw new Error('not available')
          this.mediaTried.add(job.msgId)
          const type = imageTypeOf(file.data) ?? file.type.split(';')[0].trim().toLowerCase()
          // Zalo's file store labels voice notes (and some pictures) as plain bytes: those are told by the message kind.
          const plain = !type || type === 'application/octet-stream'
          if (!/^(image|audio|video)\//.test(type) && !(job.voice && plain)) continue
          const ext = extFor(type, job.url)
          await writeAtomic(join(mediaDir, `${safeName(job.msgId)}.${job.voice && ext === 'bin' ? 'm4a' : ext}`), encrypt(key, file.data))
        } catch (err) {
          const failures = (this.mediaFailures.get(job.msgId) ?? 0) + 1
          this.mediaFailures.set(job.msgId, failures)
          if (failures >= MEDIA_TRIES) this.mediaTried.add(job.msgId)
          this.log('zalo relay: media skipped', job.msgId, (err as Error).message)
        }
      }
    }
    await Promise.all(Array.from({ length: MEDIA_PARALLEL }, worker))
    // A copy goes only when its message is gone from the state AND it is older than the window: a short or empty snapshot deletes nothing.
    for (const name of names) {
      if (all.has(name.slice(0, name.lastIndexOf('.')))) continue
      const stat = await fs.stat(join(mediaDir, name)).catch(() => undefined)
      if (stat && this.now() - stat.mtimeMs > RELAY_DAYS * DAY_MS) await fs.rm(join(mediaDir, name), { force: true })
    }
  }

  private async pollAll(): Promise<void> {
    if (!this.enabled || !this.key) return
    for (const source of this.live()) {
      if (await this.refreshBlock(source.shareOwner)) continue
      try {
        await this.pollOwner(source)
      } catch (err) {
        this.fail((err as Error).message)
      }
    }
  }

  private parse(blob: Buffer): unknown {
    // Only what the key opens: a plain file could be written by anyone with access to the sync folder (forged sends). decrypt() throws on anything without the envelope.
    return JSON.parse(decrypt(this.key!, blob).toString('utf8'))
  }

  /**
   * Every answer given so far by any relay (acks/*.json merged), so a relay taking over knows what the old one did. A file
   * that cannot be read or understood stops the pass (throws) rather than counting as empty: items would be sent twice.
   */
  private async knownAcks(owner: string, dir: string): Promise<{ known: AckFile; own: AckFile }> {
    const ackDir = join(dir, 'acks')
    const mine = `${this.device().id}.json`
    let names: string[] = []
    try {
      names = (await fs.readdir(ackDir)).filter((n) => n.endsWith('.json'))
    } catch (err) {
      if (codeOf(err) !== 'ENOENT') throw new Error(`acks unreadable: ${(err as Error).message}`, { cause: err })
    }
    let merged: AckFile = {}
    let ownDisk: AckFile = {}
    for (const name of names) {
      let acks: AckFile
      try {
        const blob = await fs.readFile(join(ackDir, name))
        // Moshi only writes encrypted acks (atomically): a plain file is somebody else's and counts for nothing (and must not stall the pass).
        if (blob.subarray(0, 4).toString() !== 'MZS1') continue
        const parsed = this.parse(blob)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an ack file')
        acks = parsed as AckFile
      } catch (err) {
        if (codeOf(err) === 'ENOENT') continue
        throw new Error(`ack file ${name} unreadable: ${(err as Error).message}`, { cause: err })
      }
      merged = mergeAcks(merged, acks)
      if (name === mine) ownDisk = acks
    }
    const own = mergeAcks(ownDisk, this.ownAcks.get(owner) ?? {})
    this.ownAcks.set(owner, own)
    return { known: mergeAcks(merged, own), own }
  }

  private async pollOwner(source: RelaySource): Promise<void> {
    const key = this.key!
    const owner = source.shareOwner
    const dir = this.ownerDir(owner)!
    const outboxDir = join(dir, 'outbox')
    const names = (await fs.readdir(outboxDir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'))
    if (!names.length) return
    const { known, own } = await this.knownAcks(owner, dir)
    const ackPath = join(dir, 'acks', `${this.device().id}.json`)
    for (const name of names) {
      let items: unknown
      try {
        items = this.parse(await fs.readFile(join(outboxDir, name)))
      } catch {
        // Half-synced by the cloud client: tried again next pass.
        continue
      }
      if (!Array.isArray(items)) continue
      for (const item of pendingOutbox(items as OutboxItem[], known)) {
        if (this.taken.has(item.uuid)) continue
        this.taken.add(item.uuid)
        if (this.taken.size > TAKEN_KEEP) this.taken.delete(this.taken.values().next().value!)
        const ack = await this.carryOutTimed(source, outboxDir, item)
        own[item.uuid] = known[item.uuid] = ack
        this.processed++
        this.lastOutboxAt = this.now()
        for (const [uuid, old] of Object.entries(own)) if (this.now() - old.at > ACK_KEEP_MS) delete own[uuid]
        await fs.mkdir(join(dir, 'acks'), { recursive: true })
        await writeAtomic(ackPath, encrypt(key, Buffer.from(JSON.stringify(own))))
      }
    }
  }

  /** carryOut, but a send that hangs is answered with a timeout so the queue goes on. */
  private async carryOutTimed(source: RelaySource, outboxDir: string, item: OutboxItem): Promise<AckFile[string]> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<AckFile[string]>((done) => {
      timer = setTimeout(() => {
        this.fail(`${item.type} timed out`)
        done({ error: 'timeout', at: this.now() })
      }, this.sendTimeoutMs)
    })
    try {
      return await Promise.race([this.carryOut(source, outboxDir, item), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /** One queued item: send it or mark the chat read; the answer is what goes in the ack. */
  private async carryOut(source: RelaySource, outboxDir: string, item: OutboxItem): Promise<AckFile[string]> {
    const at = this.now()
    const temp: string[] = []
    try {
      if (!item.threadId) throw new Error('no chat')
      const id = conversationId(source.account.id, item.threadId)
      if (item.type === 'seen') {
        await source.markRead(id)
        return { at }
      }
      if (item.type !== 'message') throw new Error(`unknown item type ${String(item.type)}`)
      if (!Number.isFinite(item.at) || at - item.at > OUTBOX_EXPIRES_MS) throw new Error('expired')
      const attachments: OutgoingAttachment[] = []
      for (const a of item.attachments ?? []) {
        const path = await this.uploadFile(outboxDir, a.path, temp)
        attachments.push({ path, name: a.name || basename(a.path), mime: a.mime, size: (await fs.stat(path)).size })
      }
      const sent = await source.sendMessage(id, item.text ?? '', { replyToId: item.replyTo, attachments: attachments.length ? attachments : undefined })
      return { msgId: sent.id, at }
    } catch (err) {
      this.fail(`${item.type} failed: ${(err as Error).message}`)
      return { error: (err as Error).message, at }
    } finally {
      for (const f of temp) await fs.rm(f, { recursive: true, force: true }).catch(() => undefined)
      // The reader's upload is spent once answered (sent or not).
      for (const a of item.attachments ?? []) await fs.rm(join(outboxDir, 'files', basename(a.path)), { force: true }).catch(() => undefined)
    }
  }

  /** A reader's upload as a plain file Zalo can send (encrypted like everything else in the folder; a plain one is refused). */
  private async uploadFile(outboxDir: string, relative: string, temp: string[]): Promise<string> {
    const root = resolve(outboxDir, 'files')
    const path = resolve(root, relative)
    if (!path.startsWith(root + sep)) throw new Error('attachment outside the outbox')
    const blob = await fs.readFile(path)
    const folder = await fs.mkdtemp(join(tmpdir(), 'moshi-relay-'))
    temp.push(folder)
    const plain = join(folder, basename(path))
    await fs.writeFile(plain, decrypt(this.key!, blob))
    return plain
  }
}
