import { useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent, type FocusEvent } from 'react'
import { ArrowUpRight, Phone, Video } from 'lucide-react'
import type { CallState, IncomingCall } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { useStore, useT } from '../store'
import { callTimer } from '../calls'
import {
  END_HOLD_MS,
  ISLAND_MS,
  callPhase,
  islandSize,
  islandSprings,
  newestIncoming,
  nextIslandState,
  phaseEvent,
  type CallPhase,
  type IslandState
} from '../motion/island'
import { Avatar } from './Avatar'

type Active = NonNullable<CallState['active']>

const EASE_FALLBACK = 'cubic-bezier(0.16, 1, 0.3, 1)'
const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** React 18 has no `inert` prop: a layer that is not showing leaves the tab order and the accessibility tree with this attribute. */
const inertProps = (off: boolean): Record<string, string> => (off ? { inert: '' } : {})

/** The clock, ticking once a second while `on` (not while the window is in the background). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [on])
  return now
}

/** The five waveform bars (CSS moves them while the call is live; they stand still at 60 % in reduced motion and when the window is hidden). */
function Wave(): JSX.Element {
  return (
    <span className="isl-wave" aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

/**
 * Morphs the pill from where it is now (measured, so a morph that is cut short by the next one continues from the real size) to a
 * state: width, height and corner radius on the island springs (`--spring-isl-*`, set on the root), with the previous animations
 * cancelled first. Sets the final sizes as CSS variables, so the pill is right with no animation at all.
 */
function morph(el: HTMLElement, anims: Animation[], from: IslandState, to: IslandState, flat: boolean): void {
  const rect = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const r0 = parseFloat(cs.borderTopLeftRadius) || 0
  for (const a of anims.splice(0)) a.cancel()
  const target = islandSize(to, flat)
  el.style.setProperty('--w', `${target.w}px`)
  el.style.setProperty('--h', `${target.h}px`)
  el.style.setProperty('--rad', `${target.r}px`)
  if (from === to || reduced()) return
  const sp = islandSprings({ w: rect.width, h: rect.height, r: r0 }, to)
  const easing = (name: string): string => cs.getPropertyValue(name).trim() || EASE_FALLBACK
  const ms = parseFloat(cs.getPropertyValue('--spring-isl-grow-ms')) || ISLAND_MS
  const run = (keyframes: PropertyIndexedKeyframes, name: string, delay = 0): void => {
    anims.push(el.animate(keyframes, { duration: ms, easing: easing(name), delay, fill: 'backwards' }))
  }
  if (Math.abs(rect.width - target.w) > 0.5) run({ width: [`${rect.width}px`, `${target.w}px`] }, sp.width)
  if (Math.abs(rect.height - target.h) > 0.5) run({ height: [`${rect.height}px`, `${target.h}px`] }, sp.height, sp.heightDelay)
  if (Math.abs(r0 - target.r) > 0.5) run({ borderRadius: [`${r0}px`, `${target.r}px`] }, sp.radius)
  // Appearing: the dot fades in as it grows. Going: it fades out at the end of its shrink.
  if (from === 'idle') anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out', fill: 'backwards' }))
  if (to === 'idle') anims.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: ms - 200, easing: 'ease-out', fill: 'forwards' }))
}

/** The ring: who calls, and the two answers. One tap each; the buttons rest until the main process reports the call gone. */
function RingContent({ call }: { call: IncomingCall }): JSX.Element {
  const t = useT()
  const answerCall = useStore((s) => s.answerCall)
  const declineCall = useStore((s) => s.declineCall)
  const [busy, setBusy] = useState(false)
  useEffect(() => setBusy(false), [call.id])
  const act = (run: (id: string) => Promise<void>): void => {
    setBusy(true)
    void run(call.id).finally(() => setBusy(false))
  }
  const label = call.kind === 'video' ? t('callIncomingVideo') : t('callIncomingVoice')
  return (
    <>
      <span className="isl-rw">
        <Avatar name={call.peerName} url={call.peerAvatarUrl} size={32} platform={call.platform} />
      </span>
      <span className="isl-text">
        <b className="isl-nm">{call.peerName}</b>
        <small>{label}</small>
      </span>
      <button
        type="button"
        className="isl-ib isl-decline"
        aria-label={t('callDecline')}
        title={t('callDecline')}
        disabled={busy}
        onClick={() => act(declineCall)}
      >
        <Phone size={16} strokeWidth={2.2} />
      </button>
      <button type="button" className="isl-ib isl-answer" aria-label={t('callAnswer')} title={t('callAnswer')} disabled={busy} onClick={() => act(answerCall)}>
        {call.kind === 'video' ? <Video size={16} strokeWidth={2.2} /> : <Phone size={16} strokeWidth={2.2} />}
      </button>
    </>
  )
}

