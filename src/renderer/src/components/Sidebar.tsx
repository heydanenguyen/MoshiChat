import { useEffect, useState } from 'react'
import { BellOff, Inbox, PanelLeftClose, PanelLeftOpen, Plus, Settings, Sparkles } from 'lucide-react'
import type { Platform, TagId } from '@shared/types'
import { PLATFORMS, PLATFORM_ORDER, TAGS, TAG_ORDER } from '@shared/types'
import { useStore, useT, useUnreadCounts } from '../store'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'

type MuteTarget = { kind: 'platforms'; id: Platform } | { kind: 'accounts'; id: string } | { kind: 'tags'; id: TagId }

interface Menu {
  target: MuteTarget
  label: string
  x: number
  y: number
}

export function Sidebar(): JSX.Element {
  const t = useT()
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const accounts = useStore((s) => s.accounts)
  const openSheet = useStore((s) => s.openSheet)
  const collapsed = useStore((s) => s.settings.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const language = useStore((s) => s.settings.language)
  const tags = useStore((s) => s.settings.tags)
  const muted = useStore((s) => s.settings.muted)
  const toggleMute = useStore((s) => s.toggleMute)
  const unread = useUnreadCounts()
  const [menu, setMenu] = useState<Menu | undefined>()

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(undefined)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const accountList = Object.values(accounts)
  const platformsWithAccounts = PLATFORM_ORDER.filter((p) => accountList.some((a) => a.platform === p))
  const platforms = platformsWithAccounts.length ? platformsWithAccounts : PLATFORM_ORDER
  const tagCounts: Record<string, number> = {}
  for (const list of Object.values(tags)) for (const tag of list) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
  const usedTags = TAG_ORDER.filter((tag) => tagCounts[tag])

  const badge = (count?: number): JSX.Element | null => (count ? <span className="nav-badge">{count}</span> : null)
  const isMuted = (target: MuteTarget): boolean => (muted[target.kind] as string[]).includes(target.id)
  const contextFor = (target: MuteTarget, label: string) => (e: React.MouseEvent): void => {
    e.preventDefault()
    setMenu({ target, label, x: e.clientX, y: e.clientY })
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-top">
        {!collapsed && (
          <div className="brand">
            <span className="brand-mark">
              <Sparkles size={13} strokeWidth={2.5} />
            </span>
            {t('appName')}
          </div>
        )}
        <button className="icon-btn sidebar-toggle" onClick={() => void toggleSidebar()} title={collapsed ? t('expandSidebar') : t('collapseSidebar')}>
          {collapsed ? <PanelLeftOpen size={17} strokeWidth={2} /> : <PanelLeftClose size={17} strokeWidth={2} />}
        </button>
      </div>

      <div className="sidebar-scroll scroll">
        <div className="sidebar-section">
          {!collapsed && <div className="sidebar-section-title">{t('inboxes')}</div>}
          <button className={`nav-item ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')} title={t('allInboxes')}>
            <span className="nav-item-icon tile accent">
              <Inbox size={14} strokeWidth={2.4} />
            </span>
            {!collapsed && <span className="nav-item-label">{t('allInboxes')}</span>}
            {!collapsed && badge(unread.total)}
            {collapsed && unread.total > 0 && <span className="rail-dot" />}
          </button>
          {platforms.map((platform) => {
            const target: MuteTarget = { kind: 'platforms', id: platform }
            return (
              <button
                key={platform}
                className={`nav-item ${filter === platform ? 'active' : ''}`}
                onClick={() => setFilter(platform)}
                onContextMenu={contextFor(target, PLATFORMS[platform].name)}
                title={PLATFORMS[platform].name}
              >
                <PlatformIcon platform={platform} size={26} variant="tile" className="nav-item-icon" />
                {!collapsed && <span className="nav-item-label">{PLATFORMS[platform].name}</span>}
                {!collapsed && isMuted(target) && <BellOff size={12} className="muted-mark" />}
                {!collapsed && badge(unread.byPlatform[platform])}
                {collapsed && unread.byPlatform[platform] > 0 && <span className="rail-dot" />}
              </button>
            )
          })}
        </div>

        {usedTags.length > 0 && (
          <div className="sidebar-section">
            {!collapsed && <div className="sidebar-section-title">{t('tags')}</div>}
            {usedTags.map((tag) => {
              const target: MuteTarget = { kind: 'tags', id: tag }
              return (
                <button
                  key={tag}
                  className={`nav-item ${filter === `tag:${tag}` ? 'active' : ''}`}
                  onClick={() => setFilter(`tag:${tag}`)}
                  onContextMenu={contextFor(target, TAGS[tag].name[language])}
                  title={TAGS[tag].name[language]}
                >
                  <span className="nav-item-icon tile" style={{ ['--brand' as string]: TAGS[tag].color } as React.CSSProperties}>
                    {TAGS[tag].emoji}
                  </span>
                  {!collapsed && <span className="nav-item-label">{TAGS[tag].name[language]}</span>}
                  {!collapsed && isMuted(target) && <BellOff size={12} className="muted-mark" />}
                  {!collapsed && <span className="nav-badge subtle">{tagCounts[tag]}</span>}
                  {collapsed && (unread.byTag[tag] ?? 0) > 0 && <span className="rail-dot" />}
                </button>
              )
            })}
          </div>
        )}

        {accountList.length > 0 && (
          <div className="sidebar-section">
            {!collapsed && <div className="sidebar-section-title">{t('accounts')}</div>}
            {accountList.map((account) => {
              const target: MuteTarget = { kind: 'accounts', id: account.id }
              return (
                <button
                  key={account.id}
                  className={`account-row ${filter === `account:${account.id}` ? 'active' : ''}`}
                  onClick={() => setFilter(`account:${account.id}`)}
                  onContextMenu={contextFor(target, account.displayName)}
                  title={`${account.displayName} · ${PLATFORMS[account.platform].name}${account.error ? ` · ${account.error}` : ''}`}
                >
                  <Avatar name={account.displayName} url={account.avatarUrl} size={30} platform={account.platform} />
                  {!collapsed && (
                    <span className="account-row-text">
                      <span className="account-row-name">{account.displayName}</span>
                      <span className="account-row-sub">
                        <span className={`status-dot ${account.status}`} />
                        {account.handle ?? PLATFORMS[account.platform].name}
                        {account.demo && ` · ${t('demoBadge')}`}
                      </span>
                    </span>
                  )}
                  {!collapsed && isMuted(target) && <BellOff size={12} className="muted-mark" />}
                  {!collapsed && badge(unread.byAccount[account.id])}
                  {collapsed && (unread.byAccount[account.id] ?? 0) > 0 && <span className="rail-dot" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="nav-item subtle" onClick={() => openSheet({ kind: 'add-account' })} title={t('addAccount')}>
          <span className="nav-item-icon">
            <Plus size={16} strokeWidth={2.2} />
          </span>
          {!collapsed && <span className="nav-item-label">{t('addAccount')}</span>}
        </button>
        <button className="nav-item subtle" onClick={() => openSheet({ kind: 'settings' })} title={t('settings')}>
          <span className="nav-item-icon">
            <Settings size={16} strokeWidth={2.2} />
          </span>
          {!collapsed && <span className="nav-item-label">{t('settings')}</span>}
        </button>
      </div>

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="context-menu-title">{menu.label}</div>
          <button
            className="context-menu-item"
            onClick={() => {
              void toggleMute(menu.target.kind, menu.target.id)
              setMenu(undefined)
            }}
          >
            <BellOff size={15} />
            <span>{isMuted(menu.target) ? t('unmute') : t('mute')}</span>
          </button>
        </div>
      )}
    </aside>
  )
}
