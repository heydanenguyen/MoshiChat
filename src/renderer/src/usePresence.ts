import { useEffect, useRef, useState, type RefObject } from 'react'

/** Long enough for the 160-180 ms exit keyframes in app.css to finish before the element goes. */
export const EXIT_MS = 180

export type PresenceState = 'open' | 'closing'

/** Reduced motion has no exit animation to wait for, so the element can go at once. */
function exitDelay(ms: number): number {
  if (typeof window === 'undefined' || !window.matchMedia) return ms
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms
}

/** What to render for a flag that turns on and off: `mounted` stays true for `ms` after `open` turns false. */
export function presenceView(open: boolean, held: boolean): { mounted: boolean; state: PresenceState } {
  return { mounted: open || held, state: open ? 'open' : 'closing' }
}

/**
 * Keeps an element mounted while its exit animation plays. Render it while `mounted`, and put `state` in a
 * `data-state` attribute: the CSS runs the `*-out` keyframes on `[data-state="closing"]`.
 */
export function usePresence(open: boolean, ms = EXIT_MS): { mounted: boolean; state: PresenceState } {
  const [held, setHeld] = useState(open)
  useEffect(() => {
    if (open) {
      if (!held) setHeld(true)
      return
    }
    if (!held) return
    const id = setTimeout(() => setHeld(false), exitDelay(ms))
    return () => clearTimeout(id)
  }, [open, held, ms])
  return presenceView(open, held)
}

export interface PresenceEntry<T> {
  item: T
  closing: boolean
}

/**
 * The entries to draw for a list that gains and loses items: an item that left stays in its old place, marked
 * `closing`, until the caller drops it. Returns `prev` itself when nothing changed (safe to compare by identity).
 */
export function mergePresence<T>(prev: readonly PresenceEntry<T>[], items: readonly T[], key: (item: T) => string | number): readonly PresenceEntry<T>[] {
  const wanted = new Map(items.map((item) => [key(item), item]))
  const merged: PresenceEntry<T>[] = []
  const seen = new Set<string | number>()
  for (const entry of prev) {
    const k = key(entry.item)
    const current = wanted.get(k)
    if (current !== undefined) {
      merged.push({ item: current, closing: false })
      seen.add(k)
    } else {
      merged.push({ item: entry.item, closing: true })
    }
  }
  // New items join at the end; a closing item keeps its place until it is dropped.
  for (const item of items) if (!seen.has(key(item))) merged.push({ item, closing: false })
  const same = merged.length === prev.length && merged.every((e, i) => e.item === prev[i].item && e.closing === prev[i].closing)
  return same ? prev : merged
}

/** `usePresence` for a list (toasts): items that leave stay in `entries` as `closing` for `ms`. */
export function usePresenceList<T>(items: readonly T[], key: (item: T) => string | number, ms = EXIT_MS): readonly PresenceEntry<T>[] {
  const [entries, setEntries] = useState<readonly PresenceEntry<T>[]>(() => items.map((item) => ({ item, closing: false })))
  const next = mergePresence(entries, items, key)
  // Setting state while rendering is the supported way to derive it from a prop (no flash of a stale frame).
  if (next !== entries) setEntries(next)
  // One timer per leaving item, so a second exit never cuts the first one short.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    for (const entry of next) {
      if (!entry.closing) continue
      const id = String(key(entry.item))
      if (timers.current.has(id)) continue
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id)
          setEntries((cur) => cur.filter((e) => !(e.closing && String(key(e.item)) === id)))
        }, exitDelay(ms))
      )
    }
    // An item that came back before its exit ended keeps its place: forget the timer.
    for (const [id, timer] of timers.current) {
      if (!next.some((e) => e.closing && String(key(e.item)) === id)) {
        clearTimeout(timer)
        timers.current.delete(id)
      }
    }
  })
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])
  return next
}

// ---------------------------------------------------------------- focus for modal layers

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Visible, keyboard-reachable descendants, in tab order. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]') && el.getClientRects().length > 0)
}

