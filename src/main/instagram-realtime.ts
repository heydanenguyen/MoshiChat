import { BrowserWindow } from 'electron'

export type RealtimeKind = 'NewMessage' | 'NewRavenMessage' | 'ReadReceipt' | 'CreateReaction' | 'DeleteReaction' | 'DeleteMessage' | 'EditMessage' | 'MarkRead' | 'AdminTextMessage'

export interface RealtimeHandlers {
  /** Something changed in the inbox (new message, receipt, reaction, edit…). */
  onActivity(kinds: Set<RealtimeKind>): void
  /** Someone started or stopped typing in a thread (REST thread id). */
  onTyping(threadId: string, senderId: string, typing: boolean): void
  onSessionLost(): void
  log(...args: unknown[]): void
}

const KIND_RE = /SlideUQPP(NewMessage|NewRavenMessage|ReadReceipt|CreateReaction|DeleteReaction|DeleteMessage|EditMessage|MarkRead|AdminTextMessage)\b/g
const TYPING_RE = /\/direct_v2\/threads\/(\d+)\/activity_indicator_id[^"]*"[\s\S]{0,60}?"value"\s*:\s*"((?:[^"\\]|\\.)*)"/g
const RELOAD_EVERY = 30 * 60_000
/** Last seen persisted query ids, used when the module registry lookup fails. */
const KNOWN_DOC_IDS: Record<string, string> = { IGDThreadDetailQuery: '28288012930891325' }
/** Anything that looks typing-related; used to log key names (never values) once per shape. */
const DIAG_RE = /activity_indicator|typing_indicator|is_typing|"typing"|TypingIndicator/i

/**
 * Keeps instagram.com/direct/inbox open in a hidden window of the user's
 * session and listens to the realtime websocket frames Instagram's own web
 * client receives (through the DevTools protocol). We never parse message
 * contents from the socket: events only tell us *when* to refresh and who is
 * typing; the data itself still comes from the regular web endpoints.
 */
export class InstagramRealtime {
  private window?: BrowserWindow
  private reloadTimer?: NodeJS.Timeout
  private seenKinds = new Set<string>()
  private stopped = true

  constructor(
    private readonly partition: string,
    private readonly handlers: RealtimeHandlers
  ) {}

  start(): void {
    this.stopped = false
    if (this.window && !this.window.isDestroyed()) return
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 820,
      webPreferences: { partition: this.partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    })
    win.webContents.setAudioMuted(true)
    this.window = win
    const dbg = win.webContents.debugger
    try {
      dbg.attach('1.3')
    } catch (err) {
      this.handlers.log('instagram realtime: debugger attach failed', (err as Error).message)
    }
    dbg.on('message', (_event, method, params) => {
      if (method === 'Network.webSocketFrameReceived') this.onFrame(params.response as { opcode: number; payloadData: string })
    })
    void dbg.sendCommand('Network.enable').catch(() => undefined)
    win.webContents.on('did-navigate', (_e, url) => {
      if (/\/accounts\/login|\/challenge\//.test(url)) this.handlers.onSessionLost()
    })
    win.webContents.on('render-process-gone', () => this.restart())
    win.on('closed', () => {
      this.window = undefined
      if (!this.stopped) setTimeout(() => this.start(), 5000)
    })
    void win.loadURL('https://www.instagram.com/direct/inbox/').catch(() => undefined)
    this.reloadTimer = setInterval(() => {
      if (this.window && !this.window.isDestroyed()) this.window.webContents.reload()
    }, RELOAD_EVERY)
  }

  stop(): void {
    this.stopped = true
    if (this.reloadTimer) clearInterval(this.reloadTimer)
    this.reloadTimer = undefined
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
  }

