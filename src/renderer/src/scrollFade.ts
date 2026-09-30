import { useEffect, type RefObject } from 'react'

/**
 * Soft edges on a scroll area while there is more above or below: toggles `more-above` / `more-below`
 * on the element (the `.edge-fade` rules in app.css turn them into a mask). At the very top or bottom the
 * edge stays sharp, so the newest message above the composer is never faded. Pass a `key` when the element can
 * appear later than the component (it re-attaches when the key changes).
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, key?: unknown): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const update = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        el.classList.toggle('more-above', el.scrollTop > 2)
        el.classList.toggle('more-below', el.scrollTop + el.clientHeight < el.scrollHeight - 2)
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    // Content grows and shrinks without a scroll (new messages, folded sections, filters).
    const resize = new ResizeObserver(update)
    resize.observe(el)
    const mutations = new MutationObserver(update)
    mutations.observe(el, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', update)
      resize.disconnect()
      mutations.disconnect()
    }
  }, [ref, key])
}
