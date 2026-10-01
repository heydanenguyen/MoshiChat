import { BrowserWindow } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import { SessionExpiredError } from './web-client'

const IDLE_CLOSE_MS = 3 * 60_000
/** Files handed over as a drop (when Instagram has no file input) are sent inline, so keep them modest. */
const DROP_MAX_BYTES = 25 * 1024 * 1024

/** Words Instagram uses for its Send button across common UI languages. */
const SEND_LABELS = [
  'Send',
  'Gửi',
  'Enviar',
  'Envoyer',
  'Senden',
  'Invia',
  'Verzenden',
  'Wyślij',
  'Отправить',
  '送信',
  '보내기',
  '发送',
  '發送',
  'ส่ง',
  'Kirim',
  'Gönder'
]

/** Instagram's "Add Photo or Video" button, by its icon label, across common UI languages. */
const MEDIA_LABEL = 'photo|video|image|media|gallery|ảnh|hình|foto|imagen|bild|图片|照片|写真|사진|рисун|фото'

/** Instagram's "Choose a GIF or sticker" button, by its icon label, across common UI languages. */
const TRAY_LABEL = 'gif|sticker|nhãn dán|autocollant|pegatina|aufkleber|adesivo|стикер|ステッカー|스티커|贴纸|貼圖'
/** The tray's Stickers tab, when it has one (GIFs and stickers side by side). */
const STICKER_TAB = '^(stickers?|nhãn dán|autocollants?|pegatinas?|aufkleber|adesivos?|стикеры|ステッカー|스티커|贴纸|貼圖)$'

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  webm: 'audio/webm'
}

type Logger = (...args: unknown[]) => void

/** Shared helpers for the page scripts (a string so it is inlined into each executeJavaScript call). */
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const findBox = () => document.querySelector('div[role="textbox"][contenteditable="true"]') || document.querySelector('div[contenteditable="true"][aria-label]') || document.querySelector('form textarea');
  const fileInput = () => document.querySelector('input[type="file"]');
  const labels = ${JSON.stringify(SEND_LABELS)};
  const sendButton = () => [...document.querySelectorAll('div[role="button"], button')].find((b) => labels.includes((b.textContent || '').trim()) || labels.includes(b.getAttribute('aria-label') || ''));
