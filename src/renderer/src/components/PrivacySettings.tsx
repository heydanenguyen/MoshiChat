import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useStore, useT } from '../store'
import { isMac } from '../utils'

type Form = 'none' | 'enable' | 'disable' | 'change'

const AUTO_LOCK = [1, 5, 15, 30, 60, 0] as const

/** A digits-only password field (4 to 8). */
function CodeField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange(v: string): void; autoFocus?: boolean }): JSX.Element {
  return (
    <label className="field passcode-field">
      <span className="field-label">{label}</span>
      <input
        className="field-input passcode-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
      />
    </label>
  )
}

/**
 * Settings → General → Security and privacy: the passcode lock (on, off, change the code, lock by itself after a
 * while, lock now) and keeping Moshi out of screen sharing. Turning the lock off or changing the code asks for the
 * current one; every check happens in the main process.
 */
export function PrivacySettings({ Row, Switch }: { Row: React.ComponentType<{ title: string; sub?: string; stack?: boolean; children?: React.ReactNode }>; Switch: React.ComponentType<{ on: boolean; onChange(next: boolean): void }> }): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const lock = useStore((s) => s.lock)
  const showToast = useStore((s) => s.showToast)
  const [form, setForm] = useState<Form>('none')
  const [current, setCurrent] = useState('')
  const [code, setCode] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const on = !!lock?.enabled

  const open = (next: Form): void => {
    setForm(next)
    setCurrent('')
    setCode('')
    setAgain('')
    setError(undefined)
  }

  const run = async (): Promise<void> => {
    setError(undefined)
    if (form !== 'disable') {
      if (code.length < 4) return setError(t('passcodeTooShort'))
      if (code !== again) return setError(t('passcodeMismatch'))
    }
    if (form !== 'enable' && current.length < 4) return setError(t('passcodeTooShort'))
    setBusy(true)
    try {
      const state =
        form === 'enable' ? await window.unison.lock.enable(code) : form === 'change' ? await window.unison.lock.change(current, code) : await window.unison.lock.disable(current)
      useStore.setState({ lock: state })
      showToast(t(form === 'enable' ? 'passcodeOnToast' : form === 'change' ? 'passcodeChangedToast' : 'passcodeOffToast'))
      open('none')
    } catch (err) {
      setError(/wrong-code/.test((err as Error).message) ? t('passcodeWrongCurrent') : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Row title={t('passcodeSetting')} sub={t('passcodeSettingHint')}>
        <Switch on={on || form === 'enable'} onChange={(next) => open(next ? (on ? 'none' : 'enable') : on ? 'disable' : 'none')} />
      </Row>
      {form !== 'none' && (
        <form
          className="settings-row stack passcode-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          <p className="settings-row-sub">{t(form === 'enable' ? 'passcodeEnableHint' : form === 'change' ? 'passcodeChangeHint' : 'passcodeDisableHint')}</p>
          <div className="passcode-fields">
            {form !== 'enable' && <CodeField label={t('passcodeCurrent')} value={current} onChange={setCurrent} autoFocus />}
            {form !== 'disable' && (
              <>
                <CodeField label={t('passcodeNew')} value={code} onChange={setCode} autoFocus={form === 'enable'} />
                <CodeField label={t('passcodeAgain')} value={again} onChange={setAgain} />
              </>
            )}
          </div>
          {error && (
            <p className="field-hint error" role="alert">
              {error}
            </p>
          )}
          <div className="passcode-actions">
            <button type="button" className="btn secondary small" onClick={() => open('none')}>
              {t('cancel')}
            </button>
            <button type="submit" className={`btn small ${form === 'disable' ? 'danger-solid' : 'primary'}`} disabled={busy}>
              {t(form === 'enable' ? 'passcodeEnable' : form === 'change' ? 'passcodeChange' : 'passcodeDisable')}
            </button>
          </div>
        </form>
      )}
      {on && form === 'none' && (
        <>
          <Row title={t('autoLock')} sub={t('autoLockHint')}>
            <select
              className="field-input settings-select"
              value={String(settings.appLock?.autoLock ?? 5)}
              onChange={(e) => void window.unison.lock.setAutoLock(Number(e.target.value))}
              aria-label={t('autoLock')}
            >
              {AUTO_LOCK.map((m) => (
                <option key={m} value={String(m)}>
                  {m === 0 ? t('autoLockNever') : m === 60 ? t('autoLockHour') : t('autoLockMinutes', { n: String(m) })}
                </option>
              ))}
            </select>
          </Row>
          <div className="settings-row backup-buttons">
            <button className="btn secondary" onClick={() => void window.unison.lock.lockNow()}>
              <Lock size={15} strokeWidth={2.2} /> {t('lockNow')}
              {isMac && <span className="btn-kbd">⌃⌘L</span>}
            </button>
            <button className="btn secondary" onClick={() => open('change')}>
              {t('passcodeChange')}
            </button>
          </div>
        </>
      )}
      <Row title={t('screenShareSetting')} sub={t('screenShareSettingHint')}>
        <Switch on={!!settings.hideFromScreenShare} onChange={(next) => void setSettings({ hideFromScreenShare: next })} />
      </Row>
    </>
  )
}
