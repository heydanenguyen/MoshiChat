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

/**
 * Which of my messages to take back, and how to recognise it on instagram.com (the page shows no item ids):
 * by id when Instagram's own page data carries it, else by its exact text, else (media) only when it is the
 * newest message of the chat. Anything less certain is refused rather than risk unsending the wrong message.
 */
export interface UnsendTarget {
  /** Ids the page may hold for it: the direct_v2 item id and the newer Slide message id (mid.$…). */
  ids: string[]
  /** Its text, for text messages. */
  text?: string
  /** How many of my later messages carry exactly the same text (0: this is the newest with that text). */
  sameTextAfter: number
  /** Whether it is the newest message in the chat (from anyone). */
  newest: boolean
}

/** Instagram's "More" button beside a hovered message, by its label, across common UI languages. */
const MORE_LABEL = '^(more|more options|more actions|see more|xem thêm|thêm|khác|tùy chọn khác|más|más opciones|plus|plus d.options|mehr|weitere optionen|altro|mais|mais opções|ещё|еще|その他|더 보기|更多|เพิ่มเติม|lainnya|diğer)$'
/** Its "Unsend" menu item and confirm button. "Delete" (for me only) is never matched. */
const UNSEND_LABEL = '^(unsend|thu hồi|anular envío|anular el envío|annuler l.envoi|senden rückgängig machen|zurückziehen|annulla invio|cancelar envio|anular envio|отменить отправку|送信を取り消す|전송 취소|取消发送|取消傳送|撤回|ยกเลิกการส่ง|batalkan pengiriman|batal kirim|göndermeyi geri al)'
/** What a row says once its message is gone. */
const UNSENT_TEXT = 'unsent|thu hồi|anulaste|annulé|zurückgezogen|annullato|cancelou|отменил|取り消|취소|撤回|ยกเลิก|membatalkan|geri aldı'

/** Shared helpers for the page scripts (a string so it is inlined into each executeJavaScript call). */
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const findBox = () => document.querySelector('div[role="textbox"][contenteditable="true"]') || document.querySelector('div[contenteditable="true"][aria-label]') || document.querySelector('form textarea');
  const fileInput = () => document.querySelector('input[type="file"]');
  const labels = ${JSON.stringify(SEND_LABELS)};
  const sendButton = () => [...document.querySelectorAll('div[role="button"], button')].find((b) => labels.includes((b.textContent || '').trim()) || labels.includes(b.getAttribute('aria-label') || ''));