`

/**
 * Sends a direct message the way a person does on instagram.com: open the
 * thread in a hidden window, type into Instagram's own composer and press its
 * Send button. Instagram's client then talks to its servers itself, so the
 * request looks exactly like normal web usage (the legacy REST send endpoint
 * gets web sessions logged out).
 *
 * Set MOSHI_COMPOSER_DEBUG=1 to watch the hidden window (with DevTools) while
 * it works; every failure also logs a short description of the page it saw.
 */
export class DirectComposer {
  private window?: BrowserWindow
  private idle?: NodeJS.Timeout
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly partition: string,
    private readonly log: Logger = () => undefined
  ) {}

  /** Serialised so two sends never type into the same box at once. `threadUrls`: addresses to try, best first. */
  send(threadUrls: string | string[], text: string): Promise<void> {
    const run = this.queue.then(() => this.sendNow(threadUrls, text))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Photos, videos and audio through Instagram's own "Add Photo or Video" picker. */
  sendFiles(threadUrls: string | string[], paths: string[]): Promise<void> {
    const run = this.queue.then(() => this.sendFilesNow(threadUrls, paths))
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * A GIPHY sticker as a real Instagram sticker: open the thread's GIF and sticker tray, search it with each of
   * `queries` (then the tray's own picks) until the sticker with this GIPHY id shows up, and tap it, which sends it.
   */
  sendSticker(threadUrls: string | string[], sticker: { id: string; queries: string[] }): Promise<void> {
    const run = this.queue.then(() => this.sendStickerNow(threadUrls, sticker))
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * Show the thread and wait for its composer. Each candidate address gets a turn: Instagram changed
   * its thread ids, and an unknown id quietly lands on the inbox with nothing open (no text box).
   */
  private async open(threadUrls: string | string[]): Promise<BrowserWindow> {
    if (this.idle) clearTimeout(this.idle)
    const win = this.ensure()
    const candidates = Array.isArray(threadUrls) ? threadUrls : [threadUrls]
    const current = win.webContents.getURL()
    const already = candidates.find((u) => current.startsWith(u))
    const order = already ? [already, ...candidates.filter((u) => u !== already)] : candidates
    let lastReason = 'NO_TEXTBOX'
    for (const [i, candidate] of order.entries()) {
      // "new:<username>": start a conversation through Instagram's own New Message dialog.
      if (candidate.startsWith('new:')) {
        const state = await this.startConversation(win, candidate.slice(4))
        if (state === 'OK') return win
        if (state === 'LOGGED_OUT') throw new SessionExpiredError('logged_out')
        lastReason = state
        this.log(`[instagram composer] could not start a chat with ${candidate.slice(4)} (${state}):`, await this.describe(win))
        if (i < order.length - 1) await win.loadURL('about:blank')
        continue
      }
      const url = candidate
      if (!win.webContents.getURL().startsWith(url)) await win.loadURL(url)
      const landed = win.webContents.getURL()
      if (/\/challenge\/|\/checkpoint\//.test(landed)) throw new SessionExpiredError('checkpoint')
      if (/\/accounts\/login/.test(landed)) throw new SessionExpiredError('logged_out')
      const state = (await win.webContents.executeJavaScript(
        `(async () => {
          ${HELPERS}
          // A profile-style landing page (ig.me) shows a "Message" button instead of the composer: press it once.
          const messageButton = () => [...document.querySelectorAll('div[role="button"], button, a[role="link"]')].find((b) => /^(message|send message|nhắn tin|gửi tin nhắn|mensaje|enviar mensaje|nachricht)$/i.test((b.textContent || '').trim()));
          let pressed = false;
          for (let i = 0; i < ${i === order.length - 1 ? 80 : 40}; i++) {
            if (findBox()) return 'OK';
            if (!pressed && i >= 8) { const b = messageButton(); if (b) { pressed = true; b.click(); } }
            await wait(250);
          }
          return /accounts\\/login/.test(location.pathname) ? 'LOGGED_OUT' : 'NO_TEXTBOX';
        })()`,
        true
      )) as string
      if (state === 'OK') return win
      if (state === 'LOGGED_OUT') throw new SessionExpiredError('logged_out')
      lastReason = state
      this.log(`[instagram composer] no text box at ${url}:`, await this.describe(win))
      if (i < order.length - 1) await win.loadURL('about:blank')
    }
    throw new Error(
      lastReason === 'NO_TEXTBOX'
        ? 'Could not open the Instagram conversation to type in'
        : lastReason === 'NO_RECIPIENT'
          ? 'Instagram could not find this person in New Message'
          : `Instagram send failed (${lastReason})`
    )
  }

  /**
   * The way a person starts a chat on instagram.com: New Message → search the username → pick the
   * person → Chat. Ends on the thread with its composer ready.
   */
  private async startConversation(win: BrowserWindow, username: string): Promise<string> {
    await win.loadURL('https://www.instagram.com/direct/new/')
    const landed = win.webContents.getURL()
    if (/\/challenge\/|\/checkpoint\//.test(landed)) throw new SessionExpiredError('checkpoint')
    if (/\/accounts\/login/.test(landed)) throw new SessionExpiredError('logged_out')
    return (await win.webContents.executeJavaScript(
      `(async () => {
        ${HELPERS}
        const username = ${JSON.stringify(username)};
        const dialog = () => document.querySelector('div[role="dialog"]');
        const searchBox = () => document.querySelector('div[role="dialog"] input[name="queryBox"]') || document.querySelector('div[role="dialog"] input[type="text"]') || document.querySelector('input[name="queryBox"]');
        // The inbox opens the dialog itself on /direct/new/; if not, press the "New message" icon.
        let box = null;
        for (let i = 0; i < 40 && !box; i++) {
          box = searchBox();
          if (!box && i === 12) {
            const pen = [...document.querySelectorAll('svg[aria-label]')].find((s) => /new message|tin nhắn mới|nouveau message|nueva|neue nachricht/i.test(s.getAttribute('aria-label') || ''));
            if (pen) (pen.closest('[role="button"], button, a') || pen).click();
          }
          if (!box) await wait(250);
        }
        if (!box) return /accounts\\/login/.test(location.pathname) ? 'LOGGED_OUT' : 'NO_DIALOG';
        // React inputs only notice value changes made through the native setter.
        box.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, username);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        // Pick the result whose username matches exactly (the list also shows display names).
        let row = null;
        for (let i = 0; i < 40 && !row; i++) {
          const scope = dialog() || document;
          const spans = [...scope.querySelectorAll('span, div')].filter((el) => el.children.length === 0 && (el.textContent || '').trim().toLowerCase() === username.toLowerCase());
          row = spans.map((el) => el.closest('[role="button"], label, [role="checkbox"]') || el.parentElement)[0] || null;
          if (!row) await wait(250);
        }
        if (!row) return 'NO_RECIPIENT';
        row.click();
        await wait(300);
        // "Chat" becomes enabled once someone is picked.
        let go = null;
        for (let i = 0; i < 20 && !go; i++) {
          go = [...document.querySelectorAll('div[role="button"], button')].find((b) => /^(chat|next|nhắn tin|trò chuyện|tiếp|enviar|chatear|weiter)$/i.test((b.textContent || '').trim()) && b.getAttribute('aria-disabled') !== 'true' && !b.disabled);
          if (!go) await wait(200);
        }
        if (!go) return 'NO_CHAT_BUTTON';
        go.click();
        for (let i = 0; i < 60; i++) { if (findBox()) return 'OK'; await wait(250); }
        return 'NO_TEXTBOX';
      })()`,
      true
    )) as string
  }

  private async sendFilesNow(threadUrls: string | string[], paths: string[]): Promise<void> {
    const win = await this.open(threadUrls)

    // Wait for the composer, make sure nothing is left over in it, and find (or summon) the file input.
    const ready = (await win.webContents.executeJavaScript(
      `(async () => {
        ${HELPERS}
        let box = null;
        for (let i = 0; i < 80 && !box; i++) { box = findBox(); if (!box) await wait(250); }
        if (!box) return /accounts\\/login/.test(location.pathname) ? 'LOGGED_OUT' : 'NO_TEXTBOX';
        // Never let text from an earlier failed attempt ride along with the files.
        if ((box.textContent || '').trim()) { box.focus(); document.execCommand('selectAll'); document.execCommand('delete'); await wait(150); }
        if ((box.textContent || '').trim()) return 'DIRTY';
        for (let i = 0; i < 12 && !fileInput(); i++) await wait(250);
        if (fileInput()) return 'OK';
        // Some Instagram builds only mount the file input once the photo button is pressed. Pressing it
        // would also open the OS file dialog, so file inputs are stopped from doing that meanwhile.
        const proto = HTMLInputElement.prototype;
        const click = proto.click;
        const showPicker = proto.showPicker;
        proto.click = function () { if (this.type !== 'file') return click.call(this); };
        proto.showPicker = function () { if (this.type !== 'file') return showPicker.call(this); };
        try {
          const row = box.getBoundingClientRect();
          const label = new RegExp(${JSON.stringify(MEDIA_LABEL)}, 'i');
          const buttons = [...document.querySelectorAll('svg[aria-label], [role="button"][aria-label], button[aria-label]')]
            .filter((el) => label.test(el.getAttribute('aria-label') || ''))
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && Math.abs(r.top + r.height / 2 - (row.top + row.height / 2)) < 120; });
          for (const el of buttons) {
            (el.closest('[role="button"], button') || el).click();
            for (let i = 0; i < 12 && !fileInput(); i++) await wait(250);
            if (fileInput()) return 'OK';
          }
        } finally {
          proto.click = click;
          proto.showPicker = showPicker;
        }
        return 'NO_INPUT';
      })()`,
      true
    )) as string
    if (ready === 'LOGGED_OUT') throw new SessionExpiredError('logged_out')
    if (ready === 'DIRTY') throw new Error('Instagram’s message box is not empty; try again')
    if (ready !== 'OK' && ready !== 'NO_INPUT') {
      this.log('[instagram composer] no composer on the page:', await this.describe(win))
      throw new Error('Could not open the Instagram conversation to attach files')
    }

    let staged = ready === 'OK' && (await this.stageThroughInput(win, paths))
    if (!staged) {
      // No usable file input: hand the files over the way a drag-and-drop (or a paste) into the thread does.
      this.log('[instagram composer] no file input, dropping the files instead:', await this.describe(win))
      staged = await this.stageByDrop(win, paths)
    }
    if (!staged) {
      this.log('[instagram composer] files were not accepted:', await this.describe(win))
      throw new Error('Could not open Instagram’s photo picker')
    }

    // Newer Instagram stages the files and waits for Send; older builds send right away.
    const outcome = (await win.webContents.executeJavaScript(
      `(async () => {
        ${HELPERS}
        let button = null;
        for (let i = 0; i < 20 && !button; i++) { button = sendButton(); if (!button) await wait(200); }
        if (!button) return 'AUTO';
        button.click();
        // Uploads can take a while; the Send button disappears once the staged files are gone.
        for (let i = 0; i < 300; i++) { await wait(200); if (!sendButton()) return 'OK'; }
        return 'STUCK';
      })()`,
      true
    )) as string
    this.idle = setTimeout(() => this.close(), IDLE_CLOSE_MS)
    if (outcome === 'STUCK') throw new Error('Instagram is still uploading; check the conversation before sending again')
  }

  private async sendStickerNow(threadUrls: string | string[], sticker: { id: string; queries: string[] }): Promise<void> {
    const win = await this.open(threadUrls)
    const outcome = (await win.webContents.executeJavaScript(
      `(async () => {
        ${HELPERS}
        const id = ${JSON.stringify(sticker.id)};
        const queries = ${JSON.stringify([...sticker.queries, ''])};
        let box = null;
        for (let i = 0; i < 80 && !box; i++) { box = findBox(); if (!box) await wait(250); }
        if (!box) return /accounts\\/login/.test(location.pathname) ? 'LOGGED_OUT' : 'NO_TEXTBOX';
        // Pictures already on the page (the conversation itself) are never what gets tapped.
        const before = new Set(document.querySelectorAll('img, video'));
        const inputsBefore = new Set(document.querySelectorAll('input'));
        const row = box.getBoundingClientRect();
        const near = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && Math.abs(r.top + r.height / 2 - (row.top + row.height / 2)) < 120; };
        const trayLabel = new RegExp(${JSON.stringify(TRAY_LABEL)}, 'i');
        const opener = [...document.querySelectorAll('svg[aria-label], [role="button"][aria-label], button[aria-label]')].filter((el) => trayLabel.test(el.getAttribute('aria-label') || '')).find(near);
        if (!opener) return 'NO_TRAY_BUTTON';
        (opener.closest('[role="button"], button') || opener).click();
        let search = null;
        for (let i = 0; i < 40 && !search; i++) {
          search = [...document.querySelectorAll('input')].find((el) => !inputsBefore.has(el) && el.type !== 'file' && el.getBoundingClientRect().width > 0);
          if (!search) await wait(200);
        }
        if (!search) return 'NO_TRAY';
        const fresh = () => [...document.querySelectorAll('img, video')].filter((el) => !before.has(el));
        const tab = [...document.querySelectorAll('[role="tab"], [role="button"], button')].find((el) => new RegExp(${JSON.stringify(STICKER_TAB)}, 'i').test((el.textContent || '').trim()) && el.getBoundingClientRect().width > 0);
        if (tab) { tab.click(); await wait(500); }
        const srcOf = (el) => [el.currentSrc, el.src, el.getAttribute('srcset'), el.poster, ...[...el.querySelectorAll('source')].map((s) => s.src || s.srcset)].filter(Boolean).join(' ');
        const hit = () => fresh().find((el) => srcOf(el).includes('/' + id + '/'));
        const setQuery = (q) => {
          search.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, q);
          search.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const scroller = () => {
          let el = fresh()[0];
          while (el && el !== document.body) { if (el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el; el = el.parentElement; }
          return null;
        };
        let found = null;
        for (const q of queries) {
          setQuery(q);
          await wait(900);
          for (let i = 0; i < 40 && !found; i++) {
            found = hit();
            if (found) break;
            // Look further down the results now and then (they load as the tray scrolls).
            if (i % 8 === 7) { const s = scroller(); if (s) s.scrollTop += s.clientHeight; }
            await wait(200);
          }
          if (found) break;
        }
        if (!found) {
          const seen = fresh().slice(0, 4).map((el) => { try { const u = new URL(srcOf(el).split(' ')[0]); return u.hostname + u.pathname.slice(0, 40); } catch { return '?'; } });
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return 'NOT_FOUND ' + JSON.stringify({ shown: fresh().length, tab: !!tab, seen });
        }
        found.scrollIntoView({ block: 'center' });
        (found.closest('[role="button"], button') || found).click();
        // Tapping a sticker sends it and closes the tray.
        for (let i = 0; i < 25; i++) { await wait(200); if (!search.isConnected || search.getBoundingClientRect().width === 0) return 'OK'; }
        const button = sendButton();
        if (button) { button.click(); await wait(800); return 'OK_SEND'; }
        return 'TRAY_OPEN';
      })()`,
      true
    )) as string
    this.idle = setTimeout(() => this.close(), IDLE_CLOSE_MS)
    this.log('[instagram composer] sticker', sticker.id, outcome)
    if (outcome === 'OK' || outcome === 'OK_SEND' || outcome === 'TRAY_OPEN') return
    if (outcome === 'LOGGED_OUT') throw new SessionExpiredError('logged_out')
    this.log('[instagram composer] sticker tray:', await this.describe(win))
    throw new Error(
      outcome.startsWith('NOT_FOUND')
        ? 'This sticker did not show up in Instagram’s sticker search'
        : outcome === 'NO_TRAY_BUTTON' || outcome === 'NO_TRAY'
          ? 'Could not open Instagram’s GIF and sticker tray'
          : `Instagram sticker send failed (${outcome})`
    )
  }

  /** Hand the files to Instagram's hidden <input type=file>, exactly as the OS file dialog would. */
  private async stageThroughInput(win: BrowserWindow, paths: string[]): Promise<boolean> {
    const dbg = win.webContents.debugger
    try {
      if (!dbg.isAttached()) dbg.attach('1.3')
      const { result } = (await dbg.sendCommand('Runtime.evaluate', {
        expression: `[...document.querySelectorAll('input[type="file"]')].find((i) => /image|audio|video|\\.mp4|\\.jpg/.test(i.accept)) || document.querySelector('input[type="file"]')`
      })) as { result: { objectId?: string } }
      if (!result.objectId) return false
      await dbg.sendCommand('DOM.setFileInputFiles', { files: paths, objectId: result.objectId })
      return true
    } catch (err) {
      this.log('[instagram composer] file input failed:', (err as Error).message)
      return false
    } finally {
      if (dbg.isAttached()) dbg.detach()
    }
  }

  /** Build the files in the page and drop them on the composer (then paste them, if the drop did nothing). */
  private async stageByDrop(win: BrowserWindow, paths: string[]): Promise<boolean> {
    const payload: Array<{ name: string; mime: string; data: string }> = []
    let total = 0
    for (const path of paths) {
      total += (await stat(path)).size
      if (total > DROP_MAX_BYTES) throw new Error('These files are too large to send to Instagram from here; try a smaller photo or video')
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      payload.push({ name: basename(path), mime: MIME_BY_EXT[ext] ?? 'application/octet-stream', data: (await readFile(path)).toString('base64') })
    }
    const outcome = (await win.webContents.executeJavaScript(
      `(async () => {
        ${HELPERS}
        const box = findBox();
        if (!box) return 'NO_TEXTBOX';
        const files = ${JSON.stringify(payload)}.map((f) => new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.mime }));
        const previews = () => document.querySelectorAll('img[src^="blob:"], video[src^="blob:"]').length;
        const before = previews();
        const staged = () => previews() > before || !!sendButton();
        const transfer = new DataTransfer();
        for (const f of files) transfer.items.add(f);
        const target = box.closest('form') || box.parentElement || box;
        for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
        for (let i = 0; i < 20 && !staged(); i++) await wait(250);
        if (staged()) return 'OK';
        box.focus();
        box.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
        for (let i = 0; i < 20 && !staged(); i++) await wait(250);
        return staged() ? 'OK' : 'NOT_STAGED';
      })()`,
      true
    )) as string
    return outcome === 'OK'
  }

  /** A short account of what the hidden page looks like, for the log when something is not found. */
  private async describe(win: BrowserWindow): Promise<string> {
    try {
      return (await win.webContents.executeJavaScript(
        `JSON.stringify({
          url: location.href,
          title: document.title,
          visibility: document.visibilityState,
          textbox: !!document.querySelector('div[role="textbox"][contenteditable="true"]'),
          fileInputs: [...document.querySelectorAll('input[type="file"]')].map((i) => i.accept || '*'),
          iconLabels: [...document.querySelectorAll('svg[aria-label]')].map((s) => s.getAttribute('aria-label')).filter(Boolean).slice(-16),
          buttons: [...document.querySelectorAll('div[role="button"], button')].length
        })`,
        false
      )) as string
    } catch (err) {
      return `unavailable (${(err as Error).message})`
    }
  }

  private ensure(): BrowserWindow {
    if (!this.window || this.window.isDestroyed()) {
      const debug = process.env.MOSHI_COMPOSER_DEBUG === '1'
      this.window = new BrowserWindow({
        show: debug,
        width: 1280,
        height: 880,
        webPreferences: {
          partition: this.partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false
        }
      })
      this.window.webContents.setAudioMuted(true)
      if (debug) this.window.webContents.openDevTools({ mode: 'detach' })
    }
    return this.window
  }

  private async sendNow(threadUrls: string | string[], text: string): Promise<void> {
    const win = await this.open(threadUrls)

    const outcome = (await win.webContents.executeJavaScript(
      `(async () => {
        ${HELPERS}
        const text = ${JSON.stringify(text)};
        let box = null;
        for (let i = 0; i < 80 && !box; i++) { box = findBox(); if (!box) await wait(250); }
        if (!box) return /accounts\\/login/.test(location.pathname) ? 'LOGGED_OUT' : 'NO_TEXTBOX';
        box.focus();
        document.execCommand('insertText', false, text);
        await wait(200);
        const probe = text.replace(/\\s+/g, ' ').trim().slice(0, 24);
        if (!(box.textContent || '').replace(/\\s+/g, ' ').includes(probe)) return 'INSERT_FAILED';
        let button = null;
        for (let i = 0; i < 20 && !button; i++) { button = sendButton(); if (!button) await wait(150); }
        if (!button) return 'NO_BUTTON';
        button.click();
        for (let i = 0; i < 60; i++) {
          await wait(150);
          const now = findBox();
          if (now && !(now.textContent || '').trim()) return 'OK';
        }
        return 'NOT_CLEARED';
      })()`,
      true
    )) as string

    this.idle = setTimeout(() => this.close(), IDLE_CLOSE_MS)
    if (outcome === 'OK') return
    if (outcome === 'LOGGED_OUT') throw new SessionExpiredError('logged_out')
    this.log(`[instagram composer] text send failed (${outcome}):`, await this.describe(win))
    const reasons: Record<string, string> = {
      NO_TEXTBOX: 'Could not open the Instagram conversation to type in',
      INSERT_FAILED: 'Instagram did not accept the typed text',
      NO_BUTTON: 'Could not find Instagram’s Send button',
      NOT_CLEARED: 'Instagram did not confirm the message was sent'
    }
    throw new Error(reasons[outcome] ?? `Instagram send failed (${outcome})`)
  }

  close(): void {
    if (this.idle) clearTimeout(this.idle)
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
  }
}
