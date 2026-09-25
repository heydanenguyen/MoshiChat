import { Inbox, Plus, Settings, Sparkles } from 'lucide-react'
import { PLATFORMS, PLATFORM_ORDER } from '@shared/types'
import { useStore, useT, useUnreadCounts } from '../store'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'

export function Sidebar(): JSX.Element {
  const t = useT()
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const accounts = useStore((s) => s.accounts)
  const openSheet = useStore((s) => s.openSheet)
  const unread = useUnreadCounts()

  const accountList = Object.values(accounts)
  const platformsWithAccounts = PLATFORM_ORDER.filter((p) => accountList.some((a) => a.platform === p))
  const platforms = platformsWithAccounts.length ? platformsWithAccounts : PLATFORM_ORDER

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={13} strokeWidth={2.5} />
          </span>
          {t('appName')}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">{t('inboxes')}</div>
        <button className={`nav-item ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          <span className="nav-item-icon">
            <Inbox size={16} strokeWidth={2.2} />
          </span>
          <span className="nav-item-label">{t('allInboxes')}</span>
          {unread.total > 0 && <span className="nav-badge">{unread.total}</span>}
        </button>
        {platforms.map((platform) => (
          <button
            key={platform}
            className={`nav-item ${filter === platform ? 'active' : ''}`}
            onClick={() => setFilter(platform)}
          >
            <span className="nav-item-icon">
              <PlatformIcon platform={platform} size={17} />
            </span>
            <span className="nav-item-label">{PLATFORMS[platform].name}</span>
            {unread.byPlatform[platform] > 0 && <span className="nav-badge">{unread.byPlatform[platform]}</span>}
          </button>
        ))}
      </div>

      {accountList.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">{t('accounts')}</div>
          {accountList.map((account) => (
            <button
              key={account.id}
              className={`account-row ${filter === `account:${account.id}` ? 'active' : ''}`}
              onClick={() => setFilter(`account:${account.id}`)}
              title={account.error}
            >
              <Avatar name={account.displayName} url={account.avatarUrl} size={28} platform={account.platform} />
              <span className="account-row-text">
                <span className="account-row-name">{account.displayName}</span>
                <span className="account-row-sub">
                  <span className={`status-dot ${account.status}`} />
                  {account.handle ?? PLATFORMS[account.platform].name}
                  {account.demo && ` · ${t('demoBadge')}`}
                </span>
              </span>
              {unread.byAccount[account.id] > 0 && <span className="nav-badge">{unread.byAccount[account.id]}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-footer">
        <button className="nav-item subtle" onClick={() => openSheet({ kind: 'add-account' })}>
          <span className="nav-item-icon">
            <Plus size={16} strokeWidth={2.2} />
          </span>
          <span className="nav-item-label">{t('addAccount')}</span>
        </button>
        <button className="nav-item subtle" onClick={() => openSheet({ kind: 'settings' })}>
          <span className="nav-item-icon">
            <Settings size={16} strokeWidth={2.2} />
          </span>
          <span className="nav-item-label">{t('settings')}</span>
        </button>
      </div>
    </aside>
  )
}
