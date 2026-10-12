/**
 * Press feel (motion idea 19). The dip itself is CSS (`:active`, or the `pressed` class for Space/Enter): this listener only
 * tells an icon-only control where it was pressed, so it tilts up to 2° toward that point (`--rx` / `--ry`).
 */

/** The controls that dip when pressed (app.css, "Motion pack 2": keep the two lists the same). Rows are large surfaces and do not. */
export const PRESSABLE = '.icon-btn, .btn, .composer-send, .composer-mic, .nav-item, .quick-chip, .plat-chip, .narrow-tab, .suggest-chip, .conv-more, .chat-back, .empty-cta'

export const MAX_TILT = 2

export interface Point {
  x: number
  y: number
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The tilt (degrees) toward the pointer: the side that is pressed goes down. rotateY turns the right edge away from you,
 * rotateX the bottom edge towards you, so pressing right gives a positive `ry` and pressing low a negative `rx`.
 */
export function tiltFor(pointer: Point, rect: Box): { rx: number; ry: number } {
  if (rect.width <= 0 || rect.height <= 0) return { rx: 0, ry: 0 }
  const nx = Math.max(-1, Math.min(1, ((pointer.x - rect.left) / rect.width - 0.5) * 2))
  const ny = Math.max(-1, Math.min(1, ((pointer.y - rect.top) / rect.height - 0.5) * 2))
  const round = (n: number): number => Math.round(n * 100) / 100 + 0
  return { rx: round(-ny * MAX_TILT), ry: round(nx * MAX_TILT) }
}

/** Is it a control with no words (an icon button)? Those tilt; buttons with a label only dip. */
function iconOnly(el: HTMLElement): boolean {
  return !(el.textContent ?? '').trim() && !!el.querySelector('svg, img')
}

function target(e: Event): HTMLElement | null {
  const el = (e.target as Element | null)?.closest?.(PRESSABLE) as HTMLElement | null
  if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null
  return el
}

/** Registered once (App.tsx); returns what undoes it. */
export function installPress(): () => void {
  const down = (e: PointerEvent): void => {
    if (e.button !== 0) return
    const el = target(e)
    if (!el) return
    if (iconOnly(el)) {
      const { rx, ry } = tiltFor({ x: e.clientX, y: e.clientY }, el.getBoundingClientRect())
      el.style.setProperty('--rx', `${rx}deg`)
      el.style.setProperty('--ry', `${ry}deg`)
    } else {
      el.style.removeProperty('--rx')
      el.style.removeProperty('--ry')
    }
  }
  const keyDown = (e: KeyboardEvent): void => {
    if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return
    const el = target(e)
    if (!el || el !== document.activeElement) return
    el.style.removeProperty('--rx')
    el.style.removeProperty('--ry')
    el.classList.add('pressed')
  }
  const release = (e: Event): void => {
    if (e instanceof KeyboardEvent && e.key !== ' ' && e.key !== 'Enter') return
    for (const el of document.querySelectorAll('.pressed')) el.classList.remove('pressed')
  }
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('keydown', keyDown, true)
  document.addEventListener('keyup', release, true)
  window.addEventListener('blur', release)
  return () => {
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('keydown', keyDown, true)
    document.removeEventListener('keyup', release, true)
    window.removeEventListener('blur', release)
  }
}
