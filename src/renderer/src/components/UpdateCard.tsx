import { ArrowDownToLine, RefreshCw, Sparkles, X } from 'lucide-react'
import { useT } from '../store'
import { useUpdate, useUpdateCardVisible } from '../updateStore'
import { BuddyLoader } from './BuddyLoader'

/** Sidebar: a new version is out (or downloading, or ready to restart). Collapsed rail: just a dot. */
export function UpdateCard({ collapsed }: { collapsed: boolean }): JSX.Element | null {
  const t = useT()
  const state = useUpdate((s) => s.state)
  const download = useUpdate((s) => s.download)
  const install = useUpdate((s) => s.install)
  const dismiss = useUpdate((s) => s.dismiss)
  const visible = useUpdateCardVisible()
  if (!visible || !('version' in state)) return null
  const manual = state.phase === 'available' && !!state.manual
  const version = state.version ?? ''

  const action = (): void => {
    if (state.phase === 'ready') install()
    else if (state.phase === 'available') void download()
  }
  const title = state.phase === 'ready' ? t('updateReadyTitle', { version }) : t('updateAvailableTitle', { version })

  if (collapsed) {
    return (
      <button className="nav-item subtle update-rail" onClick={action} title={title}>
        <span className="nav-item-icon">
          {state.phase === 'downloading' ? <BuddyLoader size={16} inline /> : <Sparkles size={16} strokeWidth={2.2} />}
        </span>
        <span className="rail-dot" />
      </button>
    )
  }

  return (
    <div className={`update-card ${state.phase}`} role="status">
      <div className="update-card-head">
        <span className="update-card-icon">
          <Sparkles size={15} strokeWidth={2.3} />
        </span>
        <span className="update-card-title">{title}</span>
        {state.phase !== 'downloading' && (
          <button className="icon-btn update-card-close" onClick={dismiss} title={t('updateLater')}>
            <X size={13} strokeWidth={2.6} />
          </button>
        )}
      </div>
      {state.phase === 'downloading' ? (
        <div className="ai-progress inline update-card-progress">
          <div className="ai-progress-track">
            <div className="ai-progress-fill" style={{ width: `${state.percent}%` }} />
          </div>
          <span>{t('updateDownloading', { percent: String(state.percent) })}</span>
        </div>
      ) : (
        <>
          <div className="update-card-sub">{state.phase === 'ready' ? t('updateReadyHint') : manual ? t('updateManualHint') : t('updateAvailableHint')}</div>
          <button className="btn primary update-card-btn" onClick={action}>
            {state.phase === 'ready' ? <RefreshCw size={14} strokeWidth={2.4} /> : <ArrowDownToLine size={14} strokeWidth={2.4} />}
            {state.phase === 'ready' ? t('updateRestart') : manual ? t('updateOpenPage') : t('updateInstall')}
          </button>
        </>
      )}
    </div>
  )
}

/** Settings: current version, a manual check, and the same actions as the card. */
export function UpdateSettings(): JSX.Element {
  const t = useT()
  const state = useUpdate((s) => s.state)
  const version = useUpdate((s) => s.version)
  const check = useUpdate((s) => s.check)
  const download = useUpdate((s) => s.download)
  const install = useUpdate((s) => s.install)
  const openPage = useUpdate((s) => s.openPage)
  const busy = state.phase === 'checking' || state.phase === 'downloading'

  let sub: string
  switch (state.phase) {
    case 'checking':
      sub = t('updateChecking')
      break
    case 'available':
      sub = state.manual ? t('updateManualHint') : t('updateAvailableTitle', { version: state.version })
      break
    case 'downloading':
      sub = t('updateDownloading', { percent: String(state.percent) })
      break
    case 'ready':
      sub = t('updateReadyHint')
      break
    case 'none':
      sub = t('updateUpToDate')
      break
    case 'error':
      sub = t('updateError', { message: state.message.slice(0, 120) })
      break
    default:
      sub = t('updateAutoHint')
  }

  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">Moshi {version}</div>
        <div className="settings-row-sub">{sub}</div>
        {state.phase === 'available' && state.notes && <div className="update-notes">{state.notes}</div>}
      </div>
      {state.phase === 'available' ? (
        <button className="btn primary" onClick={() => void download()}>
          {state.manual ? t('updateOpenPage') : t('updateInstall')}
        </button>
      ) : state.phase === 'ready' ? (
        <button className="btn primary" onClick={install}>
          {t('updateRestart')}
        </button>
      ) : state.phase === 'error' ? (
        <button className="btn" onClick={openPage}>
          {t('updateOpenPage')}
        </button>
      ) : (
        <button className="btn" onClick={() => void check()} disabled={busy}>
          {busy ? <BuddyLoader size={16} inline /> : t('updateCheck')}
        </button>
      )}
    </div>
  )
}
