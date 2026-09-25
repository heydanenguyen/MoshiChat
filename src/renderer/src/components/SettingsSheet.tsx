import { BellOff, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { Language, ThemePreference } from '@shared/types'
import { ACCENTS, FONTS, MESHES, PLATFORMS, PLATFORM_ORDER, TAGS } from '@shared/types'
import { useStore, useT } from '../store'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'

export function SettingsSheet(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const accountMap = useStore((s) => s.accounts)
  const accounts = Object.values(accountMap)
  const removeAccount = useStore((s) => s.removeAccount)
  const reconnect = useStore((s) => s.reconnect)
  const toggleMute = useStore((s) => s.toggleMute)
  const openSheet = useStore((s) => s.openSheet)
  const closeSheet = useStore((s) => s.closeSheet)
  const language = settings.language

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

  const mutedPlatforms = settings.muted.platforms
  const mutedTags = settings.muted.tags

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet wide" role="dialog" aria-label={t('settings')}>
        <div className="sheet-header">
          <div className="sheet-title">{t('settings')}</div>
          <button className="icon-btn" onClick={closeSheet} title={t('close')}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="sheet-body">
          {/* ---------------------------------------------------------- personalisation */}
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('personalize')}
            </div>
            <div className="settings-group">
              <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('background')}</div>
                  <div className="settings-row-sub">{t('backgroundHint')}</div>
                  <div className="mesh-picker">
                    {MESHES.map((mesh) => (
                      <button
                        key={mesh.id}
                        className={`mesh-swatch ${settings.mesh === mesh.id ? 'active' : ''}`}
                        onClick={() => void setSettings({ mesh: mesh.id })}
                        title={mesh.name[language]}
                        style={{ background: `linear-gradient(135deg, ${mesh.swatch[0]} 0%, ${mesh.swatch[1]} 35%, ${mesh.swatch[2]} 70%, ${mesh.swatch[3]} 100%)` }}
                      >
                        <span>{mesh.name[language]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('accentColor')}</div>
                  <div className="settings-row-sub">{t('accentHint')}</div>
                </div>
                <div className="accent-picker">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.id}
                      className={`accent-dot ${settings.accent === accent.id ? 'active' : ''}`}
                      onClick={() => void setSettings({ accent: accent.id })}
                      title={accent.name[language]}
                      style={{ background: `linear-gradient(135deg, ${accent.from}, ${accent.to})` }}
                    />
                  ))}
                </div>
              </div>
              <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('font')}</div>
                  <div className="font-picker">
                    {FONTS.map((font) => (
                      <button
                        key={font.id}
                        className={`font-card ${settings.font === font.id ? 'active' : ''}`}
                        onClick={() => void setSettings({ font: font.id })}
                        style={{ fontFamily: font.family }}
                      >
                        <span className="font-sample">Aa</span>
                        <span className="font-name">{font.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('greetings')}</div>
                  <div className="settings-row-sub">{t('greetingsHint')}</div>
                </div>
                <button
                  className={`switch ${settings.greetings ? 'on' : ''}`}
                  role="switch"
                  aria-checked={settings.greetings}
                  onClick={() => void setSettings({ greetings: !settings.greetings })}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('appearance')}</div>
                </div>
                <div className="segmented">
                  {(['system', 'light', 'dark'] as ThemePreference[]).map((theme) => (
                    <button key={theme} className={settings.theme === theme ? 'active' : ''} onClick={() => void setSettings({ theme })}>
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
                  {(['vi', 'en'] as Language[]).map((lang) => (
                    <button key={lang} className={settings.language === lang ? 'active' : ''} onClick={() => void setSettings({ language: lang })}>
                      {lang === 'vi' ? 'Tiếng Việt' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- notifications */}
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('notifications')}
            </div>
            <div className="settings-group">
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
              <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('muteByPlatform')}</div>
                  <div className="mute-chips">
                    {PLATFORM_ORDER.map((platform) => {
                      const muted = mutedPlatforms.includes(platform)
                      return (
                        <button key={platform} className={`mute-chip ${muted ? 'muted' : ''}`} onClick={() => void toggleMute('platforms', platform)}>
                          <PlatformIcon platform={platform} size={22} variant="tile" />
                          {PLATFORMS[platform].name}
                          {muted && <BellOff size={12} />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('muteByTag')}</div>
                  <div className="mute-chips">
                    {Object.values(TAGS).map((tag) => {
                      const muted = mutedTags.includes(tag.id)
                      return (
                        <button key={tag.id} className={`mute-chip ${muted ? 'muted' : ''}`} onClick={() => void toggleMute('tags', tag.id)}>
                          <span className="tag-swatch" style={{ background: tag.color }}>
                            {tag.emoji}
                          </span>
                          {tag.name[language]}
                          {muted && <BellOff size={12} />}
                        </button>
                      )
                    })}
                  </div>
                </div>
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

          {/* ---------------------------------------------------------- accounts */}
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
              {accounts.map((account) => {
                const muted = settings.muted.accounts.includes(account.id)
                return (
                  <div className="settings-row" key={account.id}>
                    <Avatar name={account.displayName} url={account.avatarUrl} size={34} platform={account.platform} />
                    <div className="settings-row-text">
                      <div className="settings-row-title">
                        {account.displayName}
                        {account.demo && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> · {t('demoBadge')}</span>}
                      </div>
                      <div className="settings-row-sub">
                        <span className={`status-dot ${account.status}`} style={{ display: 'inline-block', marginRight: 5 }} />
                        {PLATFORMS[account.platform].name} · {statusLabel(account.status)}
                        {account.error && ` — ${account.error}`}
                      </div>
                    </div>
                    <button className={`icon-btn ${muted ? 'active' : ''}`} title={muted ? t('unmute') : t('mute')} onClick={() => void toggleMute('accounts', account.id)}>
                      <BellOff size={15} />
                    </button>
                    <button className="icon-btn" title={t('reconnect')} onClick={() => void reconnect(account.id)}>
                      <RefreshCw size={15} />
                    </button>
                    <button className="icon-btn" title={t('remove')} onClick={() => void removeAccount(account.id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                )
              })}
              <button className="settings-row" style={{ width: '100%', color: 'var(--accent)' }} onClick={() => openSheet({ kind: 'add-account' })}>
                <Plus size={16} strokeWidth={2.4} />
                <span className="settings-row-title">{t('addAccount')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
