import { ArchiveRestore, BellOff, ChevronRight, FileArchive, Minus, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { Language, TextSize, ThemePreference } from '@shared/types'
import { ACCENTS, FONTS, MESHES, PLATFORMS, PLATFORM_ORDER, ZOOM_STEPS, clampZoom, stepZoom } from '@shared/types'
import { TagManager } from './TagEditor'
import { CustomAccentRow } from './CustomAccents'
import { TagChip } from './Tag'
import { LogoMark } from './Logo'
import { LOGOS, LOGO_ORDER } from '@shared/logos'
import { useStore, useT, useTagDefs } from '../store'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'
import { GifKeyForm } from './GifPicker'
import { QuickReplyManager } from './QuickReplyManager'
import { LEGAL_TITLE_KEY } from './LegalSheet'
import { formatListTime } from '../utils'
import { AiSettings } from './AiParts'
import { SoundSettings } from './SoundSettings'

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
  const conversationMap = useStore((s) => s.conversations)
  const unhideConversation = useStore((s) => s.unhideConversation)
  const strangers = Object.entries(settings.hidden ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id, at]) => ({ id, at, conversation: conversationMap[id] }))
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
  const { list: tagList } = useTagDefs()

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
                  <div className="settings-row-title">{t('logo')}</div>
                  <div className="settings-row-sub">{t('logoHint')}</div>
                </div>
              </div>
              <div className="logo-picker" role="radiogroup" aria-label={t('logo')}>
                {LOGO_ORDER.map((id) => {
                  const active = (settings.logo ?? 'buddies') === id
                  return (
                    <button
                      key={id}
                      className={`logo-option ${active ? 'active' : ''}`}
                      role="radio"
                      aria-checked={active}
                      onClick={() => void setSettings({ logo: id })}
                      title={LOGOS[id].name[language]}
                    >
                      <span className="logo-tile" style={{ background: LOGOS[id].background }}>
                        <LogoMark logo={id} size={52} />
                      </span>
                      <span className="logo-option-name">{LOGOS[id].name[language]}</span>
                    </button>
                  )
                })}
              </div>
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
              </div>
              {[false, true].map((flat) => (
                <div key={String(flat)} className="accent-group">
                  <span className="accent-group-label">{flat ? t('accentFlat') : t('accentGradient')}</span>
                  <div className="accent-picker" role="radiogroup" aria-label={flat ? t('accentFlat') : t('accentGradient')}>
                    {ACCENTS.filter((accent) => !!accent.flat === flat).map((accent) => (
                      <button
                        key={accent.id}
                        className={`accent-dot ${flat ? 'flat' : ''} ${settings.accent === accent.id ? 'active' : ''}`}
                        role="radio"
                        aria-checked={settings.accent === accent.id}
                        onClick={() => void setSettings({ accent: accent.id })}
                        title={accent.name[language]}
                        style={{ background: flat ? accent.from : `linear-gradient(135deg, ${accent.from}, ${accent.to})`, ['--dot' as string]: accent.from } as React.CSSProperties}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <CustomAccentRow />
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
                  <div className="settings-row-title">{t('textSize')}</div>
                  <div className="settings-row-sub">{t('textSizeHint')}</div>
                </div>
                <div className="segmented text-size-picker" role="radiogroup" aria-label={t('textSize')}>
                  {(['sm', 'md', 'lg', 'xl'] as TextSize[]).map((size) => (
                    <button
                      key={size}
                      role="radio"
                      aria-checked={(settings.textSize ?? 'md') === size}
                      className={`size-${size} ${(settings.textSize ?? 'md') === size ? 'active' : ''}`}
                      onClick={() => void setSettings({ textSize: size })}
                      title={t(`textSize_${size}`)}
                    >
                      Aa
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('zoom')}</div>
                  <div className="settings-row-sub">{t('zoomHint')}</div>
                </div>
                <div className="zoom-stepper">
                  <button className="icon-btn" onClick={() => void setSettings({ zoom: stepZoom(settings.zoom, -1) })} disabled={clampZoom(settings.zoom) <= ZOOM_STEPS[0]} aria-label={t('zoomOut')}>
                    <Minus size={15} strokeWidth={2.6} />
                  </button>
                  <button className="zoom-value" onClick={() => void setSettings({ zoom: 1 })} title={t('zoomReset')}>
                    {Math.round(clampZoom(settings.zoom) * 100)}%
                  </button>
                  <button className="icon-btn" onClick={() => void setSettings({ zoom: stepZoom(settings.zoom, 1) })} disabled={clampZoom(settings.zoom) >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label={t('zoomIn')}>
                    <Plus size={15} strokeWidth={2.6} />
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('messageShadows')}</div>
                  <div className="settings-row-sub">{t('messageShadowsHint')}</div>
                </div>
                <button
                  className={`switch ${settings.messageShadows !== false ? 'on' : ''}`}
                  role="switch"
                  aria-checked={settings.messageShadows !== false}
                  onClick={() => void setSettings({ messageShadows: settings.messageShadows === false })}
                />
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

          {/* ---------------------------------------------------------- tags */}
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('tags')}
            </div>
            <div className="settings-group">
              <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('tagManage')}</div>
                  <div className="settings-row-sub">{t('tagManageHint')}</div>
                </div>
              </div>
              <TagManager />
            </div>
          </div>

          {/* ---------------------------------------------------------- on-device AI */}
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('aiSection')}
            </div>
            <div className="settings-group">
              <AiSettings />
            </div>
          </div>

          {/* ---------------------------------------------------------- backup */}
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('backupSection')}
            </div>
            <div className="settings-group">
              <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('backupSectionTitle')}</div>
                  <div className="settings-row-sub">{t('backupSectionHint')}</div>
                </div>
              </div>
              <div className="settings-row backup-buttons">
                <button className="btn primary" onClick={() => openSheet({ kind: 'backup', mode: 'create' })}>
                  <FileArchive size={15} strokeWidth={2.2} /> {t('backupCreate')}
                </button>
                <button className="btn" onClick={() => openSheet({ kind: 'backup', mode: 'restore' })}>
                  <ArchiveRestore size={15} strokeWidth={2.2} /> {t('restoreTitle')}
                </button>
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- messaging extras */}
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('quickReplies')}
            </div>
            <div className="settings-group">
              <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('quickReplies')}</div>
                  <div className="settings-row-sub">{t('quickRepliesHint')}</div>
                </div>
              </div>
              <QuickReplyManager />
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('effects')}</div>
                  <div className="settings-row-sub">{t('effectsHint')}</div>
                </div>
                <button
                  className={`switch ${settings.effects !== false ? 'on' : ''}`}
                  role="switch"
                  aria-checked={settings.effects !== false}
                  onClick={() => void setSettings({ effects: settings.effects === false })}
                />
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- GIFs */}
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              GIF
            </div>
            <div className="settings-group">
              <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('gifSettingsTitle')}</div>
                  <div className="settings-row-sub">{settings.gif?.key ? t('gifSettingsOn', { provider: settings.gif.provider === 'giphy' ? 'GIPHY' : 'KLIPY' }) : t('gifSetupHint')}</div>
                </div>
              </div>
              <div className="settings-row">
                <GifKeyForm />
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
                          <PlatformIcon platform={platform} size={22} />
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
                    {tagList.map((tag) => {
                      const muted = mutedTags.includes(tag.id)
                      return (
                        <TagChip key={tag.id} tag={tag} size="sm" flat={muted} onClick={() => void toggleMute('tags', tag.id)}>
                          {muted && <BellOff size={12} strokeWidth={2.4} />}
                        </TagChip>
                      )
                    })}
                  </div>
                </div>
              </div>
              <SoundSettings />
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{t('readReceipts')}</div>
                  <div className="settings-row-sub">{t('readReceiptsHint')}</div>
                </div>
                <button
                  className={`switch ${settings.sendReadReceipts !== false ? 'on' : ''}`}
                  role="switch"
                  aria-checked={settings.sendReadReceipts !== false}
                  onClick={() => void setSettings({ sendReadReceipts: settings.sendReadReceipts === false })}
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

          {/* ---------------------------------------------------------- strangers: hidden chats */}
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('strangersSection')}
            </div>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-sub">{t('strangersHint')}</div>
                </div>
              </div>
              {strangers.length === 0 && (
                <div className="settings-row">
                  <div className="settings-row-text" style={{ color: 'var(--text-secondary)' }}>
                    {t('strangersEmpty')}
                  </div>
                </div>
              )}
              {strangers.map(({ id, at, conversation }) => (
                <div className="settings-row" key={id}>
                  <Avatar name={conversation?.title ?? '?'} url={conversation?.avatarUrl} size={34} platform={conversation?.platform} />
                  <div className="settings-row-text">
                    <div className="settings-row-title">{conversation?.title ?? id}</div>
                    <div className="settings-row-sub">
                      {conversation ? `${PLATFORMS[conversation.platform].name} · ` : ''}
                      {formatListTime(at, settings.language)}
                    </div>
                  </div>
                  <button className="btn secondary" onClick={() => void unhideConversation(id)}>
                    {t('unhide')}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ---------------------------------------------------------- legal */}
          <div>
            <div className="sidebar-section-title" style={{ marginBottom: 8 }}>
              {t('legalSection')}
            </div>
            <div className="settings-group">
              {(['notice', 'license', 'terms', 'privacy', 'credits'] as const).map((doc) => (
                <button key={doc} className="settings-row settings-row-btn" onClick={() => openSheet({ kind: 'legal', doc })}>
                  <div className="settings-row-text">
                    <div className="settings-row-title">{t(LEGAL_TITLE_KEY[doc])}</div>
                  </div>
                  <ChevronRight size={16} />
                </button>
              ))}
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
                        {account.error && account.status === 'error' && ` — ${account.error}`}
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
