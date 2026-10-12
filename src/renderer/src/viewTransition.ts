import { flushSync } from 'react-dom'

/**
 * Which layout change is animating; the CSS in app.css ("view transitions", and the Motion pack sections) picks the motion from
 * `html[data-vt]`. `chat` is a chat opened on a wide window (the columns stay put: only the named parts move); `theme` is the
 * light/dark switch (a circle opening from the control).
 */
export type ViewTransitionKind = 'to-chat' | 'to-list' | 'chat' | 'sidebar' | 'details' | 'theme'

interface Transition {
  finished: Promise<void>
  ready: Promise<void>
  updateCallbackDone: Promise<void>
}
type Starter = (update: () => void | Promise<void>) => Transition

export interface TransitionOptions {
  /** `theme`: where the circle opens from, in viewport pixels. */
  origin?: { x: number; y: number }
  /** Lets the CSS tell two motions of one kind apart (`html[data-vt-dir]`): a chat opening from nothing (`fly`) or from another chat (`swap`). */
  dir?: string
  /** Runs right before the old picture is taken (name the elements that fly). Only when a transition really starts. */
  before?: () => void
  /**
   * Runs right after the update has rendered, still inside the transition (name the elements of the new picture). It may wait a
   * moment for something that appears a frame late (a windowed list's rows); the new picture is taken when it is done.
   */
  after?: () => void | Promise<void>
  /** Runs once the transition is over, or when none can start (no API, hidden window, reduced motion): take the names off again. */
  done?: () => void
  /** Runs instead of `done` when another transition is already running (it owns the names; only undo what this call changed itself). */
  skipped?: () => void
}

/** What keeps running when the person asks for less motion: these only fade (or hold still), the others do not run at all. */
const STILL_RUNS = new Set<ViewTransitionKind>(['details', 'theme', 'chat', 'to-chat', 'to-list'])

/** How long the circle takes to open, and its curve when `--ease-spring` cannot be read. */
export const REVEAL_MS = 480
const REVEAL_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** The radius that covers the window from a point: the distance to the farthest corner. */
export function revealRadius(x: number, y: number, width: number, height: number): number {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y))
}

/** The two clip-paths the new picture grows between. */
export function revealClip(x: number, y: number, radius: number): [string, string] {
  return [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`]
}

/** The centre of an element, for the theme circle to grow from. */
export function centreOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

// The control that was just used (a setting is saved over IPC, so the theme is applied a moment after the click). Only a change
// that follows one of these animates: the OS switching between light and dark does not.
const ORIGIN_TTL_MS = 2000
let pendingOrigin: { x: number; y: number; at: number } | undefined

/** Remember where the theme control is; without an element (the command palette) the circle opens from the window's centre. */
export function noteThemeOrigin(el?: Element | null, now = Date.now()): void {
  const at = el ? centreOf(el) : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  pendingOrigin = { ...at, at: now }
}

/** The origin noted by a control a moment ago (once), or nothing. */
export function takeThemeOrigin(now = Date.now()): { x: number; y: number } | undefined {
  const o = pendingOrigin
  pendingOrigin = undefined
  return o && now - o.at <= ORIGIN_TTL_MS ? { x: o.x, y: o.y } : undefined
}

let running = false

/**
 * Run a layout-changing update inside a View Transition when the browser has them, motion is allowed and no other
 * transition is under way (a second one would cut the first short); otherwise just run it.
 *
 * The update must be synchronous: the browser shows the old frame until it returns, so waiting on anything (an IPC
 * round trip) would make the click look dead. Apply the change to the store first and persist after. The type refuses
 * a function that returns a promise.
 */
export function withViewTransition<R>(kind: ViewTransitionKind, update: () => R extends PromiseLike<unknown> ? never : R, opts: TransitionOptions = {}): void {
  const start = (document as Document & { startViewTransition?: Starter }).startViewTransition?.bind(document)
  // Reduced motion: no view transition, except the ones that only fade (the Details pane, the theme, a chat opening).
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (running) {
    update()
    opts.skipped?.()
    return
  }
  if (!start || document.hidden || (reduced && !STILL_RUNS.has(kind))) {
    update()
    opts.done?.()
    return
  }
  running = true
  const root = document.documentElement
  root.dataset.vt = kind
  // The Details pane has its own motion each way: open when no pane is on screen yet, close when one is.
  if (kind === 'details') root.dataset.vtDir = document.querySelector('.details-col') ? 'close' : 'open'
  else if (opts.dir) root.dataset.vtDir = opts.dir
  const done = (): void => {
    running = false
    delete root.dataset.vt
    delete root.dataset.vtDir
    opts.done?.()
  }
  let ran = false
  try {
    opts.before?.()
    const transition = start(() => {
      ran = true
      // Render now: the browser takes the "after" picture as soon as this returns.
      // (The theme only writes an attribute, and is started from an effect, where flushSync would warn.)
      if (kind === 'theme') update()
      else
        flushSync(() => {
          update()
        })
      return opts.after?.()
    })
    // A skipped transition (window hidden, another one started) rejects these with an AbortError: nothing to report.
    transition.ready.then(
      () => {
        if (kind === 'theme' && opts.origin && !reduced) reveal(root, opts.origin)
      },
      () => undefined
    )
    transition.updateCallbackDone.catch(() => undefined)
    transition.finished.then(done, done)
  } catch {
    done()
    if (!ran) update()
  }
}

/** The new picture of the page opens as a circle from the control (the old one stays underneath). */
function reveal(root: HTMLElement, origin: { x: number; y: number }): void {
  const radius = revealRadius(origin.x, origin.y, window.innerWidth, window.innerHeight)
  const ease = getComputedStyle(root).getPropertyValue('--ease-spring').trim() || REVEAL_EASE
  try {
    root.animate({ clipPath: revealClip(origin.x, origin.y, radius) }, { duration: REVEAL_MS, easing: ease, pseudoElement: '::view-transition-new(root)' })
  } catch {
    // no pseudo-element animations: the new picture just appears
  }
}
