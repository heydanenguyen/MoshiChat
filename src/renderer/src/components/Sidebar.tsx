import { useEffect, useRef, useState } from 'react'
import { BellOff, ChartNoAxesColumn, ChevronDown, Inbox, ListTodo, PanelLeftClose, PanelLeftOpen, Plus, Settings, Trash2 } from 'lucide-react'
import type { SidebarSection } from '@shared/types'
import { MemoryCard } from './Insights'
import { useOpenTodos } from './TodoSheet'
import { UpdateCard } from './UpdateCard'
import type { Platform, TagId } from '@shared/types'
import { PLATFORMS, PLATFORM_ORDER } from '@shared/types'
import { TagChip } from './Tag'
import { LogoMark } from './Logo'
import { TagCreator } from './TagEditor'
import { useStore, useT, useTagDefs, useUnreadCounts } from '../store'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'

type MuteTarget = { kind: 'platforms'; id: Platform } | { kind: 'accounts'; id: string } | { kind: 'tags'; id: TagId }

interface Menu {
  target: MuteTarget
  label: string
  x: number
  y: number
  /** Second click on "Delete tag" confirms. */
  confirmDelete?: boolean
}

export function Sidebar(): JSX.Element {
  const t = useT()
  const openTodos = useOpenTodos()
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const accounts = useStore((s) => s.accounts)
  const openSheet = useStore((s) => s.openSheet)
  const collapsed = useStore((s) => s.settings.sidebarCollapsed)
  const folded = useStore((s) => s.settings.sidebarSections)
  const setSettings = useStore((s) => s.setSettings)
  const isFolded = (section: SidebarSection): boolean => !collapsed && !!folded?.[section]
  const toggleFold = (section: SidebarSection): void => {
    void setSettings({ sidebarSections: { ...(folded ?? {}), [section]: !folded?.[section] } })
  }
  /** Section heading that folds its list away; a small count keeps the essentials visible while folded. */
  const heading = (section: SidebarSection, label: string, summary?: JSX.Element, extra?: JSX.Element): JSX.Element => (
    <div className={`sidebar-section-head foldable ${isFolded(section) ? 'folded' : ''}`}>
      <button className="sidebar-section-title fold-toggle" onClick={() => toggleFold(section)} aria-expanded={!isFolded(section)} title={isFolded(section) ? t('expandSection') : t('collapseSection')}>
        <ChevronDown size={12} strokeWidth={2.8} className="fold-chevron" />
        {label}
        {isFolded(section) && summary}
      </button>
      {extra}
    </div>
  )
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const language = useStore((s) => s.settings.language)
  const tags = useStore((s) => s.settings.tags)
  const conversations = useStore((s) => s.conversations)
  const { list: tagList } = useTagDefs()
  const muted = useStore((s) => s.settings.muted)
  const toggleMute = useStore((s) => s.toggleMute)
  const deleteTag = useStore((s) => s.deleteTag)
  const unread = useUnreadCounts()
  const [menu, setMenu] = useState<Menu | undefined>()
  const [creator, setCreator] = useState<{ x: number; y: number } | undefined>()
  const addRef = useRef<HTMLButtonElement>(null)

  // The tag creator floats next to the sidebar; outside clicks and Escape close it.
  useEffect(() => {
    if (!creator) return
    const close = (): void => setCreator(undefined)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [creator])

  const openCreator = (anchor: HTMLElement | null): void => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = 300
    const height = 360
    const x = collapsed ? rect.right + 10 : Math.min(rect.left, window.innerWidth - width - 12)
    const y = Math.max(12, Math.min(collapsed ? rect.top : rect.bottom + 8, window.innerHeight - height - 12))
    setCreator({ x, y })
  }

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
  // Count only chats that exist right now (tags of removed accounts or old chats are ignored).
  for (const [conversationId, list] of Object.entries(tags)) {
    if (!conversations[conversationId]) continue
    for (const tag of list) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
  }

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
            <LogoMark size={30} />
            <span className="brand-word">{t('appName')}</span>
          </div>
        )}
        <button className="icon-btn sidebar-toggle" onClick={() => void toggleSidebar()} title={collapsed ? t('expandSidebar') : t('collapseSidebar')}>
          {collapsed ? <PanelLeftOpen size={17} strokeWidth={2} /> : <PanelLeftClose size={17} strokeWidth={2} />}
        </button>
      </div>

      <div className="sidebar-scroll scroll">
        <div className="sidebar-section">
          {!collapsed && heading('inboxes', t('inboxes'), unread.total > 0 ? <span className="fold-count">{unread.total}</span> : undefined)}
          {!isFolded('inboxes') && (
          <>
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
                <PlatformIcon platform={platform} size={26} className="nav-item-icon" />
                {!collapsed && <span className="nav-item-label">{PLATFORMS[platform].name}</span>}
                {!collapsed && isMuted(target) && <BellOff size={12} className="muted-mark" />}
                {!collapsed && badge(unread.byPlatform[platform])}
                {collapsed && unread.byPlatform[platform] > 0 && <span className="rail-dot" />}
              </button>
            )
          })}
          <button className="nav-item" onClick={() => openSheet({ kind: 'todos' })} title={t('todos')}>
            <span className="nav-item-icon tile todo">
              <ListTodo size={16} strokeWidth={2.2} />
            </span>
            {!collapsed && <span className="nav-item-label">{t('todos')}</span>}
            {!collapsed && badge(openTodos)}
            {collapsed && openTodos > 0 && <span className="rail-dot" />}
          </button>
          <button className="nav-item" onClick={() => openSheet({ kind: 'insights' })} title={t('insights')}>
            <span className="nav-item-icon tile insights">
              <ChartNoAxesColumn size={16} strokeWidth={2.2} />
            </span>
            {!collapsed && <span className="nav-item-label">{t('insights')}</span>}
          </button>
          </>
          )}
        </div>
        <MemoryCard collapsed={collapsed} />

        <div className="sidebar-section">
          {!collapsed &&
            heading(
              'tags',
              t('tags'),
              tagList.length > 0 ? <span className="fold-count">{tagList.length}</span> : undefined,
              <button ref={addRef} className="section-add" onMouseDown={(e) => e.stopPropagation()} onClick={() => (creator ? setCreator(undefined) : openCreator(addRef.current))} title={t('tagNew')}>
                <Plus size={14} strokeWidth={2.6} />
              </button>
            )}
          {!isFolded('tags') && (
          <div className={`sidebar-tags ${collapsed ? 'rail' : ''}`}>
            {tagList.map((tag) => {
              const target: MuteTarget = { kind: 'tags', id: tag.id }
              const active = filter === `tag:${tag.id}`
              return (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  size="sm"
                  iconOnly={collapsed}
                  flat={!active}
                  count={collapsed ? undefined : (tagCounts[tag.id] ?? 0)}
                  dot={(unread.byTag[tag.id] ?? 0) > 0}
                  onClick={() => setFilter(active ? 'all' : `tag:${tag.id}`)}
                  onContextMenu={contextFor(target, tag.name[language])}
                  title={`${tag.name[language]} · ${(tagCounts[tag.id] ?? 0) === 1 ? t('tagUsageOne') : t('tagUsage', { count: tagCounts[tag.id] ?? 0 })}`}
                >
                  {!collapsed && isMuted(target) && <BellOff size={11} strokeWidth={2.4} className="tag-pill-muted" />}
                </TagChip>
              )
            })}
            {(collapsed || tagList.length === 0) && (
              <button
                className={`tag-pill sm add ${collapsed ? 'icon-only' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => (creator ? setCreator(undefined) : openCreator(e.currentTarget))}
                title={t('tagNew')}
              >
                <Plus size={13} strokeWidth={2.6} />
                {!collapsed && <span className="tag-pill-label">{t('tagNew')}</span>}
              </button>
            )}
          </div>
          )}
        </div>

        {accountList.length > 0 && (
          <div className="sidebar-section">
            {!collapsed && heading('accounts', t('accounts'), <span className="fold-count">{accountList.length}</span>)}
            {!isFolded('accounts') && accountList.map((account) => {
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
        <UpdateCard collapsed={collapsed} />
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
          {menu.target.kind === 'tags' && (
            <button
              className={`context-menu-item danger ${menu.confirmDelete ? 'confirm' : ''}`}
              onClick={() => {
                if (!menu.confirmDelete) {
                  setMenu({ ...menu, confirmDelete: true })
                  return
                }
                void deleteTag(menu.target.id)
                setMenu(undefined)
              }}
            >
              <Trash2 size={15} />
              <span>{menu.confirmDelete ? t('tagDeleteSure') : t('tagDelete')}</span>
            </button>
          )}
        </div>
      )}

      {creator && (
        <div className="tag-popover" style={{ left: creator.x, top: creator.y }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('tagNew')}>
          <div className="tag-popover-title">{t('tagNew')}</div>
          <TagCreator onCreated={() => setCreator(undefined)} onCancel={() => setCreator(undefined)} />
        </div>
      )}
    </aside>
  )
}
