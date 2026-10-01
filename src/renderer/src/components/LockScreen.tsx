import { useEffect, useRef, useState } from 'react'
import { Delete, Lock } from 'lucide-react'
import { useStore, useT } from '../store'
import { LogoMark } from './Logo'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const

/**
 * Moshi locked: nothing of the chats behind, just the character and a row of dots. Type the code (or tap the
 * keypad); it opens by itself once the last digit is in. Wrong codes shake the dots; after a few, the next try
 * waits and says how long. "Forgot the code?" explains the way out (signing out here) and asks before doing it.
 */
export function LockScreen(): JSX.Element {
  const t = useT()
  const lock = useStore((s) => s.lock)!
  const logo = useStore((s) => s.settings.logo)
  const [code, setCode] = useState('')
  // "Wrong code" stays until you type again; the dots shake once.
  const [wrong, setWrong] = useState(false)
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(lock.retryIn ?? 0)
  const [forgot, setForgot] = useState<'no' | 'ask' | 'working'>('no')
  const input = useRef<HTMLInputElement>(null)
  // The code as typed so far, read by fast key presses that land before the next render.
  const typed = useRef('')
  const length = lock.length ?? 6

  // Focus stays on the hidden field, whatever is clicked, so typing always works.
  useEffect(() => {
    const keep = (): void => {
      if (forgot === 'no') setTimeout(() => input.current?.focus(), 0)
    }
    keep()
    window.addEventListener('focus', keep)
    return () => window.removeEventListener('focus', keep)
  }, [forgot])

  const waiting = wait > 0
  // The wait is over: typing goes straight back into the code.
  useEffect(() => {
    if (!waiting && forgot === 'no') input.current?.focus()
  }, [waiting, forgot])

  // One timer for the whole wait, counting down a second at a time.
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setWait((w) => Math.max(0, w - 1000)), 1000)
    return () => clearInterval(timer)
  }, [waiting])

  const submit = async (value: string): Promise<void> => {
    if (busy || wait > 0 || value.length < 4) return
    setBusy(true)
    try {
      const result = await window.unison.lock.unlock(value)
      if (result.ok) return // the lock:state event takes the screen away
      setWrong(true)
      setShake(true)
      typed.current = ''
      setCode('')
      if (result.retryIn) setWait(result.retryIn)
      setTimeout(() => setShake(false), 450)
    } finally {
      setBusy(false)
    }
  }

  const type = (next: string): void => {
    if (busy || wait > 0) return
    const clean = next.replace(/\D/g, '').slice(0, length)
    typed.current = clean
    setCode(clean)
    if (clean) setWrong(false)
    if (clean.length === length) void submit(clean)
  }

  const press = (key: (typeof KEYS)[number]): void => {
    if (key === 'del') type(typed.current.slice(0, -1))
    else if (key) type(typed.current + key)
    input.current?.focus()
  }

  const seconds = Math.ceil(wait / 1000)
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title" onMouseDown={() => forgot === 'no' && input.current?.focus()}>
      <div className="lock-drag" aria-hidden />
      <div className="lock-panel">
        <LogoMark size={64} mood="calm" logo={logo} className="lock-logo" />
        <h1 id="lock-title" className="lock-title">
          <Lock size={15} strokeWidth={2.4} aria-hidden /> {t('lockTitle')}
        </h1>
        {forgot === 'no' ? (
          <>
            <p className={`lock-sub ${wrong || wait > 0 ? 'error' : ''}`} aria-live="polite">
              {wait > 0 ? t('lockWait', { n: String(seconds) }) : wrong ? t('lockWrong') : t('lockEnter')}
            </p>
            <div className={`lock-dots ${shake ? 'shake' : ''} ${wrong ? 'wrong' : ''}`} aria-hidden>
              {Array.from({ length }, (_, i) => (
                <span key={i} className={i < code.length ? 'on' : ''} />
              ))}
            </div>
            <input
              ref={input}
              className="lock-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label={t('lockEnter')}
              value={code}
              // Read-only, not disabled, while waiting: a disabled field loses focus and typing would go nowhere after.
              readOnly={wait > 0}
              onChange={(e) => type(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit(typed.current)
              }}
            />
            <div className="lock-keypad">
              {KEYS.map((key, i) =>
                key ? (
                  <button
                    key={i}
                    className={`lock-key ${key === 'del' ? 'del' : ''}`}
                    disabled={wait > 0 || busy}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => press(key)}
                    aria-label={key === 'del' ? t('lockDelete') : key}
                  >
                    {key === 'del' ? <Delete size={20} strokeWidth={2} /> : key}
                  </button>
                ) : (
                  <span key={i} />
                )
              )}
            </div>
            <button className="lock-forgot" onClick={() => setForgot('ask')}>
              {t('lockForgot')}
            </button>
          </>
        ) : (
          <div className="lock-reset" role="alertdialog" aria-labelledby="lock-reset-title">
            <p id="lock-reset-title" className="lock-reset-title">
              {t('lockResetTitle')}
            </p>
            <p className="lock-sub">{t('lockResetBody')}</p>
            <div className="lock-reset-actions">
              <button className="btn secondary" onClick={() => setForgot('no')} disabled={forgot === 'working'} autoFocus>
                {t('cancel')}
              </button>
              <button
                className="btn danger-solid"
                disabled={forgot === 'working'}
                onClick={() => {
                  setForgot('working')
                  void window.unison.lock.reset().catch(() => setForgot('ask'))
                }}
              >
                {t('lockResetConfirm')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