`

/**
 * Page scripts for unsend. Messages are the thread's rows; mine are the ones on the right. The chosen row is
 * marked data-moshi-unsend so each step works on the same one, and every step that clicks returns the point to
 * click so the main process can press it with a real pointer (the page's own events are the fallback).
 */
const UNSEND_HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const MORE = new RegExp(${JSON.stringify(MORE_LABEL)}, 'i');
  const UNSEND = new RegExp(${JSON.stringify(UNSEND_LABEL)}, 'i');
  const UNSENT = new RegExp(${JSON.stringify(UNSENT_TEXT)}, 'i');
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const thread = () => document.querySelector('[role="grid"]') || document.querySelector('main') || document.body;
  const rows = () => [...thread().querySelectorAll('[role="row"]')].filter((r) => visible(r) && !r.querySelector('[role="row"]'));
  // Mine sit on the right: the row's content (not the row itself, which spans the width) leans right.
  const contentBox = (row) => {
    let left = Infinity, right = -Infinity;
    for (const el of row.querySelectorAll('div[dir="auto"], span[dir="auto"], img, video, [role="img"]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      left = Math.min(left, r.left); right = Math.max(right, r.right);
    }
    return left === Infinity ? null : { left, right };
  };
  const mine = (row) => {
    const box = contentBox(row), r = row.getBoundingClientRect();
    return !!box && box.left - r.left > r.right - box.right;
  };
  const hasMedia = (row) => [...row.querySelectorAll('img, video')].some((m) => { const r = m.getBoundingClientRect(); return r.width >= 60 && r.height >= 60; });
  const hasText = (row, text) => [...row.querySelectorAll('div[dir="auto"], span[dir="auto"]')].some((el) => norm(el.textContent) === text);
  // React keeps each message's data on its components; look for the item's ids between the row and its parts.
  const fiberOf = (el) => { const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const holds = (value, ids, depth, seen) => {
    if (value == null || depth > 4) return false;
    if (typeof value === 'string') return ids.includes(value);
    if (typeof value !== 'object' || seen.has(value) || value.$$typeof || value instanceof Node) return false;
    seen.add(value);
    let n = 0;
    for (const key in value) {
      if (++n > 80) break;
      try { if (holds(value[key], ids, depth + 1, seen)) return true; } catch {}
    }
    return false;
  };
  const rowHolds = (row, ids, all) => {
    const seen = new Set();
    const checked = new Set();
    const others = all.filter((r) => r !== row);
    const up = (fiber, stop) => {
      for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
        if (fiber === stop || checked.has(fiber)) return false;
        checked.add(fiber);
        const node = fiber.stateNode;
        // Past the row into something that also holds other messages: that is the list, not this message.
        if (node instanceof Element && node !== row && node.contains(row) && others.some((o) => node.contains(o))) return false;
        if (holds(fiber.memoizedProps, ids, 0, seen)) return true;
      }
      return false;
    };
    const own = fiberOf(row);
    if (up(own, null)) return true;
    for (const el of [...row.querySelectorAll('*')].slice(0, 300)) if (up(fiberOf(el), own)) return true;
    return false;
  };
  const mark = (row, how) => {
    document.querySelectorAll('[data-moshi-unsend]').forEach((el) => el.removeAttribute('data-moshi-unsend'));
    row.setAttribute('data-moshi-unsend', how);
    row.scrollIntoView({ block: 'center' });
    const box = contentBox(row) || row.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    window.__moshiHow = how;
    window.__moshiText = norm(row.textContent);
    return { state: 'OK', how, x: Math.max(r.left + 4, (box.left + box.right) / 2), y: r.top + r.height / 2 };
  };
  // What identifies the chosen row once Instagram re-renders it: how many rows still match.
  const matches = (target, how) => {
    const all = rows();
    if (how === 'id') return all.filter((r) => rowHolds(r, target.ids.filter((id) => id && id.length >= 10), all)).length;
    if (how === 'text') return all.filter((r) => mine(r) && hasText(r, norm(target.text))).length;
    return all.filter((r) => mine(r) && !UNSENT.test(norm(r.textContent))).length;
  };
  const find = (target) => {
    window.__moshiTarget = target;
    const all = rows();
    if (!all.length) return { state: 'NOT_FOUND' };
    const ids = target.ids.filter((id) => id && id.length >= 10);
    if (ids.length) {
      const byId = all.filter((r) => rowHolds(r, ids, all));
      if (byId.length === 1) { window.__moshiBefore = 1; return mark(byId[0], 'id'); }
    }
    const text = norm(target.text);
    if (text) {
      const same = all.filter((r) => mine(r) && hasText(r, text));
      if (same.length <= target.sameTextAfter) return { state: 'NOT_FOUND' };
      window.__moshiBefore = same.length;
      return mark(same[same.length - 1 - target.sameTextAfter], 'text');
    }
    // A photo, sticker or video: only when it is the newest message of the chat, and the page's newest is mine and media.
    if (!target.newest) return { state: 'UNSURE' };
    const last = all.filter((r) => contentBox(r)).at(-1);
    if (!last || !mine(last) || !hasMedia(last)) return { state: 'NOT_FOUND' };
    window.__moshiBefore = matches(target, 'newest');
    return mark(last, 'newest');
  };
  const target = () => document.querySelector('[data-moshi-unsend]');
  const poke = (el) => {
    const { x, y } = center(el);
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'])
      el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: !type.endsWith('enter'), clientX: x, clientY: y }));
  };
  const press = (el) => {
    if (!el) return;
    const { x, y } = center(el);
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'])
      el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    el.click();
  };
  const labelled = (scope) => [...scope.querySelectorAll('svg[aria-label], [role="button"][aria-label], button[aria-label]')]
    .filter((el) => MORE.test(norm(el.getAttribute('aria-label'))) && visible(el));
  // The More button of the chosen row: inside it, or floating level with it (Instagram may portal the toolbar).
  const moreButton = async () => {
    for (let i = 0; i < 20; i++) {
      const row = target();
      if (!row) return { state: 'LOST' };
      const r = row.getBoundingClientRect();
      const inside = labelled(row);
      const level = inside.length ? inside : labelled(document).filter((el) => { const c = center(el); return c.y >= r.top - 4 && c.y <= r.bottom + 4 && !el.closest('[role="row"]:not([data-moshi-unsend])'); });
      if (level.length) {
        const button = level[0].closest('[role="button"], button') || level[0];
        button.setAttribute('data-moshi-more', '1');
        return { state: 'OK', ...center(button) };
      }
      const box = row.querySelector('div[dir="auto"], img, video') || row;
      poke(box);
      await wait(150);
    }
    return { state: 'NO_MORE' };
  };
  const menus = () => [...document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"]')].filter(visible);
  const unsendItem = () => {
    for (const menu of menus()) {
      const items = [...menu.querySelectorAll('[role="menuitem"], [role="button"], button, [role="option"]')].filter(visible);
      const hit = items.find((el) => UNSEND.test(norm(el.textContent)) || UNSEND.test(norm(el.getAttribute('aria-label'))));
      if (hit) return hit;
    }
    return null;
  };
  const menuItem = async () => {
    for (let i = 0; i < 15; i++) {
      const hit = unsendItem();
      if (hit) { window.__moshiItem = hit; return { state: 'OK', ...center(hit) }; }
      if (menus().length && i >= 6) return { state: 'NO_UNSEND' };
      await wait(150);
    }
    return { state: 'NO_MENU' };
  };
  // After the pointer pressed Unsend in the menu: press Instagram's confirm button (a new Unsend button, never the
  // menu item again), or the menu item itself if the pointer's press did nothing; then wait for the message to go.
  const confirmAndWait = async () => {
    const before = window.__moshiBefore;
    const how = window.__moshiHow;
    const t = window.__moshiTarget;
    const item = window.__moshiItem;
    const pressed = new Set([item]);
    for (let i = 0; i < 60; i++) {
      await wait(150);
      const dialog = [...document.querySelectorAll('[role="dialog"]')].filter(visible).at(-1);
      const button = dialog && [...dialog.querySelectorAll('[role="button"], button')].filter(visible).find((el) => UNSEND.test(norm(el.textContent)));
      if (button && !pressed.has(button)) { pressed.add(button); press(button); continue; }
      if (i === 6 && item && item.isConnected && visible(item)) press(item);
      // Gone from the page, or turned into an "unsent" line (not merely a message that says so itself).
      const row = target();
      const now = row ? norm(row.textContent) : '';
      if (row && now !== window.__moshiText && UNSENT.test(now)) return { state: 'OK' };
      if (how && t && matches(t, how) < before) return { state: 'OK' };
    }
    return { state: pressed.size > 1 ? 'NOT_GONE' : 'NO_CONFIRM' };
  };
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

  /** Take one of my messages back through the message's own More → Unsend menu, as a person does. */
  unsend(threadUrls: string | string[], target: UnsendTarget): Promise<void> {
    const run = this.queue.then(() => this.unsendNow(threadUrls, target))
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

  private async unsendNow(threadUrls: string | string[], target: UnsendTarget): Promise<void> {
    const win = await this.open(threadUrls)
    const run = (body: string): Promise<{ state: string; x?: number; y?: number; how?: string }> =>
      win.webContents.executeJavaScript(`(async () => { ${UNSEND_HELPERS} ${body} })()`, true)
    try {
      // 1. Find the message and mark it. The thread may still be filling in, so give it a few tries.
      let found = await run(`return find(${JSON.stringify(target)});`)
      for (let i = 0; i < 8 && found.state === 'NOT_FOUND'; i++) {
        await sleep(400)
        found = await run(`return find(${JSON.stringify(target)});`)
      }
      if (found.state !== 'OK') {
        this.log(`[instagram composer] unsend: message not recognised (${found.state}):`, await this.describe(win))
        throw new Error('Could not find this message on Instagram to unsend it. You can unsend it in the Instagram app')
      }
      this.log(`[instagram composer] unsend: message found by ${found.how}`)

      // 2. Hover it (a real pointer move, then the page's own events) until its More button shows, and press it.
      this.pointAt(win, found.x!, found.y!)
      const more = await run(`return await moreButton();`)
      if (more.state !== 'OK') {
        this.log('[instagram composer] unsend: no More button:', await this.describe(win))
        throw new Error('Could not open Instagram’s menu for this message')
      }
      this.clickAt(win, more.x!, more.y!)

      // 3. Unsend in the menu (not offered: too old, or not a message Instagram lets you take back).
      let item = await run(`return await menuItem();`)
      if (item.state === 'NO_MENU') {
        await run(`press(document.querySelector('[data-moshi-more]')); return { state: 'OK' };`)
        item = await run(`return await menuItem();`)
      }
      if (item.state !== 'OK') {
        await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return { state: 'OK' };`)
        if (item.state === 'NO_UNSEND') throw new Error('Instagram does not offer Unsend for this message')
        this.log('[instagram composer] unsend: menu did not open:', await this.describe(win))
        throw new Error('Could not open Instagram’s menu for this message')
      }
      this.clickAt(win, item.x!, item.y!)

      // 4. Confirm (when Instagram asks), then wait for the message to go.
      const outcome = await run(`return await confirmAndWait();`)
      if (outcome.state !== 'OK') {
        this.log(`[instagram composer] unsend not confirmed (${outcome.state}):`, await this.describe(win))
        throw new Error('Instagram did not confirm the unsend. Check the conversation')
      }
    } finally {
      await run(`document.querySelectorAll('[data-moshi-unsend], [data-moshi-more]').forEach((el) => { el.removeAttribute('data-moshi-unsend'); el.removeAttribute('data-moshi-more'); }); return { state: 'OK' };`).catch(() => undefined)
      this.idle = setTimeout(() => this.close(), IDLE_CLOSE_MS)
    }
  }

  /** A real pointer move over the page (what makes CSS :hover and Instagram's hover toolbar appear). */
  private pointAt(win: BrowserWindow, x: number, y: number): void {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) })
  }

  private clickAt(win: BrowserWindow, x: number, y: number): void {
    const at = { x: Math.round(x), y: Math.round(y) }
    win.webContents.sendInputEvent({ type: 'mouseMove', ...at })
    win.webContents.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 })
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
