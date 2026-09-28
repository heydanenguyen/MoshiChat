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
    const fit = (): void => {
      el.style.right = ''
      // The open animation starts scaled down; measure the box without it.
      const animation = el.style.animation
      el.style.animation = 'none'
      const box = el.getBoundingClientRect()
      const panel = el.closest(boundary)?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth }
      el.style.animation = animation
      const shift = popoverShift(box, panel)
      if (!shift) return
      const right = parseFloat(getComputedStyle(el).right) || 0
      el.style.right = `${right - shift}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [ref, boundary])
}
