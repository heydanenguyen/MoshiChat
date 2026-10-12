import { beforeEach, describe, expect, it, vi } from 'vitest'

// motion/peer.ts needs a few bits of the page: stub a tiny DOM of elements that remember their inline view-transition-name.
class FakeEl {
  style = {
    props: new Map<string, string>(),
    setProperty(k: string, v: string) {
      this.props.set(k, v)
    },
    removeProperty(k: string) {
      this.props.delete(k)
    }
  }
  children = new Map<string, FakeEl>()
  rect = { top: 0, bottom: 100, height: 100 }
  constructor(public cls = '') {}
  querySelector(sel: string): FakeEl | null {
    return this.children.get(sel) ?? null
  }
  closest(sel: string): FakeEl | null {
    return sel === '.conv-list' ? list : null
  }
  getBoundingClientRect(): { top: number; bottom: number; height: number } {
    return this.rect
  }
  get name(): string | undefined {
    return this.style.props.get('view-transition-name')
  }
}
const list = new FakeEl('list')
list.rect = { top: 0, bottom: 500, height: 500 }
const rowAvatar = new FakeEl()
const rowName = new FakeEl()
const row = new FakeEl('row')
row.children.set('.avatar', rowAvatar)
row.children.set('.conv-name', rowName)
row.rect = { top: 100, bottom: 164, height: 64 }
const headAvatar = new FakeEl()
const headName = new FakeEl()
const scroll = new FakeEl()
const pane = new FakeEl('pane')
pane.children.set('.chat-header > .avatar', headAvatar)
pane.children.set('.chat-header-name', headName)
pane.children.set('.chat-scroll', scroll)
const dataset: Record<string, string | undefined> = {}
const root = { dataset, offsetWidth: 0 }
let rowInDom = true
const doc = {
  documentElement: root,
  hidden: false,
  querySelector: (sel: string): FakeEl | null => {
    if (sel.startsWith('.conv-item')) return rowInDom ? row : null
    if (sel === '.chat-pane.active') return pane
    return null
  },
  startViewTransition: undefined as unknown
}
vi.stubGlobal('HTMLElement', FakeEl)
vi.stubGlobal('CSS', { escape: (s: string) => s })
vi.stubGlobal('document', doc)
vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
const { openChatMotion, closeChatMotion, clearPeers, visibleRow, markSwap } = await import('../src/renderer/src/motion/peer')

const named = (): string[] => [rowAvatar, rowName, headAvatar, headName, scroll].filter((e) => e.name).map((e) => e.name!)

beforeEach(() => {
  clearPeers()
  rowInDom = true
  row.rect = { top: 100, bottom: 164, height: 64 }
  for (const k of Object.keys(dataset)) delete dataset[k]
})

describe('opening a chat from nothing', () => {
  it('names the row before the old picture and only the header after it (a name is on one element at a time)', () => {
    const m = openChatMotion('a', false)
    m.before!()
    expect(rowAvatar.name).toBe('vt-peer-av')
    expect(rowName.name).toBe('vt-peer-name')
    expect(headAvatar.name).toBeUndefined()
    m.after!()
    expect(rowAvatar.name).toBeUndefined()
    expect(rowName.name).toBeUndefined()
    expect(headAvatar.name).toBe('vt-peer-av')
    expect(headName.name).toBe('vt-peer-name')
    expect(scroll.name).toBe('vt-chat-body')
    m.done!()
    expect(named()).toEqual([])
  })

  it('on a phone-sized window the thread is not named (the column slides)', () => {
    const m = openChatMotion('a', true)
    m.before!()
    m.after!()
    expect(scroll.name).toBeUndefined()
    expect(headAvatar.name).toBe('vt-peer-av')
    m.done!()
    expect(named()).toEqual([])
  })

  it('does not name a row that is scrolled out of the list', () => {
    row.rect = { top: 900, bottom: 964, height: 64 }
    expect(visibleRow('a')).toBeUndefined()
    const m = openChatMotion('a', false)
    m.before!()
    expect(named()).toEqual([])
  })
})

describe('going back', () => {
  it('names the header first and the row after, when it is in view; plain otherwise', () => {
    const m = closeChatMotion('a')
    m.before!()
    expect(headAvatar.name).toBe('vt-peer-av')
    m.after!()
    expect(headAvatar.name).toBeUndefined()
    expect(rowAvatar.name).toBe('vt-peer-av')
    expect(dataset.vtDir).toBe('land')
    m.done!()
    expect(named()).toEqual([])
    rowInDom = false
    m.before!()
    m.after!()
    expect(dataset.vtDir).toBe('plain')
    m.done!()
  })
})

describe('markSwap', () => {
  it('sets html[data-swap] for a moment and clears it', () => {
    vi.useFakeTimers()
    markSwap()
    expect(dataset.swap).toBe('')
    vi.advanceTimersByTime(300)
    expect(dataset.swap).toBeUndefined()
    vi.useRealTimers()
  })
})
