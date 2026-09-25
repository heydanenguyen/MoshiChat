import { useEffect, useState } from 'react'
import { useStore, useT } from '../store'
import { isMac } from '../utils'

/**
 * Thin, mac-like title bar across the whole window. On macOS the native
 * traffic lights sit inside it; elsewhere we draw our own.
 */
export function TitleBar(): JSX.Element {
  const t = useT()
  const conversation = useStore((s) => (s.selectedId ? s.conversations[s.selectedId] : undefined))
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
        <strong>{t('appName')}</strong>
        {conversation && <span className="titlebar-sub"> · {conversation.title}</span>}
      </span>
      <span className="titlebar-right" />
    </header>
  )
}
