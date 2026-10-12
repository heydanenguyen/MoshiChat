import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Message } from '@shared/types'
import { useStore } from '../store'
import {
  HOP_MS,
  glanceEyes,
  hopKeyframes,
  hopMascot,
  incomingSince,
  isFollowing,
  isPalLogo,
  isSleepy,
  mascotOn,
  nextIdleAct,
  onMascotHop,
  watchEyes
} from './mascot'

/** The mascot behaviours run in the Pals look and with a Pals logo in any look (see `mascotOn`); the rest keep the plain blink and glance. */
export function useMascotOn(): boolean {
  return useStore((s) => mascotOn(s.settings.style, s.settings.logo))
}

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const resting = (): boolean => document.hidden || document.documentElement.classList.contains('window-idle')

/** The eyes (elements matching `selector`) inside `ref` follow the pointer while this is on screen. */
export function useEyeFollow(ref: RefObject<Element>, selector: string, enabled: boolean): void {
  useEffect(() => {
    const root = ref.current
    if (!enabled || !root) return
    return watchEyes(root, selector)
  }, [ref, selector, enabled])
}

/** True after 30 s without the pointer or the keyboard; any activity wakes it. `on` false = never asleep. */
export function useSleepy(on: boolean): boolean {
  const [asleep, setAsleep] = useState(false)
  useEffect(() => {
    if (!on) {
      setAsleep(false)
      return
    }
    let last = Date.now()
    let sleeping = false
    const wake = (): void => {
      last = Date.now()
      if (sleeping) {
        sleeping = false
        setAsleep(false)
      }
    }
    const check = (): void => {
      if (!sleeping && !document.hidden && isSleepy(last, Date.now())) {
        sleeping = true
        setAsleep(true)
      }
    }
    // A slow clock (once a second) rather than a timer reset on every mouse move.
    const timer = setInterval(check, 1000)
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    events.forEach((name) => document.addEventListener(name, wake, { capture: true, passive: true }))
    return () => {
      clearInterval(timer)
      events.forEach((name) => document.removeEventListener(name, wake, { capture: true }))
    }
  }, [on])
  return asleep
}

/** The logo's own idle life: a blink or a look aside every 2.6-5.6 s (in place of the root-wide blink clock). */
function useIdleActs(ref: RefObject<SVGSVGElement>, enabled: boolean): void {
  useEffect(() => {
    const svg = ref.current
    if (!enabled || !svg || reduced()) return
    let timer = 0
    const tick = (): void => {
      const { act, afterMs } = nextIdleAct(Math.random, { sleeping: false, following: isFollowing() })
      if (!resting() && !reduced()) {
        if (act === 'blink') {
          svg.classList.remove('m-blink')
          void svg.getBoundingClientRect()
          svg.classList.add('m-blink')
          setTimeout(() => svg.classList.remove('m-blink'), 340)
        } else if (act === 'glance') {
          glanceEyes(svg, '.buddy-eyes', (Math.random() * 2 - 1) * 2)
        }
      }
      timer = window.setTimeout(tick, afterMs)
    }
    timer = window.setTimeout(tick, 2600)
    return () => clearTimeout(timer)
  }, [ref, enabled])
}

/** The logo hops (squash and stretch, 560 ms) when a message arrives in the open chat. */
function useHop(ref: RefObject<SVGSVGElement>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    return onMascotHop(() => {
      const svg = ref.current
      if (svg && !document.hidden) svg.animate(hopKeyframes(), { duration: HOP_MS })
    })
  }, [ref, enabled])
}

/**
 * What a Pals logo does as a mascot. The sidebar mark (not the many other places the mark is drawn: settings tiles, stickers,
 * splash) follows the pointer, blinks and glances on its own clock and hops; the empty-state mark follows the pointer (and
 * sleeps, see EmptyState). A classic logo, even in the Pals look, is not a mascot (the stage and the peek use the cast then).
 * Returns whether it is on (the mark then wears the `mascot` class).
 */
export function useMascotLogo(ref: RefObject<SVGSVGElement>): boolean {
  const pal = useStore((s) => isPalLogo(s.settings.logo))
  const [host, setHost] = useState<'brand' | 'empty' | undefined>()
  useLayoutEffect(() => setHost(ref.current?.closest('.brand') ? 'brand' : ref.current?.closest('.empty-state') ? 'empty' : undefined), [ref])
  const active = pal && !!host
  useEyeFollow(ref, '.buddy-eyes', active)
  useIdleActs(ref, active && host === 'brand')
  useHop(ref, active && host === 'brand')
  return active
}

/** A message arrived in the open chat: the mascot hops. Only incoming, fresh, non-system ones count (see incomingSince). */
export function useIncomingHop(conversationId: string, messages: Message[] | undefined): void {
  const on = useMascotOn()
  // lastId: undefined = not loaded yet, null = loaded and empty (its first message hops).
  const mark = useRef<{ conversationId: string; lastId?: string | null }>({ conversationId })
  const loaded = messages !== undefined
  const lastId = loaded ? (messages[messages.length - 1]?.id ?? null) : undefined
  useEffect(() => {
    if (mark.current.conversationId !== conversationId) {
      // Another chat: its thread is the new baseline, nothing hops.
      mark.current = { conversationId, lastId }
      return
    }
    const before = mark.current.lastId
    mark.current = { conversationId, lastId }
    if (on && messages && before !== lastId && incomingSince(before, messages, Date.now())) hopMascot()
  }, [conversationId, lastId, messages, on])
}