/**
 * The call pill under the title bar (idea 16): one dark pill that morphs between a ring, a slim live pill (timer + waveform), an
 * expanded one (hover or focus) with the controls, and "Ended" for two seconds. Each state is a layer of fixed size, centred, that
 * cross-fades with a blur while the pill itself grows or shrinks around it, so text never slides.
 */
export function CallIsland(): JSX.Element | null {
  const t = useT()
  const incoming = useStore((s) => s.calls.incoming)
  const active = useStore((s) => s.calls.active)
  const flat = useStore((s) => s.settings.style === 'mono')
  const endCall = useStore((s) => s.endCall)

  const [state, dispatch] = useReducer(nextIslandState, 'idle' as IslandState)
  const pill = useRef<HTMLDivElement>(null)
  const anims = useRef<Animation[]>([])
  const applied = useRef<IslandState>('idle')
  const suppress = useRef(false)
  const prevFocus = useRef<HTMLElement | null>(null)
  const [ended, setEnded] = useState('')
  // Each layer keeps the last thing it showed while it fades out.
  const lastRing = useRef<IncomingCall>()
  const lastActive = useRef<Active>()
  const ringCall = newestIncoming(incoming)
  if (ringCall) lastRing.current = ringCall
  if (active) lastActive.current = active
  const ring = ringCall ?? lastRing.current
  const live = active ?? lastActive.current
  const convTitle = useStore((s) => (live?.conversationId ? s.conversations[live.conversationId]?.title : undefined))
  const liveTitle = convTitle ?? (live ? PLATFORMS[live.platform].name : '')
  const liveAvatar = useStore((s) => (live?.conversationId ? s.conversations[live.conversationId]?.avatarUrl : undefined))

  // The call state (the store keeps it in step with the main process) drives the pill; hover and focus only expand a live call.
  const phase: CallPhase = callPhase({ incoming, active })
  const prevPhase = useRef<CallPhase>('none')
  useEffect(() => {
    const event = phaseEvent(prevPhase.current, phase)
    prevPhase.current = phase
    if (!event) return
    if (event === 'hangup' && lastActive.current) setEnded(callTimer(lastActive.current.startedAt, Date.now()))
    dispatch(event)
  }, [phase])

  // "Ended" stays for two seconds.
  useEffect(() => {
    if (state !== 'end') return
    const id = setTimeout(() => dispatch('settle'), END_HOLD_MS)
    return () => clearTimeout(id)
  }, [state])

  // Mounted while not idle, and until the shrink to the dot has played.
  const [gone, setGone] = useState(true)
  if (state !== 'idle' && gone) setGone(false)
  useEffect(() => {
    if (state !== 'idle' || gone) return
    const id = setTimeout(() => {
      applied.current = 'idle'
      setGone(true)
    }, reduced() ? 0 : ISLAND_MS + 60)
    return () => clearTimeout(id)
  }, [state, gone])

  useLayoutEffect(() => {
    const el = pill.current
    if (!el) return
    const from = applied.current
    applied.current = state
    morph(el, anims.current, from, state, flat)
  }, [state, flat, gone])
  // When the pill stops being expandable, Escape's hold is over; and focus that sat on a layer that went away goes back to where it came from.
  useLayoutEffect(() => {
    if (state !== 'live' && state !== 'open') suppress.current = false
    const el = pill.current
    const a = document.activeElement
    if (!el || !a || !el.contains(a)) return
    const stranded = a === el ? state === 'end' || state === 'idle' : !!a.closest('.isl-layer:not(.on)')
    if (!stranded) return
    const back = prevFocus.current
    prevFocus.current = null
    if (back && back.isConnected && !el.contains(back)) back.focus({ preventScroll: true })
    else (a as HTMLElement).blur()
  }, [state])
  useEffect(
    () => () => {
      for (const a of anims.current.splice(0)) a.cancel()
    },
    []
  )

  const now = useNow(state === 'live' || state === 'open')
  const timer = live ? callTimer(live.startedAt, now) : ''

  const focusCall = (): void => void window.unison.calls.focus().catch(() => undefined)
  const expandable = state === 'live' || state === 'open'
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || state !== 'open') return
    e.stopPropagation()
    suppress.current = true
    dispatch('collapse')
    pill.current?.focus({ preventScroll: true })
  }
  const onPointerLeave = (): void => {
    suppress.current = false
    const el = pill.current
    if (!el) return
    // Keyboard focus inside keeps it open; a mouse click's focus does not.
    if (el.matches(':focus-visible') || el.querySelector(':focus-visible')) return
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    dispatch('collapse')
  }
  const onBlur = (e: FocusEvent): void => {
    const el = pill.current
    if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return
    suppress.current = false
    if (!el.matches(':hover')) dispatch('collapse')
  }
  const onFocus = (e: FocusEvent): void => {
    const from = e.relatedTarget
    if (from instanceof HTMLElement && !pill.current?.contains(from)) prevFocus.current = from
    if (!suppress.current) dispatch('expand')
  }
  const expand = (): void => {
    if (!suppress.current) dispatch('expand')
  }

  const announce =
    state === 'ring' && ring
      ? `${ring.kind === 'video' ? t('callIncomingVideo') : t('callIncomingVoice')}: ${ring.peerName}`
      : state === 'live' || state === 'open'
        ? t('callInCallWith', { name: liveTitle })
        : state === 'end'
          ? t('callEnded', { time: ended })
          : ''
  // The live region stays mounted while the pill is gone, so the text that appears with a new ring is announced (a region inserted with its text is not).
  return (
    <>
      <div className="isl-sr" role="status" aria-live="assertive" aria-atomic>
        {announce}
      </div>
      {!gone && (
        <div className="call-island-host">
          <div
            ref={pill}
            className="call-island"
            data-s={state}
            role="group"
            aria-label={state === 'open' ? t('callCollapse') : state === 'live' ? t('callExpand') : announce}
            tabIndex={expandable ? 0 : -1}
            onPointerEnter={expand}
            onPointerLeave={onPointerLeave}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            onClick={(e) => {
              // The whole pill is one click back to the call window (the buttons of the open pill do their own thing).
              if (expandable && !(e.target as Element).closest('button')) focusCall()
            }}
          >
            <div className={`isl-layer is-ring${state === 'ring' ? ' on' : ''}`} {...inertProps(state !== 'ring')}>
              {ring && <RingContent call={ring} />}
            </div>
            <div className={`isl-layer is-live${state === 'live' ? ' on' : ''}`} {...inertProps(state !== 'live')}>
              <span className="isl-livel">
                <i className="isl-dot" aria-hidden />
                <b className="isl-tm">{timer}</b>
              </span>
              <Wave />
            </div>
            <div className={`isl-layer is-open${state === 'open' ? ' on' : ''}`} {...inertProps(state !== 'open')}>
              <div className="isl-top">
                <Avatar name={liveTitle} url={liveAvatar} size={28} />
                <span className="isl-text">
                  <b className="isl-nm">{liveTitle}</b>
                  <small className="isl-tm">{timer}</small>
                </span>
                <Wave />
              </div>
              <div className="isl-bot">
                <button type="button" className="isl-back" onClick={focusCall}>
                  <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden />
                  <span>{t('callBackTo')}</span>
                </button>
                <button type="button" className="isl-ib isl-end" aria-label={t('callEnd')} title={t('callEnd')} onClick={() => void endCall()}>
                  <Phone size={20} strokeWidth={2.2} />
                </button>
              </div>
            </div>
            <div className={`isl-layer is-end${state === 'end' ? ' on' : ''}`} {...inertProps(state !== 'end')}>
              <Phone size={15} strokeWidth={2.2} className="isl-endicon" aria-hidden />
              <b className="isl-tm">{t('callEnded', { time: ended })}</b>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