  /**
   * Run one of the web client's own GraphQL queries inside the inbox window, with its tokens.
   * The persisted query id is read from Instagram's module registry (it changes on deploys),
   * falling back to the last id we saw.
   */
  async graphql(operation: string, variables: Record<string, unknown>): Promise<unknown> {
    const win = this.window
    if (!win || win.isDestroyed()) throw new Error('Instagram web client is not running')
    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20_000)
        win.webContents.once('did-finish-load', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    const payload = JSON.stringify({ operation, variables, fallback: KNOWN_DOC_IDS[operation] ?? '' })
    const result = (await win.webContents.executeJavaScript(
      `(async () => {
        const req = ${payload};
        const need = (name) => { try { return window.require(name) } catch (e) { return undefined } };
        for (let i = 0; i < 40 && !need('DTSGInitialData'); i++) await new Promise((r) => setTimeout(r, 250));
        const dtsg = need('DTSGInitialData')?.token;
        const lsd = need('LSD')?.token ?? '';
        if (!dtsg) return { error: 'no token' };
        const docId = need(req.operation + '_instagramRelayOperation') || req.fallback;
        if (!docId) return { error: 'unknown query' };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);
        try {
          const body = new URLSearchParams({ fb_dtsg: dtsg, lsd, fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: req.operation, server_timestamps: 'true', variables: JSON.stringify(req.variables), doc_id: docId });
          const res = await fetch('/api/graphql', { method: 'POST', credentials: 'include', signal: controller.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-FB-LSD': lsd, 'X-IG-App-ID': '936619743392459', 'X-FB-Friendly-Name': req.operation }, body });
          const text = await res.text();
          return { status: res.status, text: text.split('\\n')[0], docId };
        } catch (e) {
          return { error: String(e) };
        } finally {
          clearTimeout(timer);
        }
      })()`,
      true
    )) as { status?: number; text?: string; error?: string; docId?: string }
    if (result.error) throw new Error(`Instagram ${operation}: ${result.error}`)
    if (result.docId && result.docId !== KNOWN_DOC_IDS[operation] && !this.seenKinds.has('doc:' + operation)) {
      this.seenKinds.add('doc:' + operation)
      this.handlers.log(`instagram realtime: ${operation} uses doc ${result.docId}`)
    }
    const parsed = JSON.parse(result.text ?? '{}') as { errors?: Array<{ message?: string }> }
    if (parsed.errors?.length && !(parsed as { data?: unknown }).data) throw new Error(`Instagram ${operation}: ${parsed.errors[0].message ?? 'error'}`)
    return parsed
  }

  private restart(): void {
    if (this.stopped) return
    this.stop()
    this.stopped = false
    setTimeout(() => this.start(), 3000)
  }

  private diagnose(text: string): void {
    const i = text.search(DIAG_RE)
    const window = text.slice(Math.max(0, i - 300), i + 300)
    // Keep only identifiers and punctuation so no message content or ids end up in logs.
    const shape = window
      .replace(/"(?:[^"\\]|\\.)*"(?!\s*:)/g, '"…"')
      .replace(/\d{3,}/g, '#')
      .replace(/[^\x20-\x7e]/g, '')
    const key = shape.replace(/"…"|#/g, '').slice(0, 120)
    if (this.seenKinds.has('diag:' + key)) return
    this.seenKinds.add('diag:' + key)
    this.handlers.log('instagram realtime: typing-like frame', shape)
  }

  private onFrame(frame: { opcode: number; payloadData: string }): void {
    const { text, kinds, typing } = scanFrame(frame)
    if (kinds.size) {
      for (const k of kinds) {
        if (!this.seenKinds.has(k)) {
          this.seenKinds.add(k)
          this.handlers.log('instagram realtime: first', k, 'event')
        }
      }
      this.handlers.onActivity(kinds)
    }
    if (DIAG_RE.test(text)) this.diagnose(text)
    for (const t of typing) {
      if (!this.seenKinds.has('typing')) {
        this.seenKinds.add('typing')
        this.handlers.log('instagram realtime: first typing event')
      }
      this.handlers.onTyping(t.threadId, t.senderId, t.typing)
    }
  }
}

export interface FrameScan {
  text: string
  kinds: Set<RealtimeKind>
  typing: { threadId: string; senderId: string; typing: boolean }[]
}

/** Pull event names and typing updates out of one websocket frame (binary MQTT or text). */
export function scanFrame(frame: { opcode: number; payloadData: string }): FrameScan {
  const raw = (frame.opcode === 2 ? Buffer.from(frame.payloadData, 'base64').toString('latin1') : frame.payloadData).replace(/\\\//g, '/')
  // Realtime payloads are often base64 JSON nested inside the MQTT/thrift envelope.
  let text = raw
  for (const run of raw.matchAll(/[A-Za-z0-9+/]{60,}={0,2}/g)) text += '\n' + Buffer.from(run[0], 'base64').toString('utf8')

  const kinds = new Set<RealtimeKind>()
  for (const m of text.matchAll(KIND_RE)) kinds.add(m[1] as RealtimeKind)

  const typing: FrameScan['typing'] = []
  for (const m of text.matchAll(TYPING_RE)) {
    try {
      const value = JSON.parse(JSON.parse('"' + m[2] + '"')) as { sender_id?: string | number; activity_status?: number }
      if (value.sender_id === undefined) continue
      typing.push({ threadId: m[1], senderId: String(value.sender_id), typing: value.activity_status === 1 })
    } catch {
      /* unexpected shape */
    }
  }
  return { text, kinds, typing }
}
