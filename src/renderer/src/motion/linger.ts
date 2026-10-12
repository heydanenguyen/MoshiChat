import { useEffect, useState } from 'react'

/**
 * A thing that is on (the typing bubble) stays for the rest of its current animation cycle after it ends, so it comes to
 * rest instead of vanishing mid-motion. Pure part first: what the hook remembers and when that still counts.
 */
export interface Held {
  /** What the thread ended with while it was on: a different one (a message arrived) means there is nothing to wait for. */
  key: string | undefined
}

/** While it is on, remember the key it is on for; when it is off, what was remembered. */
export function nextHeld(active: boolean, held: Held | null, key: string | undefined): Held | null {
  if (!active) return held
  return held && held.key === key ? held : { key }
}

/** Whether to still show it: while on, or when it has just ended and nothing changed since (and motion is allowed). */
export function lingerShown(active: boolean, held: Held | null, key: string | undefined, reduced: boolean): boolean {
  if (active) return true
  return !reduced && held !== null && held.key === key
}

const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * `shown` is true while `active`, and after it for one more cycle: until `finish()` (call it from `animationiteration`),
 * at most `maxMs`. A change of `key` (the newest message) ends it at once: the message the person was typing has arrived.
 */
export function useLinger(active: boolean, key: string | undefined, maxMs = 2000): { shown: boolean; finish: () => void } {
  const [held, setHeld] = useState<Held | null>(null)
  const next = nextHeld(active, held, key)
  if (next !== held) setHeld(next)
  const shown = lingerShown(active, next, key, reducedMotion())
  useEffect(() => {
    if (active || !held) return
    const timer = setTimeout(() => setHeld(null), maxMs)
    return () => clearTimeout(timer)
  }, [active, held, maxMs])
  return { shown, finish: () => setHeld(null) }
}
