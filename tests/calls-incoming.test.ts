import { EventEmitter } from 'node:events'
import { createContext, runInContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

import { IncomingCalls, IncomingList, type IncomingPort, type RingHost } from '../src/main/calls/incoming'
import { presenceAction, shouldRunPresence } from '../src/main/calls/messenger-presence'
import { RING_ACTIVE_SCRIPT, RING_PREFIX, isVideoRing, newRingPrefix, parseRingEvent, pickPeerName, ringEventFromConsole, ringScript } from '../src/main/calls/ring-detect'
import type { Account, IncomingCall } from '../src/shared/types'

describe('pickPeerName', () => {
  it('reads the name out of the usual sentences', () => {
    expect(pickPeerName(['Lan Nguyen is calling you'])).toBe('Lan Nguyen')
    expect(pickPeerName(['Nguyễn Lan đang gọi cho bạn'])).toBe('Nguyễn Lan')
    expect(pickPeerName(['Incoming video call from Minh Anh'])).toBe('Minh Anh')
    expect(pickPeerName(['Cuộc gọi video đến từ Minh Anh'])).toBe('Minh Anh')
  })

  it('takes a line that is just the name, skipping the dialog chrome', () => {
    expect(pickPeerName(['Incoming call', 'Trần Bình', 'Messenger'])).toBe('Trần Bình')
    expect(pickPeerName(['Video call', 'Cuộc gọi đến'])).toBe('')
    expect(pickPeerName([])).toBe('')
  })
})

describe('isVideoRing', () => {
  it('goes by the dialog texts', () => {
    expect(isVideoRing(['Lan', 'Incoming video call'])).toBe(true)
    expect(isVideoRing(['Lan', 'Cuộc gọi video đến'])).toBe(true)
    expect(isVideoRing(['Lan', 'Incoming call'])).toBe(false)
  })
})

describe('parseRingEvent', () => {
  it('turns the dialog texts into a name and a kind', () => {
    expect(parseRingEvent(JSON.stringify({ kind: 'ring', callId: 'r1-abc', texts: ['Lan Nguyen is calling you', 'Video call'] }))).toEqual({ kind: 'ring', callId: 'r1-abc', peerName: 'Lan Nguyen', video: true })
  })

  it('lets a name and a kind the page worked out win', () => {
    expect(parseRingEvent('{"kind":"ring","callId":"x","peerName":"Bao","video":false,"texts":["video"]}')).toEqual({ kind: 'ring', callId: 'x', peerName: 'Bao', video: false })
  })

  it('knows the end', () => {
    expect(parseRingEvent('{"kind":"ended"}')).toEqual({ kind: 'ended' })
  })

  it('refuses everything else the page might print', () => {
    for (const bad of ['', 'not json', 'null', '[]', '{"kind":"ring"}', '{"kind":"ring","callId":7}', '{"kind":"ring","callId":"a b"}', '{"kind":"hello"}', '{"kind":"ring","callId":"' + 'x'.repeat(80) + '"}']) {
      expect(parseRingEvent(bad)).toBeUndefined()
    }
  })

  it('keeps at most 20 texts of 120 characters, and a name of 80', () => {
    const filler = Array.from({ length: 20 }, () => '...')
    // The 21st text is cut off: a name there is never read.
    expect(parseRingEvent(JSON.stringify({ kind: 'ring', callId: 'a', texts: [...filler, 'Lan'] }))).toMatchObject({ peerName: '' })
    expect(parseRingEvent(JSON.stringify({ kind: 'ring', callId: 'a', texts: [...filler.slice(1), 'Lan'] }))).toMatchObject({ peerName: 'Lan' })
    // Past 120 characters a text is cut: the word video that sits there is not seen.
    const long = `Lan is calling${' '.repeat(106)}video`
    expect(long.length).toBeGreaterThan(120)
    expect(parseRingEvent(JSON.stringify({ kind: 'ring', callId: 'a', texts: [long] }))).toMatchObject({ peerName: 'Lan', video: false })
    expect(parseRingEvent(JSON.stringify({ kind: 'ring', callId: 'a', peerName: 'n'.repeat(200) }))).toMatchObject({ peerName: 'n'.repeat(80) })
  })
})

describe('ringEventFromConsole', () => {
  it('hears only lines with the prefix of this watch', () => {
    const prefix = newRingPrefix()
    expect(prefix.startsWith(RING_PREFIX)).toBe(true)
    expect(newRingPrefix()).not.toBe(prefix)
    expect(ringEventFromConsole(`${prefix}{"kind":"ended"}`, prefix)).toEqual({ kind: 'ended' })
    expect(ringEventFromConsole('{"kind":"ended"}', prefix)).toBeUndefined()
    expect(ringEventFromConsole(`${RING_PREFIX}{"kind":"ended"}`, prefix)).toBeUndefined()
    expect(ringEventFromConsole(`${newRingPrefix()}{"kind":"ended"}`, prefix)).toBeUndefined()
    expect(ringEventFromConsole('some page noise', prefix)).toBeUndefined()
  })
})

describe('IncomingList', () => {
  const base = { accountId: 'messenger:fb-1', platform: 'messenger' as const, peerName: 'Lan', kind: 'audio' as const }

  it('adds a call once and ignores the same call told again', () => {
    const list = new IncomingList(() => 1000)
    const first = list.ring('p1', 'c1', base)
    expect(first.fresh).toBe(true)
    expect(first.call).toMatchObject({ ...base, at: 1000 })
    const again = list.ring('p1', 'c1', base)
    expect(again.fresh).toBe(false)
    expect(again.call.id).toBe(first.call.id)
    expect(list.all()).toHaveLength(1)
  })

  it('lets a page ring one call at a time: a new call pushes the old one out', () => {
    const list = new IncomingList()
    const old = list.ring('p1', 'c1', base).call
    const next = list.ring('p1', 'c2', base)
    expect(next.fresh).toBe(true)
    expect(next.replaced?.id).toBe(old.id)
    expect(list.all().map((c) => c.id)).toEqual([next.call.id])
  })

  it('keeps calls of different pages apart', () => {
    const list = new IncomingList()
    const a = list.ring('p1', 'same', base).call
    const b = list.ring('p2', 'same', { ...base, platform: 'instagram' }).call
    expect(a.id).not.toBe(b.id)
    expect(list.all()).toHaveLength(2)
    expect(list.byId(b.id)?.source).toBe('p2')
  })

  it('takes a call away when its ring ends', () => {
    const list = new IncomingList()
    const call = list.ring('p1', 'c1', base).call
    expect(list.has('p1')).toBe(true)
    expect(list.ended('p1')?.id).toBe(call.id)
    expect(list.ended('p1')).toBeUndefined()
    expect(list.has('p1')).toBe(false)
    expect(list.byId(call.id)).toBeUndefined()
  })
})

const account = (over: Partial<Account> = {}): Account => ({ id: 'messenger:fb-1', platform: 'messenger', displayName: 'Me', status: 'connected', features: { reply: true, react: true, attachments: true }, ...over })

describe('presence decision', () => {
  it('runs for a connected personal Messenger account with the setting on (the default)', () => {
    expect(shouldRunPresence({}, account())).toBe(true)
    expect(shouldRunPresence({ calls: { incomingMessenger: true } }, account())).toBe(true)
  })

  it('does not run with the setting off, for other accounts, or while not connected', () => {
    expect(shouldRunPresence({ calls: { incomingMessenger: false } }, account())).toBe(false)
    expect(shouldRunPresence({}, account({ status: 'connecting' }))).toBe(false)
    expect(shouldRunPresence({}, account({ status: 'needs_auth' }))).toBe(false)
    expect(shouldRunPresence({}, account({ id: 'messenger:12345' }))).toBe(false)
    expect(shouldRunPresence({}, account({ demo: true }))).toBe(false)
    expect(shouldRunPresence({}, account({ id: 'instagram:ig-1', platform: 'instagram' }))).toBe(false)
  })

  it('starts when it should and does nothing otherwise', () => {
    expect(presenceAction({}, account(), false)).toBe('start')
    expect(presenceAction({}, account({ status: 'connecting' }), false)).toBe('keep')
    expect(presenceAction({}, undefined, false)).toBe('keep')
  })

  it('stops when the setting goes off, the account is removed or must sign in again, but survives a reconnect', () => {
    expect(presenceAction({ calls: { incomingMessenger: false } }, account(), true)).toBe('stop')
    expect(presenceAction({}, undefined, true)).toBe('stop')
    expect(presenceAction({}, account({ status: 'needs_auth' }), true)).toBe('stop')
    expect(presenceAction({}, account({ status: 'connecting' }), true)).toBe('keep')
    expect(presenceAction({}, account({ status: 'error' }), true)).toBe('keep')
    expect(presenceAction({}, account(), true)).toBe('keep')
  })
})

// A just-enough page: elements with attributes, text, boxes, and the few selectors the script uses.
class El {
  children: El[] = []
  parentElement: El | null = null
  attrs: Record<string, string> = {}
  constructor(
    readonly tag: string,
    private readonly own = '',
    attrs: Record<string, string> = {},
    private readonly hidden = false
  ) {
    this.attrs = attrs
  }
  add(...kids: El[]): this {
    for (const kid of kids) {
      kid.parentElement = this
      this.children.push(kid)
    }
    return this
  }
  get textContent(): string {
    return this.own + this.children.map((c) => c.textContent).join(' ')
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value
  }
  removeAttribute(name: string): void {
    delete this.attrs[name]
  }
  getBoundingClientRect(): { width: number; height: number; left: number; top: number } {
    return this.hidden ? { width: 0, height: 0, left: 0, top: 0 } : { width: 80, height: 30, left: 5, top: 5 }
  }
  contains(other: El): boolean {
    for (let x: El | null = other; x; x = x.parentElement) if (x === this) return true
    return false
  }
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part)
      if (attr) return attr[1] in this.attrs && (attr[2] === undefined || this.attrs[attr[1]!] === attr[2])
      return part === '*' || part === this.tag
    })
  }
  closest(selector: string): El | null {
    const hit = (x: El): boolean => x.matches(selector) || (selector.includes('[tabindex]') && 'tabindex' in x.attrs)
    if (hit(this)) return this
    for (let x = this.parentElement; x; x = x.parentElement) if (hit(x)) return x
    return null
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()])
  }
  querySelectorAll(selector: string): El[] {
    return this.descendants().filter((e) => e.matches(selector))
  }
}

