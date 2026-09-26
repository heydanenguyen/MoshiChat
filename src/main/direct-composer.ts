import { BrowserWindow } from 'electron'
import { SessionExpiredError } from './web-client'

const IDLE_CLOSE_MS = 3 * 60_000

/** Words Instagram uses for its Send button across common UI languages. */
const SEND_LABELS = ['Send', 'Gửi', 'Enviar', 'Envoyer', 'Senden', 'Invia', 'Verzenden', 'Wyślij', 'Отправить', '送信', '보내기', '发送', '發送', 'ส่ง', 'Kirim', 'Gönder']

/**
 * Sends a direct message the way a person does on instagram.com: open the
 * thread in a hidden window, type into Instagram's own composer and press its
 * Send button. Instagram's client then talks to its servers itself, so the
 * request looks exactly like normal web usage (the legacy REST send endpoint
 * gets web sessions logged out).
 */
export class DirectComposer {
  private window?: BrowserWindow
  private idle?: NodeJS.Timeout
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly partition: string) {}

  /** Serialised so two sends never type into the same box at once. */
  send(threadUrl: string, text: string): Promise<void> {
    const run = this.queue.then(() => this.sendNow(threadUrl, text))
    this.queue = run.catch(() => undefined)
    return run
  }

  private ensure(): BrowserWindow {
    if (!this.window || this.window.isDestroyed()) {
      this.window = new BrowserWindow({
        show: false,
        width: 1280,
        height: 880,
        webPreferences: { partition: this.partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
      })
      this.window.webContents.setAudioMuted(true)
    }
    return this.window
  }

  private async sendNow(threadUrl: string, text: string): Promise<void> {
    if (this.idle) clearTimeout(this.idle)
    const win = this.ensure()
    const current = win.webContents.getURL()
    if (!current.startsWith(threadUrl)) {
      await win.loadURL(threadUrl)
    }
    const url = win.webContents.getURL()
    if (/\/challenge\/|\/checkpoint\//.test(url)) throw new SessionExpiredError('checkpoint')
    if (/\/accounts\/login/.test(url)) throw new SessionExpiredError('logged_out')

    const outcome = (await win.webContents.executeJavaScript(
      `(async () => {
        const text = ${JSON.stringify(text)};
        const labels = ${JSON.stringify(SEND_LABELS)};
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const findBox = () => document.querySelector('div[role="textbox"][contenteditable="true"]');
        let box = null;
        for (let i = 0; i < 80 && !box; i++) { box = findBox(); if (!box) await wait(250); }
        if (!box) return /accounts\\/login/.test(location.pathname) ? 'LOGGED_OUT' : 'NO_TEXTBOX';
        box.focus();
        document.execCommand('insertText', false, text);
        await wait(200);
        const probe = text.replace(/\\s+/g, ' ').trim().slice(0, 24);
        if (!(box.textContent || '').replace(/\\s+/g, ' ').includes(probe)) return 'INSERT_FAILED';
        let button = null;
        for (let i = 0; i < 20 && !button; i++) {
          button = [...document.querySelectorAll('div[role="button"], button')].find((b) => labels.includes((b.textContent || '').trim()) || labels.includes(b.getAttribute('aria-label') || ''));
          if (!button) await wait(150);
        }
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
