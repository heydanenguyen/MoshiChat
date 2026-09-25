import { Inbox, PanelLeftClose, PanelLeftOpen, Plus, Settings, Sparkles } from 'lucide-react'
import { PLATFORMS, PLATFORM_ORDER, TAGS, TAG_ORDER } from '@shared/types'
import { useStore, useT, useUnreadCounts } from '../store'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'

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
  const unread = useUnreadCounts()

  const accountList = Object.values(accounts)
  const platformsWithAccounts = PLATFORM_ORDER.filter((p) => accountList.some((a) => a.platform === p))
  const platforms = platformsWithAccounts.length ? platformsWithAccounts : PLATFORM_ORDER
  const tagCounts: Record<string, number> = {}
  for (const list of Object.values(tags)) for (const tag of list) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
  const usedTags = TAG_ORDER.filter((tag) => tagCounts[tag])

  const badge = (count?: number): JSX.Element | null => (count ? <span className="nav-badge">{count}</span> : null)

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-top drag">
        {!collapsed && (
          <div className="brand">
            <span className="brand-mark">
              <Sparkles size={13} strokeWidth={2.5} />
            </span>
            {t('appName')}
          </div>
        )}
        <button className="icon-btn no-drag sidebar-toggle" onClick={() => void toggleSidebar()} title={collapsed ? t('expandSidebar') : t('collapseSidebar')}>
          {collapsed ? <PanelLeftOpen size={17} strokeWidth={2} /> : <PanelLeftClose size={17} strokeWidth={2} />}
        </button>
      </div>

      <div className="sidebar-scroll scroll">
        <div className="sidebar-section">
          {!collapsed && <div className="sidebar-section-title">{t('inboxes')}</div>}
          <button className={`nav-item ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')} title={t('allInboxes')}>
            <span className="nav-item-icon">
              <Inbox size={16} strokeWidth={2.2} />
            </span>
            {!collapsed && <span className="nav-item-label">{t('allInboxes')}</span>}
            {!collapsed && badge(unread.total)}
            {collapsed && unread.total > 0 && <span className="rail-dot" />}
          </button>
          {platforms.map((platform) => (
            <button
              key={platform}
              className={`nav-item ${filter === platform ? 'active' : ''}`}
              onClick={() => setFilter(platform)}
              title={PLATFORMS[platform].name}
            >
              <span className="nav-item-icon">
                <PlatformIcon platform={platform} size={17} />
              </span>
              {!collapsed && <span className="nav-item-label">{PLATFORMS[platform].name}</span>}
              {!collapsed && badge(unread.byPlatform[platform])}
              {collapsed && unread.byPlatform[platform] > 0 && <span className="rail-dot" />}
            </button>
          ))}
        </div>

        {usedTags.length > 0 && (
          <div className="sidebar-section">
            {!collapsed && <div className="sidebar-section-title">{t('tags')}</div>}
            {usedTags.map((tag) => (
              <button
                key={tag}
                className={`nav-item ${filter === `tag:${tag}` ? 'active' : ''}`}
                onClick={() => setFilter(`tag:${tag}`)}
                title={TAGS[tag].name[language]}
              >
                <span className="nav-item-icon tag-icon" style={{ background: TAGS[tag].color }}>
                  {TAGS[tag].emoji}
                </span>
                {!collapsed && <span className="nav-item-label">{TAGS[tag].name[language]}</span>}
                {!collapsed && <span className="nav-badge subtle">{tagCounts[tag]}</span>}
                {collapsed && (unread.byTag[tag] ?? 0) > 0 && <span className="rail-dot" />}
              </button>
            ))}
          </div>
        )}

        {accountList.length > 0 && (
          <div className="sidebar-section">
            {!collapsed && <div className="sidebar-section-title">{t('accounts')}</div>}
            {accountList.map((account) => (
              <button
                key={account.id}
                className={`account-row ${filter === `account:${account.id}` ? 'active' : ''}`}
                onClick={() => setFilter(`account:${account.id}`)}
                title={`${account.displayName} · ${PLATFORMS[account.platform].name}${account.error ? ` · ${account.error}` : ''}`}
              >
                <Avatar name={account.displayName} url={account.avatarUrl} size={28} platform={account.platform} />
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
                {!collapsed && badge(unread.byAccount[account.id])}
                {collapsed && (unread.byAccount[account.id] ?? 0) > 0 && <span className="rail-dot" />}
              </button>
            ))}
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
    </aside>
  )
}
