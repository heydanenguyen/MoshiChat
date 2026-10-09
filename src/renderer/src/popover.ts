import { useLayoutEffect, type RefObject } from 'react'

export type Span = { left: number; right: number }

/**
 * How far (in px, positive = to the right) a popover has to move so it stays
 * inside its boundary with `inset` px to spare on each side. When the popover
 * is wider than the boundary it hugs the left edge, so the start is always visible.
 */
export function popoverShift(box: Span, boundary: Span, inset = 8): number {
  const minLeft = boundary.left + inset
  const maxRight = boundary.right - inset
  if (box.left < minLeft) return minLeft - box.left
  if (box.right > maxRight) return Math.max(maxRight - box.right, minLeft - box.left)
  return 0
}

export type VSpan = { top: number; bottom: number }

/**
 * The max-height that stops a popover being cut off at the top or bottom of its panel (`margin` px to spare), or
 * undefined when it already fits. A popover that opens upward from the composer keeps its bottom edge and shrinks
 * from the top; one that opens downward keeps its top edge. Never below `floor`, so it stays usable in a tiny window.
 */
export function popoverClampHeight(box: VSpan, boundary: VSpan, margin = 12, floor = 120): number | undefined {
  const top = boundary.top + margin
  const bottom = boundary.bottom - margin
  const cutTop = box.top < top
  const cutBottom = box.bottom > bottom
  if (!cutTop && !cutBottom) return undefined
  const room = cutTop && cutBottom ? bottom - top : cutTop ? box.bottom - top : bottom - box.top
  return Math.max(floor, Math.floor(room))
}

/**
 * Keep an absolutely positioned popover (emoji, sticker, GIF and schedule
 * sheets) inside the panel that clips it. The sheets are anchored to their
 * toolbar button with `right`, so in a narrow chat (a split pane, a small
 * window) the left part used to run past the panel's edge and get cut off.
 */
export function useKeepInside(ref: RefObject<HTMLElement>, boundary = '.chat-col'): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = (first = false): void => {
      el.style.right = ''
      el.style.maxHeight = ''
      // Only the very first fit, before the open animation has begun, switches it off to measure the unscaled box (and
      // it starts from the top afterwards, as it would anyway). Later fits run once the animation has ended, when the
      // box is at its real size, and never touch it: toggling it would play the pop-in again.
      const animation = el.style.animation
      if (first) el.style.animation = 'none'
      const box = el.getBoundingClientRect()
      const panel = el.closest(boundary)?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight }
      if (first) el.style.animation = animation
      // A tall sheet opened near the top of a short window scrolls inside itself instead of being cut off.
      const maxHeight = popoverClampHeight(box, panel)
      if (maxHeight !== undefined) {
        el.style.maxHeight = `${maxHeight}px`
        if (getComputedStyle(el).overflowY === 'visible') el.style.overflowY = 'auto'
      } else el.style.overflowY = ''
      const shift = popoverShift(box, panel)
      if (!shift) return
      const right = parseFloat(getComputedStyle(el).right) || 0
      el.style.right = `${right - shift}px`
    }
    fit(true)
    // Later fits (a resize, a picker that filled in) must not switch the open animation off and on: that would play
    // it again. While it is still running they wait for it to end, and the box is measured then.
    let waiting = false
    const refit = (): void => {
      const running = el.getAnimations().filter((a) => a.playState === 'running')
      if (!running.length) return fit()
      if (waiting) return
      waiting = true
      void Promise.allSettled(running.map((a) => a.finished)).then(() => {
        waiting = false
        fit()
      })
    }
    window.addEventListener('resize', refit)
    // Pickers fill in after they open (results, a GIF grid): fit again whenever the box changes size. The guard keeps
    // fit's own max-height writes from calling it back in the same frame.
    let busy = false
    const observer = new ResizeObserver(() => {
      if (busy) return
      busy = true
      // Next frame, not inside the observer callback: fit writes styles, and a write that changes the size there is
      // what raises "ResizeObserver loop completed with undelivered notifications".
      requestAnimationFrame(() => {
        refit()
        busy = false
      })
    })
    observer.observe(el)
    return () => {
      window.removeEventListener('resize', refit)
      observer.disconnect()
    }
  }, [ref, boundary])
}
