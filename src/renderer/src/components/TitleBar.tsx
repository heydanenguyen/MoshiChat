import { useEffect, useMemo, useState } from 'react'
import type { WeatherInfo } from '@shared/types'
import { useStore, useT, useUnreadCounts } from '../store'
import { isMac } from '../utils'
import { firstNameOf, greetingFor, weatherLabel } from '../greetings'

const ROTATE_MS = 90_000

/**
 * Thin title bar across the whole window. On macOS the native traffic lights
 * sit inside it; on Windows and Linux we draw the usual caption buttons on the
 * right, where people reach for them. The middle shows a rotating cheerful line.
 */
export function TitleBar(): JSX.Element {
  const t = useT()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    return window.unison.onEvent((event) => {
      if (event.type === 'window:state') setMaximized(event.maximized)
    })
  }, [])

  const action = (kind: 'minimize' | 'maximize' | 'close') => (e: React.MouseEvent): void => {
    e.stopPropagation()
    window.unison.app.windowAction(kind)
  }

  return (
    <header className="titlebar drag" onDoubleClick={() => window.unison.app.windowAction('maximize')}>
      {isMac && <span className="traffic-spacer" />}
      <span className="titlebar-title">
        <Greeting />
      </span>
      {isMac ? (
        <span className="titlebar-right" />
      ) : (
        <span className="caption-buttons no-drag" onDoubleClick={(e) => e.stopPropagation()}>
          <button className="caption-btn" onClick={action('minimize')} title={t('minimize')} aria-label={t('minimize')}>
            <svg viewBox="0 0 10 10" aria-hidden>
              <path d="M0 5h10" />
            </svg>
          </button>
          <button className="caption-btn" onClick={action('maximize')} title={maximized ? t('restore') : t('maximize')} aria-label={maximized ? t('restore') : t('maximize')}>
            <svg viewBox="0 0 10 10" aria-hidden>
              {maximized ? <path d="M0.5 2.5h7v7h-7zM2.5 2.5v-2h7v7h-2" /> : <path d="M0.5 0.5h9v9h-9z" />}
            </svg>
          </button>
          <button className="caption-btn close" onClick={action('close')} title={t('close')} aria-label={t('close')}>
            <svg viewBox="0 0 10 10" aria-hidden>
              <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
            </svg>
          </button>
        </span>
      )}
    </header>
  )
}

function Greeting(): JSX.Element | null {
  const enabled = useStore((s) => s.settings.greetings)
  const weatherOn = useStore((s) => !!s.settings.weather)
  const language = useStore((s) => s.settings.language)
  const accounts = useStore((s) => s.accounts)
  const hasAccounts = Object.keys(accounts).length > 0
  const unread = useUnreadCounts()
  const [weather, setWeather] = useState<WeatherInfo | undefined>()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const rotate = setInterval(() => setTick((n) => n + 1), ROTATE_MS)
    return () => clearInterval(rotate)
  }, [enabled])

  // The weather needs a location lookup, so it only runs once the person has turned it on.
  useEffect(() => {
    if (!enabled || !weatherOn) {
      setWeather(undefined)
      return
    }
    let cancelled = false
    const load = (): void => {
      void window.unison.app
        .weather()
        .then((w) => !cancelled && setWeather(w))
        .catch(() => undefined)
    }
    load()
    const weatherTimer = setInterval(load, 15 * 60_000)
    return () => {
      cancelled = true
      clearInterval(weatherTimer)
    }
  }, [enabled, weatherOn])

  const firstName = useMemo(() => firstNameOf(Object.values(accounts)), [accounts])

  const line = useMemo(() => (enabled ? greetingFor({ language, name: firstName, weather, unread: unread.total, hasAccounts, tick }) : undefined), [enabled, language, firstName, weather, unread.total, hasAccounts, tick])

  if (!enabled || !line) return null
  const label = weather ? weatherLabel(weather, language) : undefined
  return (
    <span className="greeting" key={line.text}>
      <span className="greeting-emoji" aria-hidden>
        {line.emoji}
      </span>
      <span className="greeting-text">{line.text}</span>
      {label && !line.text.includes(label.temp) && <span className="greeting-weather">· {label.short}</span>}
    </span>
  )
}