const dialog = (...kids: El[]): El => new El('div', '', { role: 'dialog' }).add(...kids)
const button = (label: string, hidden = false): El => new El('div', '', { role: 'button', 'aria-label': label }, hidden).add(new El('svg'))
const word = (text: string): El => new El('span', text)

function load(root: El) {
  const lines: string[] = []
  const timers: Array<() => void> = []
  let now = 1_000_000
  const html = new El('html').add(root)
  const window: Record<string, unknown> = {}
  const context = createContext({
    document: { documentElement: html, querySelectorAll: (s: string) => html.querySelectorAll(s) },
    window,
    console: { log: (m: string) => lines.push(m) },
    MutationObserver: class {
      observe(): void {}
    },
    setInterval: () => 0,
    setTimeout: (fn: () => void) => (timers.push(fn), timers.length),
    Date: { now: () => now }
  })
  const prefix = newRingPrefix()
  const install = (): void => void runInContext(ringScript(prefix), context)
  install()
  const events = (): unknown[] => lines.filter((l) => l.startsWith(prefix)).map((l) => JSON.parse(l.slice(prefix.length)))
  const check = (): void => (window.__moshiRing as { check(): void }).check()
  return { install, events, check, advance: (ms: number) => void (now += ms), timers, window, html }
}

describe('the ring script in a page', () => {
  it('reports a ringing dialog once, with its texts', () => {
    const page = load(new El('div').add(word('Inbox'), dialog(word('Lan Nguyen'), word('Incoming video call'), button('Decline'), button('Answer'))))
    const [ring] = page.events() as Array<{ kind: string; callId: string; texts: string[] }>
    expect(ring).toMatchObject({ kind: 'ring', texts: ['Lan Nguyen', 'Incoming video call'] })
    page.check()
    page.install()
    expect(page.events()).toHaveLength(1)
    const parsed = parseRingEvent(JSON.stringify(ring))
    expect(parsed).toMatchObject({ kind: 'ring', peerName: 'Lan Nguyen', video: true })
  })

  it('knows the Vietnamese labels and tags the two controls for the clicks', () => {
    const page = load(new El('div').add(dialog(word('Trần Bình đang gọi cho bạn'), button('Từ chối'), button('Trả lời'))))
    expect(page.events()).toHaveLength(1)
    const tagged = page.html.querySelectorAll('[data-moshi-ring]')
    expect(tagged.map((e) => e.attrs['data-moshi-ring']).sort()).toEqual(['answer', 'decline'])
  })

  it('reads a text button too (no aria-label)', () => {
    const page = load(new El('div').add(dialog(word('Lan is calling'), new El('button', 'Decline'), new El('button', 'Accept'))))
    expect(page.events()).toHaveLength(1)
  })

  it('ignores Accept / Decline that is not about a call (a request, a cookie banner)', () => {
    const page = load(new El('div').add(dialog(word('Lan wants to send you a message'), button('Decline'), button('Accept'))))
    expect(page.events()).toEqual([])
  })

  it('ignores a dialog that is not on screen', () => {
    const page = load(new El('div').add(dialog(word('Lan is calling'), button('Decline', true), button('Answer', true))))
    expect(page.events()).toEqual([])
  })

  it('says the ring ended only after the dialog has been gone a while', () => {
    const root = new El('div')
    const ringing = dialog(word('Lan is calling'), button('Decline'), button('Answer'))
    root.add(ringing)
    const page = load(root)
    expect(page.events()).toHaveLength(1)
    root.children.splice(0)
    page.check()
    // Gone for a moment (a re-render): not yet over, a second look is asked for.
    expect(page.events()).toHaveLength(1)
    expect(page.timers.length).toBe(1)
    root.add(ringing)
    page.advance(300)
    page.check()
    expect(page.events()).toHaveLength(1)
    root.children.splice(0)
    page.check()
    page.advance(700)
    page.check()
    expect(page.events()).toHaveLength(2)
    expect(page.events()[1]).toEqual({ kind: 'ended' })
  })

  it('rings again as a new call once it has ended', () => {
    const root = new El('div')
    const page = load(root)
    root.add(dialog(word('Lan is calling'), button('Decline'), button('Answer')))
    page.check()
    root.children.splice(0)
    page.check()
    page.advance(1000)
    page.check()
    root.add(dialog(word('Lan is calling'), button('Decline'), button('Answer')))
    page.check()
    const rings = page.events().filter((e) => (e as { kind: string }).kind === 'ring') as Array<{ callId: string }>
    expect(rings).toHaveLength(2)
    expect(rings[0]!.callId).not.toBe(rings[1]!.callId)
  })

  it('answers the active question from the same lookup the clicks use', () => {
    const page = load(new El('div').add(dialog(word('Lan is calling'), button('Decline'), button('Answer'))))
    expect(runInContext(RING_ACTIVE_SCRIPT, createContext({ window: page.window }))).toBe(true)
  })
})

