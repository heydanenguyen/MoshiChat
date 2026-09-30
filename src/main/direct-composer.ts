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
  /** Pictures in my run of photo/sticker/video messages that ends the chat (this one included). */
  trailingMedia: number
}

/** Instagram's "More" button beside a hovered message, by its label, across common UI languages. */
const MORE_LABEL = '^(more|more options|more actions|see more|xem thêm|thêm|khác|tùy chọn khác|más|más opciones|plus|plus d.options|mehr|weitere optionen|altro|mais|mais opções|ещё|еще|その他|더 보기|更多|เพิ่มเติม|lainnya|diğer)$'
/** Its "Unsend" menu item and confirm button. "Delete" (for me only) is never matched. */
const UNSEND_LABEL = '^(unsend|thu hồi|anular envío|anular el envío|annuler l.envoi|senden rückgängig machen|zurückziehen|annulla invio|cancelar envio|anular envio|отменить отправку|送信を取り消す|전송 취소|取消发送|取消傳送|撤回|ยกเลิกการส่ง|batalkan pengiriman|batal kirim|göndermeyi geri al)'
/** Small lines under messages that are not messages: seen/sent receipts and times. */
const STATUS_TEXT = '^(seen|sent|delivered|read|seen by|đã xem|đã gửi|đã nhận|đã chuyển|visto|enviado|entregado|vu|envoyé|gesehen|gesendet|visualizzato|inviato|просмотрено|отправлено|既読|送信済み|읽음|전송됨|已读|已發送|已发送|อ่านแล้ว|dilihat|terkirim|görüldü|gönderildi)(?=\\s|$|·)|^\\d{1,2}[:.h]\\d{2}'

/** Shared helpers for the page scripts (a string so it is inlined into each executeJavaScript call). */
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const findBox = () => document.querySelector('div[role="textbox"][contenteditable="true"]') || document.querySelector('div[contenteditable="true"][aria-label]') || document.querySelector('form textarea');
  const fileInput = () => document.querySelector('input[type="file"]');
  const labels = ${JSON.stringify(SEND_LABELS)};
  const sendButton = () => [...document.querySelectorAll('div[role="button"], button')].find((b) => labels.includes((b.textContent || '').trim()) || labels.includes(b.getAttribute('aria-label') || ''));
