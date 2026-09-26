import { useEffect, useRef, useState } from 'react'
import type { AuthPrompt } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { useStore, useT } from '../store'
import { PlatformIcon } from './PlatformIcon'

export function AuthPromptSheet({ prompt }: { prompt: AuthPrompt }): JSX.Element {
  const t = useT()
  const respondAuth = useStore((s) => s.respondAuth)
  const cancelAuth = useStore((s) => s.cancelAuth)
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue('')
    ref.current?.focus()
  }, [prompt.requestId])

  if (prompt.kind === 'qr') {
    return (
      <div className="backdrop" style={{ zIndex: 50 }}>
        <div className="sheet compact" role="dialog" aria-label={t('scanQr')}>
          <div className="sheet-header">
            <PlatformIcon platform={prompt.platform} size={28} style={{ borderRadius: 8 }} />
            <div className="sheet-title">{t('scanQr')}</div>
          </div>
          <div className="sheet-body qr-body">
            <p className="sheet-intro" style={{ margin: 0 }}>
              {t('qrHint', { app: PLATFORMS[prompt.platform].name })}
            </p>
            <div className="qr-frame">
              {prompt.qrDataUrl ? <img src={prompt.qrDataUrl} alt="QR" draggable={false} /> : <span className="spinner" />}
            </div>
            <div className="progress-row" style={{ justifyContent: 'center' }}>
              <span className="spinner" /> {prompt.note ?? t('qrWaiting')}
            </div>
          </div>
          <div className="sheet-footer">
            <button className="btn secondary" onClick={() => void cancelAuth(prompt.requestId)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const title = prompt.kind === 'phone' ? t('authPhoneTitle') : prompt.kind === 'code' ? t('authCodeTitle') : t('authPasswordTitle')
  const body = prompt.kind === 'phone' ? t('authPhoneBody') : prompt.kind === 'code' ? t('authCodeBody') : t('authPasswordBody')

  const submit = (): void => {
    if (!value.trim()) return
    void respondAuth(prompt.requestId, value.trim())
  }

  return (
    <div className="backdrop" style={{ zIndex: 50 }}>
      <div className="sheet compact" role="dialog" aria-label={title}>
        <div className="sheet-header">
          <PlatformIcon platform={prompt.platform} size={28} style={{ borderRadius: 8 }} />
          <div className="sheet-title">{title}</div>
        </div>
        <div className="sheet-body">
          <p className="sheet-intro" style={{ margin: 0 }}>
            {prompt.message ?? body}
          </p>
          <input
            ref={ref}
            className="field-input mono"
            type={prompt.kind === 'password' ? 'password' : 'text'}
            inputMode={prompt.kind === 'code' ? 'numeric' : prompt.kind === 'phone' ? 'tel' : 'text'}
            autoComplete={prompt.kind === 'password' ? 'current-password' : 'one-time-code'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={prompt.kind === 'phone' ? '+84…' : ''}
          />
        </div>
        <div className="sheet-footer">
          <button className="btn secondary" onClick={() => void cancelAuth(prompt.requestId)}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={submit} disabled={!value.trim()}>
            {t('continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