// A page and its window, just enough for the controller.
class FakeContents extends EventEmitter {
  id = 7
  getUserAgent = (): string => 'Mozilla/5.0 test'
  setUserAgent = vi.fn()
  gone = false
  windowOpen: ((d: { url: string }) => { action: string }) | undefined
  isDestroyed = (): boolean => this.gone
  isLoading = (): boolean => false
  getURL = (): string => 'https://www.facebook.com/messages/'
  sendInputEvent = vi.fn()
  loadURL = vi.fn(async () => undefined)
  setWindowOpenHandler = (fn: (d: { url: string }) => { action: string }): void => void (this.windowOpen = fn)
  // The script's answers: where the Answer button is, that the dialog is gone after a click, that a scripted click worked.
  dialogUp = true
  executeJavaScript = vi.fn(async (script: string) => {
    if (script === RING_ACTIVE_SCRIPT) return this.dialogUp
    if (script.includes('getBoundingClientRect')) return { x: 10, y: 20 }
    if (script.includes('el.click()')) return true
    return undefined
  })
}

class FakeWindow extends EventEmitter {
  webContents = new FakeContents()
  visible = false
  title = ''
  size: number[] = [1100, 760]
  getSize = (): number[] => this.size
  isDestroyed = (): boolean => false
  isMinimized = (): boolean => false
  restore = vi.fn()
  minimize = vi.fn()
  setTitle = (t: string): void => void (this.title = t)
  setSize = (w: number, h: number): void => void (this.size = [w, h])
  center = vi.fn()
  setIcon = vi.fn()
  show = (): void => void (this.visible = true)
  focus = vi.fn()
  hide = (): void => void (this.visible = false)
  destroy = vi.fn()
}

