import { BrowserWindow, session } from 'electron'
import type { WebCookie } from './adapters/facebook-personal'

/** The platform logged this session out or wants a security check. */
export class SessionExpiredError extends Error {
  constructor(public readonly reason: 'logged_out' | 'checkpoint') {
    super(reason === 'checkpoint' ? 'SESSION_CHECKPOINT' : 'SESSION_EXPIRED')
    this.name = 'SessionExpiredError'
  }
}

/**
 * Runs same-origin fetches inside a hidden window that shares the login
 * partition, so requests carry exactly the cookies, headers and TLS
 * fingerprint of the real website session the user created.
 */
export class WebClient {
  private window?: BrowserWindow
  private ready?: Promise<void>

  constructor(
    private readonly partition: string,
    private readonly origin: string,
    private readonly bootPath = '/robots.txt'
  ) {}

  /** Put stored cookies back into the partition (after a restart or on another machine profile). */
  async restoreCookies(cookies: WebCookie[]): Promise<void> {
    const ses = session.fromPartition(this.partition)
    const existing = await ses.cookies.get({ url: this.origin })
    const have = new Set(existing.map((c) => c.name))
    for (const c of cookies) {
      if (have.has(c.name)) continue
      try {
        await ses.cookies.set({
          url: this.origin,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path ?? '/',
          secure: true,
          expirationDate: c.expirationDate
        })
      } catch {
        /* cookie rejected (expired or host-only mismatch) */
      }
    }
  }

  async cookies(): Promise<WebCookie[]> {
    const list = await session.fromPartition(this.partition).cookies.get({ url: this.origin })
    return list.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expirationDate: c.expirationDate }))
  }

  private open(): Promise<void> {
    if (this.ready && this.window && !this.window.isDestroyed()) return this.ready
    this.window = new BrowserWindow({
      show: false,
      webPreferences: { partition: this.partition, contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    this.window.on('closed', () => {
      this.window = undefined
      this.ready = undefined
    })
    this.ready = this.window.loadURL(this.origin + this.bootPath).then(() => undefined)
    return this.ready
  }

  /**
   * JSON request relative to the origin. `form` sends x-www-form-urlencoded.
   * Throws with the server's message when the response is not ok.
   */
  async json<T>(path: string, options: { method?: 'GET' | 'POST'; form?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<T> {
    await this.open()
    const payload = JSON.stringify({ path, method: options.method ?? 'GET', form: options.form, headers: options.headers ?? {} })
    const script = `(async () => {
      const req = ${payload};
      const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '';
      const headers = Object.assign({ 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }, req.headers);
      let body;
      if (req.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(req.form).toString();
      }
      const res = await fetch(req.path, { method: req.method, headers, body, credentials: 'include' });
      const text = await res.text();
      return { status: res.status, text, url: res.url };
    })()`
    const result = (await this.window!.webContents.executeJavaScript(script, true)) as { status: number; text: string; url: string }
    if (/\/challenge\/|\/checkpoint\//.test(result.url)) throw new SessionExpiredError('checkpoint')
    if (/\/accounts\/login|\/login\.php/.test(result.url)) throw new SessionExpiredError('logged_out')
    let parsed: unknown
    try {
      parsed = JSON.parse(result.text)
    } catch {
      throw new Error(`HTTP ${result.status}: unexpected response`)
    }
    const obj = parsed as { status?: string; message?: string; error?: string }
    if (obj.message === 'login_required' || obj.message === 'checkpoint_required' || obj.message === 'challenge_required') {
      throw new SessionExpiredError(obj.message === 'login_required' ? 'logged_out' : 'checkpoint')
    }
    if (result.status >= 400 || obj.status === 'fail') {
      throw new Error(obj.message || obj.error || `HTTP ${result.status}`)
    }
    return parsed as T
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
    this.ready = undefined
  }
}
