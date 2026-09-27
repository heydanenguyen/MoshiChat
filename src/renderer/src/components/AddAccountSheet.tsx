import { useState } from 'react'
import { Building2, ChevronLeft, ExternalLink, KeyRound, ShieldAlert, User, X } from 'lucide-react'
import type { PageOption, Platform } from '@shared/types'
import { PLATFORMS, PLATFORM_ORDER } from '@shared/types'
import { useStore, useT, type LegalDoc } from '../store'
import { LegalText } from './LegalSheet'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'
import { BuddyLoader } from './BuddyLoader'

const DOCS: Partial<Record<Platform, string>> = {
  telegram: 'https://my.telegram.org/apps',
  messenger: 'https://developers.facebook.com/docs/messenger-platform/get-started',
  instagram: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/messaging'
}

type MetaMode = 'personal' | 'pages' | 'manual'

const APP_ID_KEY = 'unison.metaAppId'

export function AddAccountSheet({ initialPlatform }: { initialPlatform?: Platform }): JSX.Element {
  const t = useT()
  const closeSheet = useStore((s) => s.closeSheet)
  const addAccount = useStore((s) => s.addAccount)
  const connectWeb = useStore((s) => s.connectWeb)
  const addPages = useStore((s) => s.addPages)
  const [platform, setPlatform] = useState<Platform | undefined>(initialPlatform)
  const [mode, setMode] = useState<MetaMode | undefined>()
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [pageId, setPageId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [appId, setAppId] = useState(() => {
    try {
      return localStorage.getItem(APP_ID_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [pages, setPages] = useState<PageOption[] | undefined>()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [withInstagram, setWithInstagram] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // Unofficial connections (personal Messenger / Instagram, Zalo, WhatsApp) start with a notice the person accepts once per platform.
  const accepted = useStore((s) => s.settings.acceptedUnofficial)
  const setSettings = useStore((s) => s.setSettings)
  const [consent, setConsent] = useState<{ platform: Platform; task: () => Promise<void> } | undefined>()
  const [agreed, setAgreed] = useState(false)
  const [reading, setReading] = useState<LegalDoc | undefined>()

  const isMeta = platform === 'messenger' || platform === 'instagram'
  const isQr = platform === 'zalo' || platform === 'whatsapp'
  const clean = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await task()
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy(false)
    }
  }

  const withConsent = (p: Platform, task: () => Promise<void>): void => {
    if (accepted?.[p]) {
      void run(task)
      return
    }
    setAgreed(false)
    setReading(undefined)
    setConsent({ platform: p, task })
  }

  const acceptConsent = (): void => {
    if (!consent) return
    const { platform: p, task } = consent
    setConsent(undefined)
    void setSettings({ acceptedUnofficial: { ...(accepted ?? {}), [p]: Date.now() } })
    void run(task)
  }

  const openDocs = (url?: string) => (e: React.MouseEvent): void => {
    e.preventDefault()
    if (url) void window.unison.app.openExternal(url)
  }

  const back = (): void => {
    setError(undefined)
    if (consent) setConsent(undefined)
    else if (pages) setPages(undefined)
    else if (mode) setMode(undefined)
    else setPlatform(undefined)
  }

  const title = platform ? PLATFORMS[platform].name : t('addAccount')

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeSheet()}>
      <div className={`sheet ${platform ? '' : 'wide'}`} role="dialog" aria-label={t('addAccount')}>
        <div className="sheet-header">
          {platform && !busy && (
            <button className="icon-btn" onClick={back} title={t('back')}>
              <ChevronLeft size={18} strokeWidth={2.4} />
            </button>
          )}
          <div className="sheet-title">{title}</div>
          {!busy && (
            <button className="icon-btn" onClick={closeSheet} title={t('close')}>
              <X size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>

        {/* ------------------------------------------------ unofficial connection: read and accept */}
        {consent && (
          <>
            <div className="sheet-body scroll">
              <div className="consent-head">
                <ShieldAlert size={22} />
                <div>
                  <div className="consent-title">{t('consentTitle', { app: PLATFORMS[consent.platform].name })}</div>
                  <div className="consent-intro">{t('consentIntro')}</div>
                </div>
              </div>
              <ul className="consent-list">
                {(['consentPoint1', 'consentPoint2', 'consentPoint3', 'consentPoint4', 'consentPoint5'] as const).map((key) => (
                  <li key={key}>{t(key, { app: PLATFORMS[consent.platform].name })}</li>
                ))}
              </ul>
              <div className="consent-links">
                {(['terms', 'privacy'] as const).map((doc) => (
                  <button key={doc} className={`link-btn ${reading === doc ? 'active' : ''}`} onClick={() => setReading(reading === doc ? undefined : doc)}>
                    {t(doc === 'terms' ? 'legalTerms' : 'legalPrivacy')}
                  </button>
                ))}
              </div>
              {reading && (
                <div className="consent-doc scroll">
                  <LegalText doc={reading} />
                </div>
              )}
              <label className="consent-check">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>{t('consentAgree')}</span>
              </label>
            </div>
            <div className="sheet-footer">
              <button className="btn secondary" onClick={() => setConsent(undefined)}>
                {t('cancel')}
              </button>
              <button className="btn primary" disabled={!agreed} onClick={acceptConsent}>
                {t('consentContinue')}
              </button>
            </div>
          </>
        )}

        {/* ------------------------------------------------ platform picker */}
        {!platform && (
          <div className="sheet-body">
            <p className="sheet-intro" style={{ margin: 0 }}>
              {t('choosePlatform')}
            </p>
            <div className="platform-grid">
              {PLATFORM_ORDER.map((p) => (
                <button key={p} className="platform-card" onClick={() => setPlatform(p)}>
                  <PlatformIcon platform={p} size={52} />
                  <span className="platform-card-name">{PLATFORMS[p].name}</span>
                  <span className="platform-card-sub">{p === 'telegram' ? t('methodPhone') : p === 'zalo' || p === 'whatsapp' ? t('methodQr') : t('methodLogin')}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------------------ Facebook / Instagram: choose how */}
        {isMeta && !mode && !consent && (
          <div className="sheet-body">
            <p className="sheet-intro" style={{ margin: 0 }}>
              {t('metaChooseMode')}
            </p>
            <div className="mode-list">
              <button className="mode-card" onClick={() => withConsent(platform, () => connectWeb(platform))} disabled={busy}>
                <span className="mode-icon">
                  <User size={20} />
                </span>
                <span className="mode-text">
                  <strong>{t('modePersonal')}</strong>
                  <span>{platform === 'messenger' ? t('modePersonalFbHint') : t('modePersonalIgHint')}</span>
                </span>
              </button>
              <button className="mode-card" onClick={() => setMode('pages')} disabled={busy}>
                <span className="mode-icon">
                  <Building2 size={20} />
                </span>
                <span className="mode-text">
                  <strong>{t('modePages')}</strong>
                  <span>{t('modePagesHint')}</span>
                </span>
              </button>
              <button className="mode-card subtle" onClick={() => setMode('manual')} disabled={busy}>
                <span className="mode-icon">
                  <KeyRound size={20} />
                </span>
                <span className="mode-text">
                  <strong>{t('modeManual')}</strong>
                  <span>{t('modeManualHint')}</span>
                </span>
              </button>
            </div>
            <div className="notice">
              <ShieldAlert size={16} />
              <span>{t('unofficialWarning', { app: PLATFORMS[platform].name })}</span>
            </div>
            {error && <div className="error-banner">{error}</div>}
            {busy && (
              <div className="progress-row">
                <BuddyLoader size={22} inline /> {t('waitingLogin')}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------ Pages via Facebook Login */}
        {isMeta && mode === 'pages' && !pages && (
          <>
            <div className="sheet-body">
              <p className="sheet-intro" style={{ margin: 0 }}>
                {t('pagesIntro')}
              </p>
              <div className="field">
                <label className="field-label">{t('appId')}</label>
                <input className="field-input mono" value={appId} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" disabled={busy} />
                <span className="field-hint">
                  {t('appIdHint')}{' '}
                  <a href="https://developers.facebook.com/apps/" onClick={openDocs('https://developers.facebook.com/apps/')}>
                    {t('learnMore')} <ExternalLink size={10} />
                  </a>
                </span>
              </div>
              {error && <div className="error-banner">{error}</div>}
              {busy && (
                <div className="progress-row">
                  <BuddyLoader size={22} inline /> {t('waitingLogin')}
                </div>
              )}
            </div>
            <div className="sheet-footer">
              <button className="btn secondary" onClick={closeSheet} disabled={busy}>
                {t('cancel')}
              </button>
              <button
                className="btn primary"
                disabled={!/^\d{6,}$/.test(appId.trim()) || busy}
                onClick={() =>
                  void run(async () => {
                    try {
                      localStorage.setItem(APP_ID_KEY, appId.trim())
                    } catch {
                      /* ignore */
                    }
                    const list = await window.unison.accounts.listPages(appId.trim())
                    if (!list.length) throw new Error(t('noPages'))
                    setPages(list)
                    setPicked(new Set(list.map((p) => p.id)))
                  })
                }
              >
                {t('loginWithFacebook')}
              </button>
            </div>
          </>
        )}

        {isMeta && mode === 'pages' && pages && (
          <>
            <div className="sheet-body">
              <p className="sheet-intro" style={{ margin: 0 }}>
                {t('pickPages')}
              </p>
              <div className="settings-group">
                {pages.map((page) => {
                  const on = picked.has(page.id)
                  return (
                    <button
                      key={page.id}
                      className="settings-row"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => {
                        const next = new Set(picked)
                        on ? next.delete(page.id) : next.add(page.id)
                        setPicked(next)
                      }}
                    >
                      <Avatar name={page.name} url={page.pictureUrl} size={34} platform="messenger" />
                      <span className="settings-row-text">
                        <span className="settings-row-title">{page.name}</span>
                        <span className="settings-row-sub">{page.instagram ? `Instagram · @${page.instagram.username}` : t('noInstagramLinked')}</span>
                      </span>
                      <span className={`switch ${on ? 'on' : ''}`} />
                    </button>
                  )
                })}
              </div>
              <div className="settings-row" style={{ padding: 0 }}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('alsoInstagram')}</div>
                </div>
                <button className={`switch ${withInstagram ? 'on' : ''}`} onClick={() => setWithInstagram((v) => !v)} />
              </div>
              {error && <div className="error-banner">{error}</div>}
              {busy && (
                <div className="progress-row">
                  <BuddyLoader size={22} inline /> {t('connectingAccount')}
                </div>
              )}
            </div>
            <div className="sheet-footer">
              <button className="btn secondary" onClick={closeSheet} disabled={busy}>
                {t('cancel')}
              </button>
              <button
                className="btn primary"
                disabled={picked.size === 0 || busy}
                onClick={() => void run(() => addPages(pages.filter((p) => picked.has(p.id)), withInstagram))}
              >
                {t('connect')} ({picked.size})
              </button>
            </div>
          </>
        )}

        {/* ------------------------------------------------ manual Page token */}
        {isMeta && mode === 'manual' && (
          <>
            <div className="sheet-body">
              <p className="sheet-intro" style={{ margin: 0 }}>
                {platform === 'messenger' ? t('messengerIntro') : t('instagramIntro')}
              </p>
              <div className="field">
                <label className="field-label">{t('pageId')}</label>
                <input className="field-input mono" value={pageId} onChange={(e) => setPageId(e.target.value)} inputMode="numeric" disabled={busy} />
              </div>
              <div className="field">
                <label className="field-label">{t('accessToken')}</label>
                <input className="field-input mono" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} disabled={busy} spellCheck={false} />
                <span className="field-hint">
                  {t('metaHint')}{' '}
                  <a href={DOCS[platform]} onClick={openDocs(DOCS[platform])}>
                    {t('learnMore')} <ExternalLink size={10} />
                  </a>
                </span>
              </div>
              {error && <div className="error-banner">{error}</div>}
              {busy && (
                <div className="progress-row">
                  <BuddyLoader size={22} inline /> {t('connectingAccount')}
                </div>
              )}
            </div>
            <div className="sheet-footer">
              <button className="btn secondary" onClick={closeSheet} disabled={busy}>
                {t('cancel')}
              </button>
              <button
                className="btn primary"
                disabled={!(pageId.trim() && accessToken.trim().length > 20) || busy}
                onClick={() => void run(() => addAccount({ platform, pageId: pageId.trim(), accessToken: accessToken.trim() }))}
              >
                {t('connect')}
              </button>
            </div>
          </>
        )}

        {/* ------------------------------------------------ Telegram */}
        {platform === 'telegram' && (
          <>
            <div className="sheet-body">
              <p className="sheet-intro" style={{ margin: 0 }}>
                {t('telegramIntro')}
              </p>
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
              {error && <div className="error-banner">{error}</div>}
              {busy && (
                <div className="progress-row">
                  <BuddyLoader size={22} inline /> {t('connectingAccount')}
                </div>
              )}
            </div>
            <div className="sheet-footer">
              <button className="btn secondary" onClick={closeSheet} disabled={busy}>
                {t('cancel')}
              </button>
              <button
                className="btn primary"
                disabled={!(/^\d+$/.test(apiId.trim()) && apiHash.trim().length >= 16) || busy}
                onClick={() => void run(() => addAccount({ platform, apiId: Number(apiId.trim()), apiHash: apiHash.trim() }))}
              >
                {t('connect')}
              </button>
            </div>
          </>
        )}

        {/* ------------------------------------------------ Zalo / WhatsApp */}
        {isQr && !consent && (
          <>
            <div className="sheet-body">
              <p className="sheet-intro" style={{ margin: 0 }}>
                {platform === 'zalo' ? t('zaloIntro') : t('whatsappIntro')}
              </p>
              <div className="notice">
                <ShieldAlert size={16} />
                <span>{t('unofficialWarning', { app: PLATFORMS[platform].name })}</span>
              </div>
              {error && <div className="error-banner">{error}</div>}
              {busy && (
                <div className="progress-row">
                  <BuddyLoader size={22} inline /> {t('qrWaiting')}
                </div>
              )}
            </div>
            <div className="sheet-footer">
              <button className="btn secondary" onClick={closeSheet} disabled={busy}>
                {t('cancel')}
              </button>
              <button className="btn primary" disabled={busy} onClick={() => withConsent(platform, () => addAccount({ platform }))}>
                {t('showQr')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
