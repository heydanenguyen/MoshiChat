import { BrowserWindow, type Session, type WebContents } from 'electron'

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
/** Last ids seen on instagram.com (October 2026), used only when the page's module registry does not name them. */
const KNOWN_DOC_IDS: Record<string, string> = {
  IGDThreadDetailQuery: '29619996517588618',
  PolarisDirectInboxQuery: '27909866362025854',
  IGDThreadListOffMsysPaginationQuery: '28774058922187457'
}
/** Anything that looks typing-related; used to log key names (never values) once per shape. */
const DIAG_RE = /activity_indicator|typing_indicator|is_typing|"typing"|TypingIndicator/i
/** Nothing shorter can hold any of the markers above (`"typing"` is the shortest), even base64 encoded. */
const MIN_FRAME = 8
/**
 * Spellings the patterns above need, looked for inside base64 runs before decoding any. KIND_RE and TYPING_RE
 * are case sensitive; the case variants are only for the typing diagnostics, which ignore case.
 */
const ENCODED_MARKERS = ['SlideUQPP', 'activity_indicator', 'ACTIVITY_INDICATOR', 'typing', 'Typing', 'TYPING'].flatMap(base64Forms)
/**
 * Resource types the hidden inbox never needs: it is only there for its websocket and its tokens. Stylesheets still
 * load: they are small, and a page whose loader waited on CSS that never came would never start its realtime socket.
 */
const BLOCKED_TYPES: Array<'image' | 'media' | 'font'> = ['image', 'media', 'font']
/** Web contents ids whose heavy resources are refused, per session (Electron keeps one onBeforeRequest listener per session). */
const blockedBySession = new WeakMap<Session, Set<number>>()

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
    blockHeavyResources(win.webContents)
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
    // start() runs again after the window closes on its own, without stop(): never keep two reload timers.
    if (this.reloadTimer) clearInterval(this.reloadTimer)
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
    // The page reloads on a timer; caught mid-reload it has no tokens for a moment. The inbox and every chat come
    // through here now, so wait for it rather than fail.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.graphqlOnce(operation, variables)
      } catch (err) {
        const retryable = /no token|not running|Execution context|destroyed/i.test((err as Error).message)
        if (!retryable || attempt >= 3) throw err
        await new Promise((r) => setTimeout(r, 2_500))
      }
    }
  }

  private async graphqlOnce(operation: string, variables: Record<string, unknown>): Promise<unknown> {
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
        // Gatekeeper values a query declares (__relay_internal__pv__<Name>relayprovider): the page's own, as it sends them.
        for (const arg of need(req.operation + '.graphql')?.operation?.argumentDefinitions || []) {
          const gk = /^__relay_internal__pv__(.+)relayprovider$/.exec(arg.name);
          if (!gk || req.variables[arg.name] !== undefined) continue;
          try { req.variables[arg.name] = need(gk[1] + '.relayprovider')?.get?.() ?? null } catch (e) { req.variables[arg.name] = null }
        }
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

/**
 * Refuse images, media and fonts for one web contents. The partition is shared with the composer
 * and the web client, so the listener only cancels requests made by this web contents and lets the rest through.
 */
export function blockHeavyResources(contents: WebContents): void {
  const session = contents.session
  let ids = blockedBySession.get(session)
  if (!ids) {
    const blocked = new Set<number>()
    ids = blocked
    blockedBySession.set(session, blocked)
    // Installing a listener replaces any earlier one on this session; nothing else in the app sets one on it.
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'], types: BLOCKED_TYPES }, (details, callback) => {
      callback({ cancel: details.webContentsId !== undefined && blocked.has(details.webContentsId) })
    })
  }
  const id = contents.id
  const set = ids
  set.add(id)
  contents.once('destroyed', () => set.delete(id))
}

/**
 * Every way `marker` can show up inside a base64 run: one string per byte alignment, holding only the
 * characters the marker fully decides (the ones at its edges also depend on its neighbours).
 */
export function base64Forms(marker: string): string[] {
  const bytes = Buffer.from(marker, 'utf8')
  return [0, 1, 2].map((k) =>
    Buffer.concat([Buffer.alloc(k), bytes])
      .toString('base64')
      .slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6))
  )
}

/** Pull event names and typing updates out of one websocket frame (binary MQTT or text). */
export function scanFrame(frame: { opcode: number; payloadData: string }): FrameScan {
  // Pings and acks are a few bytes: too short to hold any marker, so skip them before decoding anything.
  if (frame.payloadData.length < MIN_FRAME) return { text: '', kinds: new Set(), typing: [] }
  const raw = (frame.opcode === 2 ? Buffer.from(frame.payloadData, 'base64').toString('latin1') : frame.payloadData).replace(/\\\//g, '/')
  // Realtime payloads are often base64 JSON nested inside the MQTT/thrift envelope. Decoding every long run is
  // the expensive part, so it only happens when a marker shows up in base64 form; without any marker, plain or
  // encoded, nothing below can match and the frame is done.
  const encoded = ENCODED_MARKERS.some((m) => raw.includes(m))
  if (!encoded && !raw.includes('SlideUQPP') && !raw.includes('activity_indicator') && !DIAG_RE.test(raw)) return { text: raw, kinds: new Set(), typing: [] }
  let text = raw
  if (encoded) for (const run of raw.matchAll(/[A-Za-z0-9+/]{60,}={0,2}/g)) text += '\n' + Buffer.from(run[0], 'base64').toString('utf8')

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

/**
 * Runs `run` at most once per `minGap` ms however often `trigger()` is called. A trigger inside the gap is not
 * dropped: it becomes one trailing run as soon as the gap is over, so the last event of a burst is always seen.
 * `delay` still coalesces the first burst (a message often arrives with a receipt and a reaction).
 */
export class RefreshThrottle {
  private timer?: NodeJS.Timeout
  private lastRun = -Infinity

  constructor(
    private readonly run: () => void,
    private readonly delay: number,
    private readonly minGap: number
  ) {}

  /** `urgent`: something the person is waiting to see (a new message): only the short coalescing delay, no gap. */
  trigger(urgent = false): void {
    const wait = urgent ? this.delay : Math.max(this.delay, this.lastRun + this.minGap - Date.now())
    if (this.timer) {
      // A gap-spaced run is already waiting: an urgent one moves it forward; otherwise it covers this trigger too.
      if (!urgent || this.due <= Date.now() + wait) return
      clearTimeout(this.timer)
    }
    this.due = Date.now() + wait
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.lastRun = Date.now()
      this.run()
    }, wait)
  }

  private due = 0

  cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