function setup(settings: Partial<{ incomingMessenger: boolean; incomingInstagram: boolean }> = {}, account: { id?: string } = { id: 'messenger:fb-1' }) {
  const win = new FakeWindow()
  const host: RingHost & { began: number; ended: number } = {
    key: 'messenger-presence:messenger:fb-1',
    platform: 'messenger',
    homeUrl: 'https://www.facebook.com/messages/',
    began: 0,
    ended: 0,
    accountId: () => account.id,
    callWindow: () => win as never,
    beginCall() {
      this.began++
    },
    endCall() {
      this.ended++
    }
  }
  const added: IncomingCall[] = []
  const removed: string[] = []
  const trusted = new Set<unknown>()
  const adopted: Array<{ id: string; handle: Parameters<IncomingPort['adopt']>[1]['handle'] }> = []
  const state = { busy: false, closing: false }
  const external: string[] = []
  const port: IncomingPort = {
    add: (c) => added.push(c),
    remove: (id) => removed.push(id),
    busy: () => state.busy,
    closing: () => state.closing,
    adopt: (id, call) => adopted.push({ id, handle: call.handle }),
    trust: (c) => trusted.add(c),
    untrust: (c) => trusted.delete(c),
    openExternal: (url) => external.push(url),
    settings: () => ({ incomingMessenger: true, incomingInstagram: true, ring: true, ...settings }),
    language: () => 'en',
    icon: () => undefined,
    log: () => undefined
  }
  const calls = new IncomingCalls(port)
  calls.watch(host)
  // The page's own line prefix is made up per watch: read it from the script that was injected.
  const prefix = /const PREFIX = "([^"]+)"/.exec(win.webContents.executeJavaScript.mock.calls[0]![0])![1]!
  const say = (event: object): boolean => win.webContents.emit('console-message', { message: prefix + JSON.stringify(event), frame: { parent: null } })
  const ring = (callId = 'c1', texts = ['Lan is calling you', 'Video call']): boolean => say({ kind: 'ring', callId, texts })
  return { calls, win, host, added, removed, trusted, adopted, state, say, ring, prefix, external, account }
}

