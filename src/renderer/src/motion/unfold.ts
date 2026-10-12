import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** How long the "send later" pill takes to unfold from its 36 px circle to its full width (and to fold back). */
export const UNFOLD_MS = 200
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'

/** How long an element stays mounted after it is turned off: its fold, or nothing when motion is reduced (pure, for tests). */
export const exitHoldMs = (ms: number, reducedMotion: boolean): number => (reducedMotion ? 0 : Math.max(0, ms))

/** The pill grows its width when its natural width is clearly larger than its circle; otherwise (the word is hidden) it only fades. */
export const unfoldKind = (full: number, small: number): 'width' | 'fade' => (full - small >= 2 ? 'width' : 'fade')

/** After an unfold the inline overflow/justify are cleared only if it ran to its end; a cancelled one (a fold took over) leaves them. */
export const unfoldCompleted = (playState: AnimationPlayState): boolean => playState === 'finished'

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** True while `on`, and for `ms` after it turns false (so an exit animation can play before the element goes). 0 when motion is reduced. */
export function useExitDelay(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(on)
  useEffect(() => {
    if (on) {
      setHeld(true)
      return
    }
    if (exitHoldMs(ms, reduced()) <= 0) {
      setHeld(false)
      return
    }
    const timer = setTimeout(() => setHeld(false), ms)
    return () => clearTimeout(timer)
  }, [on, ms])
  return on || held
}

/**
 * The "send later" pill unfolds from a 36 px circle to its natural width when it appears (the word fades in 70 ms
 * after it starts) and folds back when it goes (the word fades first). Width is measured before and after with the
 * Web Animations API, like the demo's `set()`. Where the word is hidden (narrow chats) both widths are the same and
 * the pill only fades. Nothing runs under reduced motion.
 */
export function useUnfold(pill: RefObject<HTMLElement | null>, label: RefObject<HTMLElement | null>, on: boolean, enabled: boolean): void {
  useLayoutEffect(() => {
    const el = pill.current
    if (!el || !enabled || reduced()) return
    for (const a of el.getAnimations()) a.cancel()
    const word = label.current
    for (const a of word?.getAnimations() ?? []) a.cancel()
    const small = el.getBoundingClientRect().height
    if (on) {
      const full = el.getBoundingClientRect().width
      if (unfoldKind(full, small) === 'fade') {
        el.animate([{ opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1 }], { duration: 160, easing: EASE_OUT })
        return
      }
      el.style.overflow = 'hidden'
      el.style.justifyContent = 'flex-start'
      const run = el.animate([{ width: `${small}px` }, { width: `${full}px` }], { duration: UNFOLD_MS, easing: EASE_OUT })
      word?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 70, easing: 'linear', fill: 'backwards' })
      const reset = (): void => {
        if (!unfoldCompleted(run.playState)) return
        el.style.overflow = ''
        el.style.justifyContent = ''
      }
      void run.finished.then(reset, reset)
      return
    }
    const full = el.getBoundingClientRect().width
    el.style.overflow = 'hidden'
    el.style.justifyContent = 'flex-start'
    if (unfoldKind(full, small) === 'width') {
      word?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'linear', fill: 'forwards' })
      el.animate([{ width: `${full}px` }, { width: `${small}px` }], { duration: UNFOLD_MS, easing: EASE_OUT, fill: 'forwards' })
    }
    // the last stretch also fades, so the circle does not just pop out
    el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: UNFOLD_MS, easing: 'linear', fill: 'forwards' })
  }, [pill, label, on, enabled])
}
