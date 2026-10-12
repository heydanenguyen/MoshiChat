import { useEffect, useRef, useState } from 'react'
import { castById, specOf } from '@shared/pals-art'
import { useStore } from '../store'
import { PEEK_RETREAT_MS, PEEK_WOBBLE, isPalLogo, peekStep, type PeekPhase } from '../motion/mascot'
import { useMascotOn } from '../motion/useMascot'
import { LogoMark } from './Logo'
import { Pal } from './Pals'

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const SPEC = specOf(castById('hoa'), 'wow')

/**
 * An incoming call: a pal slides down over the title bar's right edge (a .30 spring), wobbles twice, and slips back when the
 * ring ends or the call is answered. The pal is the chosen Pals logo, or a pal of the cast when the logo is another one (the
 * Pals look keeps the Buddies out of it). Decorative (the call island carries the ring). On in the Pals look and with a Pals
 * logo in any look; not at all under reduced motion. 56 px from the right edge, so it never sits under the island (below
 * 600 px of window width it is left out: see app.css).
 */
export function MascotPeek(): JSX.Element | null {
  const on = useMascotOn()
  const palLogo = useStore((s) => isPalLogo(s.settings.logo))
  const ringing = useStore((s) => s.calls.incoming.length > 0)
  const [phase, setPhase] = useState<PeekPhase>('out')
  const pal = useRef<HTMLSpanElement>(null)
  const runs = useRef<Animation[]>([])
  const was = useRef<PeekPhase>('out')

  // The call state decides the phase.
  useEffect(() => setPhase((p) => peekStep(p, ringing, on, reduced())), [ringing, on])

  useEffect(() => {
    const el = pal.current
    const before = was.current
    was.current = phase
    if (!el) return
    // Where it is right now (mid-slide, or at rest) has to be read before its animations are cancelled.
    const from = getComputedStyle(el).translate
    runs.current.forEach((a) => a.cancel())
    runs.current = []
    if (phase === 'in') {
      const spring = getComputedStyle(document.documentElement).getPropertyValue('--spring-peek').trim() || 'ease-out'
      // A ring that comes back while it is slipping away goes down again from where it is.
      const start = before === 'leaving' && from !== 'none' ? from : '0 -100%'
      const slide = el.animate({ translate: [start, '0 4%'] }, { duration: 420, easing: spring, fill: 'forwards' })
      const wobble = el.animate(PEEK_WOBBLE, { duration: 900, delay: 420, iterations: 2, easing: 'ease-in-out' })
      runs.current = [slide, wobble]
    } else if (phase === 'leaving') {
      const leave = { duration: PEEK_RETREAT_MS, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' } as const
      const away = el.animate({ translate: [from === 'none' ? '0 4%' : from, '0 -100%'] }, leave)
      away.onfinish = () => setPhase('out')
      runs.current = [away]
    }
  }, [phase])

  if (phase === 'out') return null
  return (
    <div className="mascot-peek" aria-hidden>
      <span className="mascot-peek-pal" ref={pal}>
        {palLogo ? <LogoMark size={48} title="" className="peek-pal" /> : <Pal spec={SPEC} size={48} className="peek-pal" />}
      </span>
    </div>
  )
}
