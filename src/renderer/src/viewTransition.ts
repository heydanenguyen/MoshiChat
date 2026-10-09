import { flushSync } from 'react-dom'

/** Which layout change is animating; the CSS in app.css ("view transitions") picks the motion from `html[data-vt]`. */
export type ViewTransitionKind = 'to-chat' | 'to-list' | 'sidebar' | 'details'

interface Transition {
  finished: Promise<void>
  ready: Promise<void>
  updateCallbackDone: Promise<void>
}
type Starter = (update: () => void) => Transition

let running = false

/**
 * Run a layout-changing update inside a View Transition when the browser has them, motion is allowed and no other
 * transition is under way (a second one would cut the first short); otherwise just run it.
 *
 * The update must be synchronous: the browser shows the old frame until it returns, so waiting on anything (an IPC
 * round trip) would make the click look dead. Apply the change to the store first and persist after. The type refuses
 * a function that returns a promise.
 */
export function withViewTransition<R>(kind: ViewTransitionKind, update: () => R extends PromiseLike<unknown> ? never : R): void {
  const start = (document as Document & { startViewTransition?: Starter }).startViewTransition?.bind(document)
  if (!start || running || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update()
    return
  }
  running = true
  const root = document.documentElement
  root.dataset.vt = kind
  const done = (): void => {
    running = false
    delete root.dataset.vt
  }
  let ran = false
  try {
    const transition = start(() => {
      ran = true
      // Render now: the browser takes the "after" picture as soon as this returns.
      flushSync(() => {
        update()
      })
    })
    // A skipped transition (window hidden, another one started) rejects these with an AbortError: nothing to report.
    transition.ready.catch(() => undefined)
    transition.updateCallbackDone.catch(() => undefined)
    transition.finished.then(done, done)
  } catch {
    done()
    if (!ran) update()
  }
}
