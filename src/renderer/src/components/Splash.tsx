import { useEffect, useState } from 'react'
import { LOGOS, LOGO_ORDER, type LogoId } from '@shared/logos'
import type { Language } from '@shared/types'
import { pickSplashLine } from '../greetings'
import { LogoMark } from './Logo'

const CACHE_KEY = 'unison.splash'
/** Long enough to see the wave and read the line, short enough never to feel like waiting. */
const MIN_VISIBLE_MS = 1800
const EXIT_MS = 480

export interface SplashPrefs {
  logo?: LogoId
  language?: Language
  name?: string
  theme?: 'light' | 'dark'
  last?: string
}

/**
 * Settings load asynchronously, so the launch screen reads the character, language and first name
 * remembered from the previous run (a per-device convenience; everything has a default).
 */
export function readSplashPrefs(): SplashPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as SplashPrefs
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

export function writeSplashPrefs(patch: SplashPrefs): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readSplashPrefs(), ...patch }))
  } catch {
    // storage unavailable: the next launch just uses the defaults
  }
}

/**
 * Launch screen: the chosen logo character pops in, waves hello and says a different friendly
 * line each time; it stays at least MIN_VISIBLE_MS and until the app is ready, then fades away
 * to reveal the app underneath.
 */
export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }): JSX.Element {
  const [prefs] = useState(readSplashPrefs)
  const logo = prefs.logo && LOGO_ORDER.includes(prefs.logo) ? prefs.logo : 'buddies'
  const language = prefs.language ?? 'vi'
  const [line] = useState(() => pickSplashLine(language, prefs.name ?? '', new Date().getHours(), prefs.last))
  const [minElapsed, setMinElapsed] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    writeSplashPrefs({ last: line.text })
    const timer = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [line.text])

  useEffect(() => {
    if (!ready || !minElapsed) return
    setLeaving(true)
    const timer = setTimeout(onDone, EXIT_MS)
    return () => clearTimeout(timer)
  }, [ready, minElapsed, onDone])

  const meta = LOGOS[logo]
  return (
    <div
      className={`splash ${leaving ? 'leaving' : ''}`}
      style={{ ['--splash-color' as string]: meta.color, ['--splash-bg' as string]: meta.background }}
      role="status"
      aria-label={line.text}
    >
      <div className="splash-glow" aria-hidden />
      <div className="splash-stage">
        <div className="splash-bubble" aria-hidden>
          <span className="splash-bubble-emoji">{line.emoji}</span>
          <span className="splash-bubble-text">{line.text}</span>
        </div>
        <div className="splash-character" aria-hidden>
          <span className="splash-wave">
            <LogoMark logo={logo} size={160} title="" />
          </span>
          <span className="splash-shadow" />
        </div>
        <div className="splash-word" aria-hidden>
          Unison
          <span className="splash-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </div>
  )
}
