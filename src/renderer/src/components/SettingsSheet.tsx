import { Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { Language, ThemePreference } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { useStore, useT } from '../store'
import { Avatar } from './Avatar'

export function SettingsSheet(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const accountMap = useStore((s) => s.accounts)
  const accounts = Object.values(accountMap)
  const removeAccount = useStore((s) => s.removeAccount)
  const reconnect = useStore((s) => s.reconnect)
  const openSheet = useStore((s) => s.openSheet)
  const closeSheet = useStore((s) => s.closeSheet)

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'connected':
        return t('connected')
      case 'connecting':
        return t('connecting')
      case 'needs_auth':
        return t('needsAuth')
      case 'error':
        return t('error')
      default:
        return t('disconnected')
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet" role="dialog" aria-label={t('settings')}>
        <div className="sheet-header">
          <div className="sheet-title">{t('settings')}</div>
          <button className="icon-btn" onClick={closeSheet} title={t('close')}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="sheet-body">
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('accounts')}
            </div>
            <div className="settings-group">
              {accounts.length === 0 && (
                <div className="settings-row">
                  <div className="settings-row-text" style={{ color: 'var(--text-secondary)' }}>
                    {t('noAccounts')}
                  </div>
                </div>
              )}
              {accounts.map((account) => (
                <div className="settings-row" key={account.id}>
                  <Avatar name={account.displayName} url={account.avatarUrl} size={32} platform={account.platform} />
                  <div className="settings-row-text">
                    <div className="settings-row-title">
                      {account.displayName}
                      {account.demo && (
                        <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> · {t('demoBadge')}</span>
                      )}
                    </div>
                    <div className="settings-row-sub">
                      <span className={`status-dot ${account.status}`} style={{ display: 'inline-block', marginRight: 5 }} />
                      {PLATFORMS[account.platform].name} · {statusLabel(account.status)}
                      {account.error && ` — ${account.error}`}
                    </div>
                  </div>
                  <button className="icon-btn" title={t('reconnect')} onClick={() => void reconnect(account.id)}>
                    <RefreshCw size={15} />
                  </button>
                  <button className="icon-btn" title={t('remove')} onClick={() => void removeAccount(account.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button className="settings-row" style={{ width: '100%', color: 'var(--accent)' }} onClick={() => openSheet({ kind: 'add-account' })}>
                <Plus size={16} strokeWidth={2.4} />
                <span className="settings-row-title">{t('addAccount')}</span>
              </button>
            </div>
          </div>

          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('general')}
            </div>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('appearance')}</div>
                </div>
                <div className="segmented">
                  {(['system', 'light', 'dark'] as ThemePreference[]).map((theme) => (
                    <button
                      key={theme}
                      className={settings.theme === theme ? 'active' : ''}
                      onClick={() => void setSettings({ theme })}
                    >
                      {theme === 'system' ? t('themeSystem') : theme === 'light' ? t('themeLight') : t('themeDark')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('language')}</div>
                </div>
                <div className="segmented">
                  {(['vi', 'en'] as Language[]).map((language) => (
                    <button
                      key={language}
                      className={settings.language === language ? 'active' : ''}
                      onClick={() => void setSettings({ language })}
                    >
                      {language === 'vi' ? 'Tiếng Việt' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('notifications')}</div>
                  <div className="settings-row-sub">{t('notificationsHint')}</div>
                </div>
                <button
                  className={`switch ${settings.notifications ? 'on' : ''}`}
                  role="switch"
                  aria-checked={settings.notifications}
                  onClick={() => void setSettings({ notifications: !settings.notifications })}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('sendOnEnter')}</div>
                  <div className="settings-row-sub">{t('sendOnEnterHint')}</div>
                </div>
                <button
                  className={`switch ${settings.sendOnEnter ? 'on' : ''}`}
                  role="switch"
                  aria-checked={settings.sendOnEnter}
                  onClick={() => void setSettings({ sendOnEnter: !settings.sendOnEnter })}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
