import { useState } from 'react'
import { ChevronLeft, ExternalLink, ShieldAlert, X } from 'lucide-react'
import type { Platform } from '@shared/types'
import { PLATFORMS, PLATFORM_ORDER } from '@shared/types'
import { useStore, useT } from '../store'
import { PlatformIcon } from './PlatformIcon'

const DOCS: Partial<Record<Platform, string>> = {
  telegram: 'https://my.telegram.org/apps',
  messenger: 'https://developers.facebook.com/docs/messenger-platform/get-started',
  instagram: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/messaging'
}

export function AddAccountSheet({ initialPlatform }: { initialPlatform?: Platform }): JSX.Element {
  const t = useT()
  const closeSheet = useStore((s) => s.closeSheet)
  const addAccount = useStore((s) => s.addAccount)
  const [platform, setPlatform] = useState<Platform | undefined>(initialPlatform)
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [pageId, setPageId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const isMeta = platform === 'messenger' || platform === 'instagram'
  const isQr = platform === 'zalo' || platform === 'whatsapp'
  const valid =
    platform === 'telegram'
      ? /^\d+$/.test(apiId.trim()) && apiHash.trim().length >= 16
      : isMeta
        ? pageId.trim().length > 0 && accessToken.trim().length > 20
        : isQr

  const submit = async (): Promise<void> => {
    if (!platform || !valid) return
    setBusy(true)
    setError(undefined)
    try {
      if (platform === 'telegram') await addAccount({ platform, apiId: Number(apiId.trim()), apiHash: apiHash.trim() })
      else if (platform === 'messenger' || platform === 'instagram') await addAccount({ platform, pageId: pageId.trim(), accessToken: accessToken.trim() })
      else await addAccount({ platform })
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  const openDocs = (url?: string) => (e: React.MouseEvent): void => {
    e.preventDefault()
    if (url) void window.unison.app.openExternal(url)
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeSheet()}>
      <div className={`sheet ${platform ? '' : 'wide'}`} role="dialog" aria-label={t('addAccount')}>
        <div className="sheet-header">
          {platform && !busy && (
            <button className="icon-btn" onClick={() => setPlatform(undefined)} title={t('back')}>
              <ChevronLeft size={18} strokeWidth={2.4} />
            </button>
          )}
          <div className="sheet-title">{platform ? PLATFORMS[platform].name : t('addAccount')}</div>
          {!busy && (
            <button className="icon-btn" onClick={closeSheet} title={t('close')}>
              <X size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>

        {!platform && (
          <div className="sheet-body">
            <p className="sheet-intro" style={{ margin: 0 }}>
              {t('choosePlatform')}
            </p>
            <div className="platform-grid">
              {PLATFORM_ORDER.map((p) => (
                <button key={p} className="platform-card" onClick={() => setPlatform(p)}>
                  <PlatformIcon platform={p} size={48} style={{ borderRadius: 14 }} />
                  <span className="platform-card-name">{PLATFORMS[p].name}</span>
                  <span className="platform-card-sub">{PLATFORMS[p].method}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {platform && (
          <>
            <div className="sheet-body">
              <p className="sheet-intro" style={{ margin: 0 }}>
                {platform === 'telegram'
                  ? t('telegramIntro')
                  : platform === 'messenger'
                    ? t('messengerIntro')
                    : platform === 'instagram'
                      ? t('instagramIntro')
                      : platform === 'zalo'
                        ? t('zaloIntro')
                        : t('whatsappIntro')}
              </p>

              {platform === 'telegram' && (
                <>
                  <div className="field">
                    <label className="field-label">{t('apiId')}</label>
                    <input className="field-input mono" value={apiId} onChange={(e) => setApiId(e.target.value)} inputMode="numeric" disabled={busy} />
                  </div>
                  <div className="field">
                    <label className="field-label">{t('apiHash')}</label>
                    <input className="field-input mono" value={apiHash} onChange={(e) => setApiHash(e.target.value)} disabled={busy} spellCheck={false} />
                    <span className="field-hint">
                      {t('telegramApiHint')}{' '}
                      <a href={DOCS.telegram} onClick={openDocs(DOCS.telegram)}>
                        {t('learnMore')} <ExternalLink size={10} />
                      </a>
                    </span>
                  </div>
                </>
              )}

              {isMeta && (
                <>
                  <div className="field">
                    <label className="field-label">{t('pageId')}</label>
                    <input className="field-input mono" value={pageId} onChange={(e) => setPageId(e.target.value)} inputMode="numeric" disabled={busy} />
                  </div>
                  <div className="field">
                    <label className="field-label">{t('accessToken')}</label>
                    <input
                      className="field-input mono"
                      type="password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      disabled={busy}
                      spellCheck={false}
                    />
                    <span className="field-hint">
                      {t('metaHint')}{' '}
                      <a href={DOCS[platform]} onClick={openDocs(DOCS[platform])}>
                        {t('learnMore')} <ExternalLink size={10} />
                      </a>
                    </span>
                  </div>
                </>
              )}

              {isQr && (
                <div className="notice">
                  <ShieldAlert size={16} />
                  <span>{t('unofficialWarning', { app: PLATFORMS[platform].name })}</span>
                </div>
              )}

              {error && <div className="error-banner">{error}</div>}
              {busy && (
                <div className="progress-row">
                  <span className="spinner" /> {isQr ? t('qrWaiting') : t('connectingAccount')}
                </div>
              )}
            </div>
            <div className="sheet-footer">
              <button className="btn secondary" onClick={closeSheet} disabled={busy}>
                {t('cancel')}
              </button>
              <button className="btn primary" onClick={() => void submit()} disabled={!valid || busy}>
                {isQr ? t('showQr') : t('connect')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
