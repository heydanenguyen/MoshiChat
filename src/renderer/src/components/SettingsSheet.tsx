import { useEffect, useState } from 'react'
import { ArchiveRestore, Bell, BellOff, ChevronRight, CloudOff, Database, FileArchive, FolderOpen, FolderSync, MessageSquare, Minus, Palette, Plus, RefreshCw, Settings2, Sparkles, Tag, Trash2, Users, X } from 'lucide-react'
import type { BubbleAction, Language, SyncStatus, TextSize, ThemePreference } from '@shared/types'
import { ACCENTS, BUBBLE_ACTIONS, DARK_BASES, FONTS, MESHES, PLATFORMS, PLATFORM_ORDER, STYLES, ZOOM_STEPS, clampZoom, darkBaseHex, stepZoom } from '@shared/types'
import { TagManager } from './TagEditor'
import { CustomAccentRow } from './CustomAccents'
import { TagChip } from './Tag'
import { LogoMark } from './Logo'
import { LOGOS, LOGO_ORDER } from '@shared/logos'
import { useStore, useT, useTagDefs } from '../store'
import type { TKey } from '../i18n'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'
import { GifKeyForm } from './GifPicker'
import { QuickReplyManager } from './QuickReplyManager'
import { LEGAL_TITLE_KEY } from './LegalSheet'
import { formatListTime } from '../utils'
import { AiSettings } from './AiParts'
import { UpdateSettings } from './UpdateCard'
import { SoundSettings } from './SoundSettings'

