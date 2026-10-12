import { withViewTransition, type TransitionOptions } from '../viewTransition'

/**
 * Shared elements for opening and closing a chat (idea 7): the list row's avatar and name get the same
 * `view-transition-name` as the chat header's, and the browser flies one into the other. A name must be unique on the page, and the
 * list is windowed (only a few rows exist), so at most one row carries it at a time, only while the transition runs. The names are
 * set as inline styles from here, never through props, so the memoised rows are not touched.
 */
export const PEER_AVATAR = 'vt-peer-av'
export const PEER_NAME = 'vt-peer-name'
export const CHAT_BODY = 'vt-chat-body'

const tagged = new Set<HTMLElement>()

function tag(el: Element | null | undefined, name: string): void {
  if (!(el instanceof HTMLElement)) return
  el.style.setProperty('view-transition-name', name)
  tagged.add(el)
}

/** Take every name off again (the elements that were tagged may be gone: that is fine). */
export function clearPeers(): void {
  for (const el of tagged) el.style.removeProperty('view-transition-name')
  tagged.clear()
}

/** The row of a chat in the list, when it is on screen (the list is windowed and scrolls: a row outside the view does not fly). */
export function visibleRow(id: string): HTMLElement | undefined {
  const row = document.querySelector<HTMLElement>(`.conv-item[data-id="${CSS.escape(id)}"]`)
  const list = row?.closest('.conv-list')
  if (!row || !list) return undefined
  const r = row.getBoundingClientRect()
  const l = list.getBoundingClientRect()
  return r.height > 0 && r.bottom > l.top && r.top < l.bottom ? row : undefined
}

function tagRow(id: string): void {
  const row = visibleRow(id)
  if (!row) return
  tag(row.querySelector('.avatar'), PEER_AVATAR)
  tag(row.querySelector('.conv-name'), PEER_NAME)
}

/** The header of the pane that shows the chat (the active one when the window is split), and its thread. */
function tagHeader(body: boolean): void {
  const pane = document.querySelector('.chat-pane.active') ?? document.querySelector('.chat-pane')
  if (!pane) return
  tag(pane.querySelector('.chat-header > .avatar'), PEER_AVATAR)
  tag(pane.querySelector('.chat-header-name'), PEER_NAME)
  if (body) tag(pane.querySelector('.chat-scroll'), CHAT_BODY)
}

/**
 * Opening a chat from nothing (a chat that replaces another one does not use a view transition, see `markSwap`): the row's avatar
 * and name fly into the header. On a phone-sized window (`narrow`) the whole column slides, so only they move; on a wide window the
 * thread also fades up.
 */
export function openChatMotion(id: string, narrow: boolean): TransitionOptions {
  return {
    dir: 'fly',
    before: () => {
      clearPeers()
      tagRow(id)
    },
    // The old picture is taken: the names move to the new places (the same name on two elements would abort the transition).
    after: () => {
      clearPeers()
      tagHeader(!narrow)
    },
    done: clearPeers
  }
}

const SWAP_MS = 220
let swapTimer: ReturnType<typeof setTimeout> | undefined

/**
 * One chat replacing another on a wide window: no view transition (the page cannot be clicked, hovered or scrolled while one runs, and
 * this happens on every click while browsing the list). `html[data-swap]` for a moment lets the header and the thread fade in with a
 * plain CSS entry animation instead.
 */
export function markSwap(): void {
  const root = document.documentElement
  if (swapTimer) clearTimeout(swapTimer)
  delete root.dataset.swap
  void root.offsetWidth
  root.dataset.swap = ''
  swapTimer = setTimeout(() => {
    delete root.dataset.swap
    swapTimer = undefined
  }, SWAP_MS)
}

const rowSelector = (id: string): string => `.conv-item[data-id="${CSS.escape(id)}"]`

/**
 * On a phone-sized window the list is hidden behind the chat, and a windowed list draws no rows while it has no size, so there
 * would be no row to fly back to. Show the list, unseen (no paint, no input), for two frames so it draws them. Returns what puts it
 * back as it was.
 */
async function drawListRows(id: string): Promise<() => void> {
  const list = document.querySelector<HTMLElement>('.list-col')
  if (!list || document.querySelector(rowSelector(id)) || getComputedStyle(list).display !== 'none') return () => undefined
  const style: Record<string, string> = { display: 'flex', position: 'absolute', inset: '0', visibility: 'hidden', 'pointer-events': 'none' }
  for (const [k, v] of Object.entries(style)) list.style.setProperty(k, v)
  const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  const limit = new Promise<void>((resolve) => setTimeout(resolve, 120))
  await Promise.race([frame().then(frame), limit])
  return () => {
    for (const k of Object.keys(style)) list.style.removeProperty(k)
  }
}

/** The motion options for going back to the list: the header's avatar and name fly to the row when it is in view, else they leave with the column. */
export function closeChatMotion(id: string): TransitionOptions {
  return {
    before: () => {
      clearPeers()
      tagHeader(false)
    },
    after: () => {
      clearPeers()
      tagRow(id)
      document.documentElement.dataset.vtDir = visibleRow(id) ? 'land' : 'plain'
    },
    done: clearPeers
  }
}

/** Back to the list (a phone-sized window): lets the list draw its rows first (two frames, unseen), then runs the transition. */
export async function closeChat(id: string, update: () => void): Promise<void> {
  // Reduced motion: nothing flies, so the list does not need to draw its rows first.
  const restore = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? () => undefined : await drawListRows(id)
  const motion = closeChatMotion(id)
  withViewTransition('to-list', update, {
    ...motion,
    // The list stays "shown, unseen" until the update has made it really visible: hiding it first would tell the windowed list its
    // size is 0 again before the transition's callback runs, and it would drop the rows.
    after: () => {
      restore()
      motion.after?.()
    },
    done: () => {
      restore()
      motion.done?.()
    },
    // Another transition is under way: it owns the names, only the list is ours to put back.
    skipped: restore
  })
}
