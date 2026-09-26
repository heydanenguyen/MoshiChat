import { useEffect, useMemo, useState } from 'react'
import type { WeatherInfo } from '@shared/types'
import { useStore, useT, useUnreadCounts } from '../store'
import { isMac } from '../utils'
import { greetingFor, weatherLabel } from '../greetings'

const ROTATE_MS = 90_000

/**
 * Thin, mac-like title bar across the whole window. On macOS the native
 * traffic lights sit inside it; elsewhere we draw our own. The middle shows
 * a rotating cheerful line with the local weather instead of the app name.
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
      {isMac ? (
        <span className="traffic-spacer" />
      ) : (
        <span className="traffic-lights no-drag">
          <button className="light close" onClick={action('close')} title={t('close')}>
            <svg viewBox="0 0 10 10" aria-hidden>
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
          <button className="light min" onClick={action('minimize')} title={t('minimize')}>
            <svg viewBox="0 0 10 10" aria-hidden>
              <path d="M2 5h6" />
            </svg>
          </button>
          <button className="light max" onClick={action('maximize')} title={maximized ? t('restore') : t('maximize')}>
            <svg viewBox="0 0 10 10" aria-hidden>
              {maximized ? <path d="M3 3h4v4H3z" /> : <path d="M5 2v6M2 5h6" />}
            </svg>
          </button>
        </span>
      )}
      <span className="titlebar-title">
        <Greeting />
      </span>
      <span className="titlebar-right" />
    </header>
  )
}

function Greeting(): JSX.Element | null {
  const enabled = useStore((s) => s.settings.greetings)
  const language = useStore((s) => s.settings.language)
  const accounts = useStore((s) => s.accounts)
  const unread = useUnreadCounts()
  const [weather, setWeather] = useState<WeatherInfo | undefined>()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = (): void => {
      void window.unison.app
        .weather()
        .then((w) => !cancelled && setWeather(w))
        .catch(() => undefined)
    }
    load()
    const weatherTimer = setInterval(load, 15 * 60_000)
    const rotate = setInterval(() => setTick((n) => n + 1), ROTATE_MS)
    return () => {
      cancelled = true
      clearInterval(weatherTimer)
      clearInterval(rotate)
    }
  }, [enabled])

  // The person's first name, preferring a real account over sample data.
  const firstName = useMemo(() => {
    const list = Object.values(accounts)
    const real = list.find((a) => !a.demo && a.displayName) ?? list[0]
    const name = real?.displayName?.trim() ?? ''
    if (!name) return ''
    const parts = name.split(/\s+/)
    // Vietnamese names put the given name last; western ones first.
    const vietnamese = /[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/i.test(name) || parts.length >= 3
    return vietnamese ? parts[parts.length - 1] : parts[0]
  }, [accounts])

  const line = useMemo(() => (enabled ? greetingFor({ language, name: firstName, weather, unread: unread.total, tick }) : undefined), [enabled, language, firstName, weather, unread.total, tick])

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