/** Whether the app is showing its dark look right now (the dark-background option only matters then). */
function useDarkNow(): boolean {
  const theme = useStore((s) => s.settings.theme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => setSystemDark(media.matches)
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/** The pages of Settings, in sidebar order. */
export type SettingsPage = 'general' | 'appearance' | 'accounts' | 'chat' | 'notifications' | 'tags' | 'ai' | 'data'

const PAGES: Array<{ id: SettingsPage; icon: JSX.Element; tint: string }> = [
  { id: 'general', icon: <Settings2 size={15} strokeWidth={2.3} />, tint: '#8e8e93' },
  { id: 'appearance', icon: <Palette size={15} strokeWidth={2.3} />, tint: '#a855f7' },
  { id: 'accounts', icon: <Users size={15} strokeWidth={2.3} />, tint: '#3b82f6' },
  { id: 'chat', icon: <MessageSquare size={15} strokeWidth={2.3} />, tint: '#22c55e' },
  { id: 'notifications', icon: <Bell size={15} strokeWidth={2.3} />, tint: '#ef4444' },
  { id: 'tags', icon: <Tag size={15} strokeWidth={2.3} />, tint: '#f59e0b' },
  { id: 'ai', icon: <Sparkles size={15} strokeWidth={2.3} />, tint: '#ec4899' },
  { id: 'data', icon: <Database size={15} strokeWidth={2.3} />, tint: '#64748b' }
]

const LAST_PAGE_KEY = 'moshi.settingsPage'

function readLastPage(): SettingsPage {
  try {
    const saved = localStorage.getItem(LAST_PAGE_KEY)
    if (PAGES.some((p) => p.id === saved)) return saved as SettingsPage
  } catch {
    /* private mode or blocked storage: start on the first page */
  }
  return 'general'
}

/** Settings: a page list on the left, one page at a time on the right, so nothing is a long scroll. */
export function SettingsSheet({ initialPage }: { initialPage?: SettingsPage }): JSX.Element {
  const t = useT()
  const closeSheet = useStore((s) => s.closeSheet)
  const [page, setPage] = useState<SettingsPage>(() => initialPage ?? readLastPage())

  useEffect(() => {
    try {
      localStorage.setItem(LAST_PAGE_KEY, page)
    } catch {
      /* fine without it */
    }
  }, [page])

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet settings-sheet" role="dialog" aria-label={t('settings')}>
        <nav className="settings-nav" aria-label={t('settings')}>
          <div className="settings-nav-title">{t('settings')}</div>
          {PAGES.map((p) => (
            <button key={p.id} className={`nav-item ${page === p.id ? 'active' : ''}`} onClick={() => setPage(p.id)} aria-current={page === p.id ? 'page' : undefined}>
              <span className="nav-item-icon tile" style={{ ['--brand' as string]: p.tint } as React.CSSProperties}>
                {p.icon}
              </span>
              <span className="nav-item-label">{t(`settings_${p.id}`)}</span>
            </button>
          ))}
        </nav>
        <div className="settings-main">
          <div className="settings-page-head">
            <div className="settings-page-text">
              <h2 className="settings-page-title">{t(`settings_${page}`)}</h2>
              <div className="settings-page-sub">{t(`settings_${page}_sub`)}</div>
            </div>
            <button className="icon-btn" onClick={closeSheet} title={t('close')}>
              <X size={16} strokeWidth={2.4} />
            </button>
          </div>
          <div className="settings-page scroll" key={page}>
            {page === 'general' && <GeneralPage />}
            {page === 'appearance' && <AppearancePage />}
            {page === 'accounts' && <AccountsPage />}
            {page === 'chat' && <ChatPage />}
            {page === 'notifications' && <NotificationsPage />}
            {page === 'tags' && <TagsPage />}
            {page === 'ai' && <AiPage />}
            {page === 'data' && <DataPage />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ shared bits */

function Group({ label, children }: { label?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="settings-section">
      {label && <div className="settings-group-label">{label}</div>}
      <div className="settings-group">{children}</div>
    </section>
  )
}

/** A row with a title, an optional hint and a control on the right. `stack` puts the control (a picker) below. */
function Row({ title, sub, stack, children }: { title: string; sub?: string; stack?: boolean; children?: React.ReactNode }): JSX.Element {
  return (
    <div className={`settings-row ${stack ? 'stack' : ''}`}>
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {sub && <div className="settings-row-sub">{sub}</div>}
        {stack && children}
      </div>
      {!stack && children}
    </div>
  )
}

function Switch({ on, onChange }: { on: boolean; onChange(next: boolean): void }): JSX.Element {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)} />
}

/* ------------------------------------------------------------------ pages */

function GeneralPage(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  return (
    <>
      <Group>
        <Row title={t('language')}>
          <div className="segmented">
            {(['vi', 'en'] as Language[]).map((lang) => (
              <button key={lang} className={settings.language === lang ? 'active' : ''} onClick={() => void setSettings({ language: lang })}>
                {lang === 'vi' ? 'Tiếng Việt' : 'English'}
              </button>
            ))}
          </div>
        </Row>
        <Row title={t('greetings')} sub={t('greetingsHint')}>
          <Switch on={settings.greetings} onChange={(greetings) => void setSettings({ greetings })} />
        </Row>
        {settings.greetings && (
          <Row title={t('greetingsWeather')} sub={t('greetingsWeatherHint')}>
            <Switch on={!!settings.weather} onChange={(weather) => void setSettings({ weather })} />
          </Row>
        )}
      </Group>
      <Group label={t('updateSection')}>
        <UpdateSettings />
      </Group>
    </>
  )
}

function AppearancePage(): JSX.Element {
  const t = useT()
  const darkNow = useDarkNow()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const language = settings.language
  return (
    <>
      <Group>
        <Row title={t('themeMode')}>
          <div className="segmented">
            {(['system', 'light', 'dark'] as ThemePreference[]).map((theme) => (
              <button key={theme} className={settings.theme === theme ? 'active' : ''} onClick={() => void setSettings({ theme })}>
                {theme === 'system' ? t('themeSystem') : theme === 'light' ? t('themeLight') : t('themeDark')}
              </button>
            ))}
          </div>
        </Row>
        <Row title={t('style')} sub={t('styleHint')} stack>
          <div className="style-picker" role="radiogroup" aria-label={t('style')}>
            {STYLES.map((style) => {
              const active = (settings.style ?? 'moshi') === style.id
              return (
                <button key={style.id} className={`style-card ${active ? 'active' : ''}`} role="radio" aria-checked={active} onClick={() => void setSettings({ style: style.id })}>
                  <span className={`style-preview ${style.id}`} aria-hidden>
                    <i className="blob b1" />
                    <i className="blob b2" />
                    <i className="blob b3" />
                    <i className="pane p1" />
                    <i className="pane p2">
                      <i className="line" />
                      <i className="line short" />
                      <i className="pill" />
                    </i>
                  </span>
                  <span className="style-name">{style.name[language]}</span>
                  <span className="style-sub">{style.sub[language]}</span>
                </button>
              )
            })}
          </div>
        </Row>
      </Group>

      <Group label={t('groupColors')}>
        <Row title={t('background')} sub={t('backgroundHint')} stack>
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
        </Row>
        {darkNow && (
        <Row title={t('darkBackground')} sub={t('darkBackgroundHint')} stack>
          <div className="dark-base-picker" role="radiogroup" aria-label={t('darkBackground')}>
            {DARK_BASES.map((base) => {
              const active = (settings.darkBase ?? 'navy') === base.id
              return (
                <button key={base.id} className={`dark-base-swatch ${active ? 'active' : ''}`} role="radio" aria-checked={active} onClick={() => void setSettings({ darkBase: base.id })} title={base.name[language]} style={{ background: base.base }}>
                  <span>{base.name[language]}</span>
                </button>
              )
            })}
            {(() => {
              const custom = !!settings.darkBase && !DARK_BASES.some((b) => b.id === settings.darkBase)
              const value = custom ? darkBaseHex(settings.darkBase) : '#1c1c1e'
              return (
                <label className={`dark-base-swatch custom ${custom ? 'active' : ''}`} title={t('darkBackgroundCustom')} style={{ background: custom ? value : undefined }}>
                  <input type="color" value={value} aria-label={t('darkBackgroundCustom')} onChange={(e) => void setSettings({ darkBase: e.target.value.toLowerCase() })} />
                  <span>{t('darkBackgroundCustom')}</span>
                </label>
              )
            })()}
          </div>
        </Row>
        )}
        <Row title={t('accentColor')} sub={t('accentHint')} stack>
          <div className="accent-rows">
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
          </div>
        </Row>
        <CustomAccentRow />
      </Group>

      <Group label={t('groupIdentity')}>
        <Row title={t('logo')} sub={t('logoHint')} stack>
          <div className="logo-picker" role="radiogroup" aria-label={t('logo')}>
            {LOGO_ORDER.map((id) => {
              const active = (settings.logo ?? 'buddies') === id
              return (
                <button key={id} className={`logo-option ${active ? 'active' : ''}`} role="radio" aria-checked={active} onClick={() => void setSettings({ logo: id })} title={LOGOS[id].name[language]}>
                  <span className="logo-tile" style={{ background: LOGOS[id].background }}>
                    <LogoMark logo={id} size={52} />
                  </span>
                  <span className="logo-option-name">{LOGOS[id].name[language]}</span>
                </button>
              )
            })}
          </div>
        </Row>
      </Group>

      <Group label={t('groupType')}>
        <Row title={t('font')} stack>
          <div className="font-picker">
            {FONTS.map((font) => (
              <button key={font.id} className={`font-card ${settings.font === font.id ? 'active' : ''}`} onClick={() => void setSettings({ font: font.id })} style={{ fontFamily: font.family }}>
                <span className="font-sample">Aa</span>
                <span className="font-name">{font.name}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row title={t('textSize')} sub={t('textSizeHint')}>
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
        </Row>
        <Row title={t('zoom')} sub={t('zoomHint')}>
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
        </Row>
        <Row title={t('messageShadows')} sub={t('messageShadowsHint')}>
          <Switch on={settings.messageShadows !== false} onChange={(on) => void setSettings({ messageShadows: on })} />
        </Row>
      </Group>
    </>
  )
}

function AccountsPage(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const accounts = Object.values(useStore((s) => s.accounts))
  const removeAccount = useStore((s) => s.removeAccount)
  const reconnect = useStore((s) => s.reconnect)
  const toggleMute = useStore((s) => s.toggleMute)
  const openSheet = useStore((s) => s.openSheet)

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
    <Group>
      {accounts.length === 0 && (
        <div className="settings-row">
          <div className="settings-row-text settings-empty">{t('noAccounts')}</div>
        </div>
      )}
      {accounts.map((account) => {
        const muted = settings.muted.accounts.includes(account.id)
        return (
          <div className="settings-row" key={account.id}>
            <Avatar name={account.displayName} url={account.avatarUrl} size={36} platform={account.platform} />
            <div className="settings-row-text">
              <div className="settings-row-title">
                {account.displayName}
                {account.demo && <span className="settings-row-badge">{t('demoBadge')}</span>}
              </div>
              <div className="settings-row-sub">
                <span className={`status-dot ${account.status}`} style={{ display: 'inline-block', marginRight: 5 }} />
                {PLATFORMS[account.platform].name} · {statusLabel(account.status)}
                {account.error && account.status === 'error' && ` — ${account.error}`}
              </div>
            </div>
            <div className="settings-row-actions">
              <button className={`icon-btn ${muted ? 'active' : ''}`} title={muted ? t('unmute') : t('mute')} onClick={() => void toggleMute('accounts', account.id)}>
                <BellOff size={15} />
              </button>
              <button className="icon-btn" title={t('reconnect')} onClick={() => void reconnect(account.id)}>
                <RefreshCw size={15} />
              </button>
              <button className="icon-btn danger" title={t('remove')} onClick={() => void removeAccount(account.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        )
      })}
      <button className="settings-row settings-row-btn accent" onClick={() => openSheet({ kind: 'add-account' })}>
        <Plus size={16} strokeWidth={2.4} />
        <span className="settings-row-title">{t('addAccount')}</span>
      </button>
    </Group>
  )
}

/** Settings rows reuse the buttons' own labels. */
const BUBBLE_ACTION_LABELS: Record<BubbleAction, TKey> = {
  react: 'react',
  reply: 'reply',
  forward: 'forward',
  translate: 'aiTranslate',
  speak: 'aiSpeak',
  todo: 'todoFromMessage',
  save: 'saveAction',
  unsend: 'unsend'
}

/** Where Download in the photo viewer saves, and whether it asks each time. */
function DownloadSettings(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [folder, setFolder] = useState<{ path: string; label: string; custom: boolean } | undefined>()
  useEffect(() => {
    void window.unison.app.downloadFolder().then(setFolder).catch(() => undefined)
  }, [settings.downloadDir])
  const pick = async (): Promise<void> => {
    const path = await window.unison.app.pickDownloadFolder()
    if (path) await setSettings({ downloadDir: path })
  }
  return (
    <Group label={t('downloadsTitle')}>
      <Row title={t('downloadFolder')} sub={folder?.label ?? '…'} />
      <div className="settings-row backup-buttons">
        <button className="btn" onClick={() => void pick()}>
          <FolderOpen size={15} strokeWidth={2.2} /> {t('downloadFolderChange')}
        </button>
        <button className="btn secondary" onClick={() => void window.unison.app.openDownloadFolder()}>
          {t('downloadFolderOpen')}
        </button>
        {folder?.custom && (
          <button className="btn secondary" onClick={() => void setSettings({ downloadDir: undefined })}>
            {t('downloadFolderReset')}
          </button>
        )}
      </div>
      <Row title={t('askWhereToSave')} sub={t('askWhereToSaveHint')}>
        <Switch on={!!settings.askWhereToSave} onChange={(on) => void setSettings({ askWhereToSave: on })} />
      </Row>
    </Group>
  )
}

function ChatPage(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  // The GIF library built into this release (users only need a key of their own when there is none).
  const [gifBuiltIn, setGifBuiltIn] = useState<string | null>(null)
  useEffect(() => {
    void window.unison.app.gifDefault().then((p) => setGifBuiltIn(p === 'giphy' ? 'GIPHY' : p ? 'KLIPY' : null)).catch(() => undefined)
  }, [])

  return (
    <>
      <Group>
        <Row title={t('sendOnEnter')} sub={t('sendOnEnterHint')}>
          <Switch on={settings.sendOnEnter} onChange={(sendOnEnter) => void setSettings({ sendOnEnter })} />
        </Row>
        <Row title={t('readReceipts')} sub={t('readReceiptsHint')}>
          <Switch on={settings.sendReadReceipts !== false} onChange={(on) => void setSettings({ sendReadReceipts: on })} />
        </Row>
        <Row title={t('effects')} sub={t('effectsHint')}>
          <Switch on={settings.effects !== false} onChange={(on) => void setSettings({ effects: on })} />
        </Row>
      </Group>
      <Group label={t('bubbleActionsTitle')}>
        <Row title={t('bubbleActionsTitle')} sub={t('bubbleActionsHint')} />
        {BUBBLE_ACTIONS.map((action) => (
          <Row key={action} title={t(BUBBLE_ACTION_LABELS[action])}>
            <Switch on={settings.bubbleActions?.[action] !== false} onChange={(on) => void setSettings({ bubbleActions: { ...settings.bubbleActions, [action]: on } })} />
          </Row>
        ))}
        <Row title={t('actionLabels')} sub={t('actionLabelsHint')}>
          <Switch on={settings.actionLabels !== false} onChange={(on) => void setSettings({ actionLabels: on })} />
        </Row>
      </Group>
      <Group>
        <Row title={t('quickReplies')} sub={t('quickRepliesHint')} />
        <QuickReplyManager />
      </Group>
      <DownloadSettings />
      <Group>
        <Row
          title={t('gifSettingsTitle')}
          sub={settings.gif?.key ? t('gifSettingsOn', { provider: settings.gif.provider === 'giphy' ? 'GIPHY' : 'KLIPY' }) : gifBuiltIn ? t('gifBuiltIn', { provider: gifBuiltIn }) : t('gifSetupHint')}
        />
        <div className="settings-row">
          <GifKeyForm />
        </div>
      </Group>
    </>
  )
}

function NotificationsPage(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const toggleMute = useStore((s) => s.toggleMute)
  const { list: tagList } = useTagDefs()
  return (
    <>
      <Group>
        <Row title={t('notifications')} sub={t('notificationsHint')}>
          <Switch on={settings.notifications} onChange={(notifications) => void setSettings({ notifications })} />
        </Row>
        <SoundSettings />
      </Group>
      <Group label={t('groupMute')}>
        <Row title={t('muteByPlatform')} stack>
          <div className="mute-chips">
            {PLATFORM_ORDER.map((platform) => {
              const muted = settings.muted.platforms.includes(platform)
              return (
                <button key={platform} className={`mute-chip ${muted ? 'muted' : ''}`} onClick={() => void toggleMute('platforms', platform)}>
                  <PlatformIcon platform={platform} size={22} />
                  {PLATFORMS[platform].name}
                  {muted && <BellOff size={12} />}
                </button>
              )
            })}
          </div>
        </Row>
        <Row title={t('muteByTag')} stack>
          <div className="mute-chips">
            {tagList.map((tag) => {
              const muted = settings.muted.tags.includes(tag.id)
              return (
                <TagChip key={tag.id} tag={tag} size="sm" flat={muted} onClick={() => void toggleMute('tags', tag.id)}>
                  {muted && <BellOff size={12} strokeWidth={2.4} />}
                </TagChip>
              )
            })}
          </div>
        </Row>
      </Group>
    </>
  )
}

function TagsPage(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const conversationMap = useStore((s) => s.conversations)
  const unhideConversation = useStore((s) => s.unhideConversation)
  const strangers = Object.entries(settings.hidden ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id, at]) => ({ id, at, conversation: conversationMap[id] }))
  return (
    <>
      <Group>
        <Row title={t('tagManage')} sub={t('tagManageHint')} />
        <TagManager />
      </Group>
      <Group>
        <Row title={t('strangersSection')} sub={t('strangersHint')} />
        {strangers.length === 0 && (
          <div className="settings-row">
            <div className="settings-row-text settings-empty">{t('strangersEmpty')}</div>
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
      </Group>
    </>
  )
}

function AiPage(): JSX.Element {
  return (
    <Group>
      <AiSettings />
    </Group>
  )
}

/** Sync between computers through a folder a cloud drive already keeps in step. */
function SyncSettings(): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const showToast = useStore((s) => s.showToast)
  const [status, setStatus] = useState<SyncStatus>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const load = (): void => void window.unison.sync.status().then((s) => alive && setStatus(s))
    load()
    const timer = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const run = async (action: () => Promise<SyncStatus | null>, done?: string): Promise<void> => {
    setBusy(true)
    try {
      const next = await action()
      if (next) {
        setStatus(next)
        if (next.error) showToast(next.error, 'error')
        else if (done) showToast(done)
      }
    } catch (err) {
      showToast((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Group label={t('syncSection')}>
      <Row title={t('syncTitle')} sub={t('syncHint')} />
      {status?.enabled ? (
        <>
          <Row title={t('syncFolder')} sub={status.folder} />
          <Row
            title={t('syncDevices')}
            sub={
              status.devices.length
                ? status.devices.map((d) => `${d.name} · ${formatListTime(d.updatedAt, language)}`).join(', ')
                : t('syncNoDevices', { name: status.deviceName })
            }
          />
          <Row
            title={t('syncThisDevice', { name: status.deviceName })}
            sub={status.error ? t('syncError', { error: status.error }) : status.lastSyncAt ? t('syncLast', { time: formatListTime(status.lastSyncAt, language) }) : undefined}
          />
          <div className="settings-row backup-buttons">
            <button className="btn primary" disabled={busy} onClick={() => void run(() => window.unison.sync.now(), t('syncDone'))}>
              <RefreshCw size={15} strokeWidth={2.2} /> {t('syncNow')}
            </button>
            <button className="btn" disabled={busy} onClick={() => void run(() => window.unison.sync.choose())}>
              <FolderOpen size={15} strokeWidth={2.2} /> {t('syncChange')}
            </button>
            <button className="btn" disabled={busy} onClick={() => void run(() => window.unison.sync.disable())}>
              <CloudOff size={15} strokeWidth={2.2} /> {t('syncOff')}
            </button>
          </div>
        </>
      ) : (
        <>
          <Row title={t('syncHowTitle')} sub={t('syncHow')} />
          <div className="settings-row backup-buttons">
            <button className="btn primary" disabled={busy || !status} onClick={() => void run(() => window.unison.sync.choose(), t('syncOn'))}>
              <FolderSync size={15} strokeWidth={2.2} /> {t('syncChoose')}
            </button>
          </div>
        </>
      )}
    </Group>
  )
}

function DataPage(): JSX.Element {
  const t = useT()
  const openSheet = useStore((s) => s.openSheet)
  return (
    <>
      <SyncSettings />
      <Group>
        <Row title={t('backupSectionTitle')} sub={t('backupSectionHint')} />
        <div className="settings-row backup-buttons">
          <button className="btn primary" onClick={() => openSheet({ kind: 'backup', mode: 'create' })}>
            <FileArchive size={15} strokeWidth={2.2} /> {t('backupCreate')}
          </button>
          <button className="btn" onClick={() => openSheet({ kind: 'backup', mode: 'restore' })}>
            <ArchiveRestore size={15} strokeWidth={2.2} /> {t('restoreTitle')}
          </button>
        </div>
      </Group>
      <Group label={t('legalSection')}>
        {(['notice', 'license', 'terms', 'privacy', 'credits'] as const).map((doc) => (
          <button key={doc} className="settings-row settings-row-btn" onClick={() => openSheet({ kind: 'legal', doc })}>
            <div className="settings-row-text">
              <div className="settings-row-title">{t(LEGAL_TITLE_KEY[doc])}</div>
            </div>
            <ChevronRight size={16} />
          </button>
        ))}
      </Group>
    </>
  )
}