describe('IncomingCalls', () => {
  afterEach(() => vi.useRealTimers())

  it('tells the manager of a ring once, and lends the page the microphone while it rings', () => {
    const t = setup()
    t.ring()
    t.ring()
    expect(t.added).toHaveLength(1)
    expect(t.added[0]).toMatchObject({ accountId: 'messenger:fb-1', platform: 'messenger', peerName: 'Lan', kind: 'video' })
    expect(t.trusted.has(t.win.webContents)).toBe(true)
    t.say({ kind: 'ended' })
    expect(t.removed).toEqual([t.added[0]!.id])
    expect(t.trusted.has(t.win.webContents)).toBe(false)
  })

  it('names a caller the dialog did not name', () => {
    const t = setup()
    t.ring('c1', ['Incoming call'])
    expect(t.added[0]!.peerName).toBe('Someone')
  })

  it('does not listen for a platform whose setting is off', () => {
    const t = setup({ incomingMessenger: false })
    t.ring()
    expect(t.added).toEqual([])
    expect(t.trusted.size).toBe(0)
  })

  it('lets a ring go when the page says nothing for too long, or leaves', () => {
    vi.useFakeTimers()
    const t = setup()
    t.ring()
    vi.advanceTimersByTime(91_000)
    expect(t.removed).toHaveLength(1)
    t.ring('c2')
    t.win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(t.removed).toHaveLength(2)
    expect(t.trusted.size).toBe(0)
  })

  it('ignores a line printed by a frame inside the page', () => {
    const t = setup()
    const line = t.prefix + '{"kind":"ring","callId":"x","texts":["a"]}'
    t.win.webContents.emit('console-message', { message: line, frame: { parent: {} } })
    // A message that says nothing of where it came from is refused as well.
    t.win.webContents.emit('console-message', { message: line })
    // And so is a line without this watch's prefix.
    t.win.webContents.emit('console-message', { message: RING_PREFIX + '{"kind":"ring","callId":"x","texts":["a"]}', frame: { parent: null } })
    expect(t.added).toEqual([])
  })

  it('declines in the page and takes the banner away', async () => {
    const t = setup()
    t.ring()
    const id = t.added[0]!.id
    expect(await t.calls.decline(id)).toBe(true)
    expect(t.win.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('"decline"'), true)
    expect(t.removed).toEqual([id])
    expect(t.trusted.size).toBe(0)
    expect(await t.calls.decline(id)).toBe(false)
  })

  it('answers: the hidden window becomes the call window, and closing it ends the call and puts the page to rest', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.ring()
    const id = t.added[0]!.id
    t.win.webContents.dialogUp = false
    const answering = t.calls.answer(id)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await answering).toBe(true)
    expect(t.host.began).toBe(1)
    expect(t.win.title).toBe('Moshi · Call')
    expect(t.win.size).toEqual([960, 640])
    expect(t.win.visible).toBe(true)
    expect(t.win.webContents.sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouseDown' }))
    expect(t.adopted.map((a) => a.id)).toEqual([id])
    const handle = t.adopted[0]!.handle
    expect(handle.owns(t.win.webContents as never)).toBe(true)
    // The page says the dialog is gone (the call is connected): the call goes on.
    t.say({ kind: 'ended' })
    expect(t.trusted.has(t.win.webContents)).toBe(true)

    let closed = 0
    handle.onClosed(() => closed++)
    const prevented = vi.fn()
    t.win.emit('close', { preventDefault: prevented })
    expect(prevented).toHaveBeenCalled()
    expect(t.win.visible).toBe(false)
    expect(t.host.ended).toBe(1)
    expect(t.win.webContents.loadURL).toHaveBeenCalledWith('https://www.facebook.com/messages/')
    expect(closed).toBe(1)
    expect(t.trusted.size).toBe(0)
    await expect(handle.closed()).resolves.toBeUndefined()
    expect(handle.owns(t.win.webContents as never)).toBe(false)
  })

  it('does not answer while another call is in progress', async () => {
    const t = setup()
    t.ring()
    t.state.busy = true
    expect(await t.calls.answer(t.added[0]!.id)).toBe(false)
    expect(t.adopted).toEqual([])
    expect(t.win.visible).toBe(false)
  })

  it('ends an answered call that has no Answer button any more', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.ring()
    t.win.webContents.executeJavaScript.mockImplementation(async () => null)
    const answering = t.calls.answer(t.added[0]!.id)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await answering).toBe(false)
    expect(t.win.visible).toBe(false)
    expect(t.host.ended).toBe(1)
  })

  it('lets the window close on quit instead of holding it back', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.ring()
    const answering = t.calls.answer(t.added[0]!.id)
    await vi.advanceTimersByTimeAsync(3000)
    await answering
    t.state.closing = true
    const prevented = vi.fn()
    t.win.emit('close', { preventDefault: prevented })
    expect(prevented).not.toHaveBeenCalled()
  })

  it('opens a popup only for an answered call and only on the platform sites', async () => {
    vi.useFakeTimers()
    const t = setup()
    const open = t.win.webContents.windowOpen!
    expect(open({ url: 'https://www.facebook.com/groupcall/x' }).action).toBe('deny')
    t.ring()
    const answering = t.calls.answer(t.added[0]!.id)
    await vi.advanceTimersByTimeAsync(3000)
    await answering
    expect(open({ url: 'https://www.facebook.com/groupcall/x' }).action).toBe('allow')
    expect(open({ url: 'https://evil.example/' }).action).toBe('deny')
  })

  it('puts the popup of an answered call under the same guard as a call window', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.ring()
    const answering = t.calls.answer(t.added[0]!.id)
    await vi.advanceTimersByTimeAsync(3000)
    await answering
    const popup = new FakeWindow()
    t.win.webContents.emit('did-create-window', popup)
    expect(t.trusted.has(popup.webContents)).toBe(true)
    expect(popup.webContents.setUserAgent).toHaveBeenCalledWith('Mozilla/5.0 test')
    expect(t.win.visible).toBe(false)
    expect(popup.webContents.windowOpen!({ url: 'https://www.facebook.com/x' }).action).toBe('deny')
    expect(popup.webContents.windowOpen!({ url: 'https://evil.example/x' }).action).toBe('deny')
    expect(t.external).toEqual(['https://evil.example/x'])
    const stay = { preventDefault: vi.fn() }
    popup.webContents.emit('will-navigate', stay, 'https://www.messenger.com/call/1')
    expect(stay.preventDefault).not.toHaveBeenCalled()
    const leave = { preventDefault: vi.fn() }
    popup.webContents.emit('will-redirect', leave, 'https://evil.example/r')
    expect(leave.preventDefault).toHaveBeenCalled()
    expect(t.external).toEqual(['https://evil.example/x', 'https://evil.example/r'])
    // Ending the call takes the popup with it.
    t.adopted[0]!.handle.close()
    expect(popup.destroy).toHaveBeenCalled()
    expect(t.trusted.size).toBe(0)
  })

  it('puts the window back to the size it had before the call', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.ring()
    const answering = t.calls.answer(t.added[0]!.id)
    await vi.advanceTimersByTimeAsync(3000)
    await answering
    expect(t.win.size).toEqual([960, 640])
    t.adopted[0]!.handle.close()
    expect(t.win.size).toEqual([1100, 760])
  })

  it('keeps a ring heard before its account is known and tells it once the account is', () => {
    vi.useFakeTimers()
    const t = setup({}, {})
    t.ring()
    t.ring()
    expect(t.added).toEqual([])
    vi.advanceTimersByTime(2500)
    expect(t.added).toEqual([])
    t.account.id = 'messenger:fb-1'
    vi.advanceTimersByTime(1000)
    expect(t.added).toHaveLength(1)
    expect(t.added[0]).toMatchObject({ accountId: 'messenger:fb-1', peerName: 'Lan' })
  })

  it('drops a waiting ring that ended before its account was known', () => {
    vi.useFakeTimers()
    const t = setup({}, {})
    t.ring()
    t.say({ kind: 'ended' })
    t.account.id = 'messenger:fb-1'
    vi.advanceTimersByTime(3000)
    expect(t.added).toEqual([])
  })

  it('forgets a page that is gone: its ring ends and it loses the microphone', () => {
    const t = setup()
    t.ring()
    t.calls.forget(t.host)
    expect(t.removed).toHaveLength(1)
    expect(t.trusted.size).toBe(0)
    expect(t.ring('c9')).toBe(false)
  })
})