`

/**
 * Page scripts for unsend. Nothing here relies on Instagram's markup beyond what a person sees: the message list is
 * the scrolling area above the composer, a message part is a block of text (dir="auto") or a picture in it, and mine
 * are the ones on the right half. The chosen part is marked data-moshi-unsend so each step works on the same one,
 * and every step that clicks returns the point to click so the main process can press it with a real pointer (the
 * page's own events are the fallback). survey() describes the page for the log without any message content.
 */
const UNSEND_HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const MORE = new RegExp(${JSON.stringify(MORE_LABEL)}, 'i');
  const UNSEND = new RegExp(${JSON.stringify(UNSEND_LABEL)}, 'i');
  const STATUS = new RegExp(${JSON.stringify(STATUS_TEXT)}, 'i');
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  // Emoji may be drawn as pictures on the page, so text is compared without them.
  const bare = (s) => norm((s || '').replace(/[\\p{Extended_Pictographic}\\u{FE0F}\\u{200D}]/gu, ''));
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const composer = () => document.querySelector('div[role="textbox"][contenteditable="true"]') || document.querySelector('div[contenteditable="true"][aria-label]') || document.querySelector('form textarea');
  // The message list: the biggest scrolling area in the composer's column, above it.
  const pane = () => {
    const box = composer();
    const bx = box ? center(box).x : innerWidth * 0.65;
    const by = box ? box.getBoundingClientRect().top + 4 : innerHeight;
    let best = null, area = 0;
    for (const el of document.querySelectorAll('div')) {
      if (el.scrollHeight <= el.clientHeight + 20) continue;
      const r = el.getBoundingClientRect();
      if (r.left > bx || r.right < bx || r.top >= by || r.height < 120) continue;
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
      if (r.width * r.height > area) { area = r.width * r.height; best = el; }
    }
    return best || document.querySelector('[role="grid"]') || document.querySelector('main') || document.body;
  };
  const big = (m) => { const r = m.getBoundingClientRect(); return r.width >= 60 && r.height >= 60; };
  // Message parts: the outermost text blocks and the pictures/videos, in reading order.
  const MEDIA = 'img, video, [role="img"]';
  const media = (el) => el.matches(MEDIA);
  const parts = (p) => [...p.querySelectorAll('div[dir="auto"], span[dir="auto"], ' + MEDIA)].filter((el) => {
    if (!visible(el) || el.closest('[contenteditable="true"], [role="textbox"]')) return false;
    // A picture drawn inside a bigger picture box counts once, as the box.
    if (media(el)) return big(el) && !(el.parentElement.closest(MEDIA) && big(el.parentElement.closest(MEDIA)));
    return !!norm(el.textContent) && !el.parentElement.closest('div[dir="auto"], span[dir="auto"]');
  });
  // Mine sit on the right: the part's middle is right of the list's middle.
  const mine = (el, p) => { const r = p.getBoundingClientRect(); return center(el).x > r.left + r.width / 2; };
  const status = (el) => !media(el) && (STATUS.test(norm(el.textContent)) || norm(el.textContent).length <= 2);
  // React keeps each message's data on its components; look for the item's ids from a part upwards, stopping
  // before anything that also holds another part (that is a group or the list, not this message).
  const fiberOf = (el) => { const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const holds = (value, ids, depth, seen) => {
    if (value == null || depth > 4) return false;
    if (typeof value === 'string') return ids.includes(value);
    if (typeof value !== 'object' || seen.has(value) || value.$$typeof || value instanceof Node) return false;
    // A long list is the thread's messages, not this one's data.
    if (Array.isArray(value) && value.length > 5) return false;
    seen.add(value);
    let n = 0;
    for (const key in value) {
      if (++n > 80) break;
      try { if (holds(value[key], ids, depth + 1, seen)) return true; } catch {}
    }
    return false;
  };
  // How far up from the part the ids turn up (-1: not at all).
  const partHolds = (part, ids, all) => {
    const others = all.filter((o) => o !== part && !part.contains(o) && !o.contains(part));
    const seen = new Set();
    let fiber = fiberOf(part);
    for (let i = 0; fiber && i < 60; i++, fiber = fiber.return) {
      const node = fiber.stateNode;
      if (node instanceof Element && others.some((o) => node.contains(o))) return -1;
      if (holds(fiber.memoizedProps, ids, 0, seen)) return i;
    }
    return -1;
  };
  const idsOf = (target) => target.ids.filter((id) => id && id.length >= 10);
  // The parts that carry the ids closest to themselves: the message's own data sits right above its parts, while
  // anything that reaches them from further up (a group, the thread) is not about this message alone.
  const byId = (target, p, all) => {
    const ids = idsOf(target);
    if (!ids.length) return [];
    const found = all.map((el) => [el, partHolds(el, ids, all)]).filter(([, d]) => d >= 0);
    const nearest = Math.min(...found.map(([, d]) => d));
    return found.filter(([, d]) => d === nearest).map(([el]) => el);
  };
  const byText = (target, p, all) => {
    const text = bare(target.text), full = norm(target.text);
    return all.filter((el) => !media(el) && mine(el, p) && (text ? bare(el.textContent) === text : norm(el.textContent) === full));
  };
  const myMedia = (p, all) => all.filter((el) => media(el) && mine(el, p));
  const mark = (el, how, count) => {
    document.querySelectorAll('[data-moshi-unsend]').forEach((e) => e.removeAttribute('data-moshi-unsend'));
    el.setAttribute('data-moshi-unsend', how);
    el.scrollIntoView({ block: 'center' });
    window.__moshiHow = how;
    window.__moshiBefore = count;
    return { state: 'OK', how, ...center(el) };
  };
  // How many parts still match the way the message was found (drops by one once it is gone).
  const matches = (target, how) => {
    const p = pane(), all = parts(p);
    if (how === 'id') return byId(target, p, all).length;
    if (how === 'text') return byText(target, p, all).length;
    return myMedia(p, all).length;
  };
  const find = (target) => {
    window.__moshiTarget = target;
    const p = pane(), all = parts(p);
    if (!all.length) return { state: 'NOT_FOUND' };
    const withId = byId(target, p, all);
    if (withId.length === 1) return mark(withId[0], 'id', 1);
    if (norm(target.text)) {
      const same = byText(target, p, all);
      if (same.length <= target.sameTextAfter) return { state: 'NOT_FOUND' };
      return mark(same[same.length - 1 - target.sameTextAfter], 'text', same.length);
    }
    // A photo, sticker or video: only the newest message of the chat, when the page ends the same way the chat does
    // (the same number of my pictures in a row, and nothing of theirs after them).
    if (!target.newest) return { state: 'UNSURE' };
    let trailing = 0, last = null;
    for (let i = all.length - 1; i >= 0; i--) {
      const el = all[i];
      if (media(el) && mine(el, p)) { trailing++; last = last || el; continue; }
      // Receipts, times and reaction emoji under the messages are not messages.
      if (!media(el) && status(el)) continue;
      break;
    }
    if (!last || trailing !== target.trailingMedia) return { state: 'NOT_FOUND' };
    return mark(last, 'newest', myMedia(p, all).length);
  };
  const target = () => document.querySelector('[data-moshi-unsend]');
  const survey = (target) => {
    const p = pane(), all = parts(p);
    const r = p.getBoundingClientRect();
    return {
      url: location.pathname,
      composer: !!composer(),
      pane: p === document.body ? 'body' : p.tagName.toLowerCase() + (p.getAttribute('role') ? '[' + p.getAttribute('role') + ']' : ''),
      paneBox: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      roleRows: p.querySelectorAll('[role="row"]').length,
      parts: all.length,
      textParts: all.filter((el) => !media(el)).length,
      mediaParts: all.filter(media).length,
      mineParts: all.filter((el) => mine(el, p)).length,
      mineMedia: myMedia(p, all).length,
      idMatches: target ? byId(target, p, all).length : null,
      textMatches: target && norm(target.text) ? byText(target, p, all).length : null,
      reactFiber: all.some((el) => !!fiberOf(el)),
      tail: all.slice(-6).map((el) => (media(el) ? 'media' : status(el) ? 'status' : 'text') + (mine(el, p) ? ':mine' : ':theirs')),
      labels: [...new Set([...document.querySelectorAll('svg[aria-label], [role="button"][aria-label]')].filter(visible).map((el) => el.getAttribute('aria-label')))].slice(0, 30)
    };
  };
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
  // The More button beside the chosen message: level with it, inside the list, the nearest one.
  const moreButton = async () => {
    for (let i = 0; i < 20; i++) {
      const el = target();
      if (!el) return { state: 'LOST' };
      const r = el.getBoundingClientRect(), pr = pane().getBoundingClientRect();
      const level = [...document.querySelectorAll('svg[aria-label], [role="button"][aria-label], button[aria-label]')]
        .filter((b) => MORE.test(norm(b.getAttribute('aria-label'))) && visible(b))
        .map((b) => ({ b, c: center(b) }))
        .filter(({ c }) => c.y >= r.top - 24 && c.y <= r.bottom + 24 && c.x >= pr.left && c.x <= pr.right)
        .sort((a, b) => Math.abs(a.c.y - (r.top + r.height / 2)) - Math.abs(b.c.y - (r.top + r.height / 2)));
      if (level.length) {
        const button = level[0].b.closest('[role="button"], button') || level[0].b;
        button.setAttribute('data-moshi-more', '1');
        return { state: 'OK', ...center(button) };
      }
      poke(el);
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
      if (menus().length && i >= 6) return { state: 'NO_UNSEND', items: menus().flatMap((m) => [...m.querySelectorAll('[role="menuitem"], [role="button"], button')].map((el) => norm(el.textContent) || el.getAttribute('aria-label'))).slice(0, 12) };
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
    const run = (body: string): Promise<{ state: string; x?: number; y?: number; how?: string; items?: string[] }> =>
      win.webContents.executeJavaScript(`(async () => { ${UNSEND_HELPERS} ${body} })()`, true)
    // What the page looked like, without any message content, for the log when a step fails.
    const survey = async (): Promise<string> =>
      JSON.stringify(await run(`return survey(${JSON.stringify(target)});`).catch((err: Error) => ({ state: `unavailable (${err.message})` })))
    try {
      // 1. Find the message and mark it. The thread may still be filling in, so give it a few tries.
      let found = await run(`return find(${JSON.stringify(target)});`)
      for (let i = 0; i < 8 && found.state === 'NOT_FOUND'; i++) {
        await sleep(400)
        found = await run(`return find(${JSON.stringify(target)});`)
      }
      if (found.state !== 'OK') {
        this.log(`[instagram composer] unsend: message not recognised (${found.state}):`, await survey())
        throw new Error('Could not find this message on Instagram to unsend it. You can unsend it in the Instagram app')
      }
      this.log(`[instagram composer] unsend: message found by ${found.how}`)

      // 2. Hover it (a real pointer move, then the page's own events) until its More button shows, and press it.
      this.pointAt(win, found.x!, found.y!)
      const more = await run(`return await moreButton();`)
      if (more.state !== 'OK') {
        this.log('[instagram composer] unsend: no More button:', await survey())
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
        if (item.state === 'NO_UNSEND') {
          this.log('[instagram composer] unsend: not in the menu, which offers:', JSON.stringify(item.items ?? []))
          throw new Error('Instagram does not offer Unsend for this message')
        }
        this.log('[instagram composer] unsend: menu did not open:', await survey())
        throw new Error('Could not open Instagram’s menu for this message')
      }
      this.clickAt(win, item.x!, item.y!)

      // 4. Confirm (when Instagram asks), then wait for the message to go.
      const outcome = await run(`return await confirmAndWait();`)
      if (outcome.state !== 'OK') {
        this.log(`[instagram composer] unsend not confirmed (${outcome.state}):`, await survey())
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