interface Layer {
  container: HTMLElement
  opener: HTMLElement | null
  /** Where focus goes back to when the opener is gone (a menu item that closed with its menu): a CSS selector. */
  fallback: string | null
}
const layers: Layer[] = []

/**
 * Everything in `.app` that sits under the top-most layer is out of reach: the panes and any layer before it. What
 * comes after it in the DOM draws above it (a setup sheet opened from Settings, the toasts whose Undo must stay
 * reachable), so it stays live.
 */
function applyInert(): void {
  const app = document.querySelector('.app')
  if (!app) return
  const top = layers[layers.length - 1]?.container
  const children = [...app.children].filter((c): c is HTMLElement => c instanceof HTMLElement)
  const topIndex = top ? children.findIndex((c) => c === top || c.contains(top)) : -1
  children.forEach((child, i) => {
    // A layer that is fading out is inert by itself and must stay so.
    if (child.dataset.state === 'closing') return
    child.toggleAttribute('inert', topIndex >= 0 && i < topIndex && !child.classList.contains('toast-stack'))
  })
}

/**
 * A modal layer (sheet, forward picker, photo viewer): while `open`, focus moves into `containerRef`, Tab wraps
 * inside it, the rest of `.app` is `inert`, and closing hands focus back to what had it. Layers stack, so a sheet
 * opened over a sheet restores the first one's state when it closes.
 */
export function useSheetFocus(open: boolean, containerRef: RefObject<HTMLElement>, focusKey?: string): void {
  // Who had focus when the layer opened, read while rendering: by the time effects run, a field inside the layer
  // (autofocus) has already taken it.
  const opener = useRef<Element | null>(null)
  const wasOpen = useRef(false)
  if (open && !wasOpen.current) opener.current = document.activeElement
  useEffect(() => {
    wasOpen.current = open
  }, [open])
  useEffect(() => {
    const container = containerRef.current
    if (!open || !container) return
    const active = opener.current
    const from = active instanceof HTMLElement && !container.contains(active) ? active : null
    // A menu item that opened this layer goes away with its menu: its menu names the control to return to instead.
    const fallback = from?.closest('[data-focus-return]')?.getAttribute('data-focus-return') ?? null
    const layer: Layer = { container, opener: from, fallback }
    layers.push(layer)
    applyInert()

    const focusFirst = (): boolean => {
      if (container.contains(document.activeElement)) return true
      const first = focusablesIn(container)[0]
      first?.focus({ preventScroll: true })
      return !!first && container.contains(document.activeElement)
    }
    // Lazy sheets fill in after open: keep trying as content arrives (an autofocused field wins and ends it).
    let observer: MutationObserver | undefined
    if (!focusFirst()) {
      observer = new MutationObserver(() => {
        if (focusFirst()) observer?.disconnect()
      })
      observer.observe(container, { childList: true, subtree: true })
    }
    const giveUp = setTimeout(() => observer?.disconnect(), 1500)

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || layers[layers.length - 1] !== layer) return
      const items = focusablesIn(container)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const at = document.activeElement
      const inside = container.contains(at)
      // Focus somewhere else on purpose (a sheet opened from this one, the toasts): leave Tab alone.
      if (!inside && at && at !== document.body) return
      if (e.shiftKey && (at === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (at === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(giveUp)
      observer?.disconnect()
      const at = layers.indexOf(layer)
      if (at >= 0) layers.splice(at, 1)
      applyInert()
      // After the commit settles (a dev double-mount re-opens the same layer at once): only take focus back when it is
      // lost (inside the layer that just went), never from a field the person has moved to.
      queueMicrotask(() => {
        if (layers.some((l) => l.container === container)) return
        const now = document.activeElement
        const lost = !now || now === document.body || container.contains(now)
        if (!lost) return
        const target = layer.opener?.isConnected ? layer.opener : layer.fallback ? document.querySelector<HTMLElement>(layer.fallback) : null
        target?.focus({ preventScroll: true })
      })
    }
    // focusKey: another sheet in the same layer (Settings, then Add account) starts over with focus in the new one.
  }, [open, containerRef, focusKey])
}
