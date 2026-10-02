import { PLATFORMS, type Platform } from '@shared/types'
import { useStore, useT, useUnreadCounts } from '../store'
import { useAccountLabels } from '../accountLabels'
import { formatBadge } from '../quickFilter'
import { Avatar } from './Avatar'

/**
 * With an app picked (or one of its accounts) and more than one account on it: All · @one · @two, to see each
 * account's chats on their own. Picking an account is the same as picking it in the sidebar.
 */
export function AccountFilters(): JSX.Element | null {
  const t = useT()
  const filter = useStore((s) => s.filter)
  const accounts = useStore((s) => s.accounts)
  const setFilter = useStore((s) => s.setFilter)
  const labels = useAccountLabels()
  const unread = useUnreadCounts()
  const accountId = filter.startsWith('account:') ? filter.slice(8) : undefined
  const platform = (accountId ? accounts[accountId]?.platform : filter in PLATFORMS ? filter : undefined) as Platform | undefined
  if (!platform) return null
  const mine = Object.values(accounts).filter((a) => a.platform === platform && labels[a.id])
  if (mine.length < 2) return null

  return (
    <div className="quick-filters-wrap">
      <div className="quick-filters account-filters" role="radiogroup" aria-label={t('accountFilters', { app: PLATFORMS[platform].name })}>
        <button type="button" role="radio" aria-checked={!accountId} className={`quick-chip ${!accountId ? 'active' : ''}`} onClick={() => setFilter(platform)}>
          <span className="quick-chip-label">{t('allAccounts')}</span>
        </button>
        {mine.map((account) => {
          const active = accountId === account.id
          const count = unread.byAccount[account.id] ?? 0
          return (
            <button
              key={account.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={account.handle ? `${account.displayName} · ${account.handle}` : account.displayName}
              className={`quick-chip account-chip ${active ? 'active' : ''}`}
              onClick={() => setFilter(`account:${account.id}`)}
            >
              <Avatar name={account.displayName} url={account.avatarUrl} size={18} />
              <span className="quick-chip-label">{labels[account.id]}</span>
              {count > 0 && (
                <span className="quick-chip-count strong" aria-hidden>
                  {formatBadge(count)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
