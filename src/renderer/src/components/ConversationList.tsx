import { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BellOff, CheckCheck, CircleDot, Columns2, EyeOff, MoreHorizontal, Pin, PinOff, Search, SquarePen, X } from 'lucide-react'
import { PLATFORMS, isMutedBy, type Platform } from '@shared/types'
import { isPinned, useChatList, useShowPlatformBadge, useStore, useT, useTagDefs } from '../store'
import { formatBadge, isUnread } from '../quickFilter'
import { formatListTime, modKey } from '../utils'
import { openIds } from '../panes'
import { popoverShift } from '../popover'

/** Drag payload type for a chat row (dropped onto a pane of the chat area). */
export const CONVERSATION_DRAG = 'application/x-moshi-conversation'
import { Avatar } from './Avatar'
import { PreviewText } from './MessageParts'
import { TagChip } from './Tag'
import { ReconnectBanner } from './ChatView'
import { isBirthdayToday } from '@shared/extras'
import { QuickFilterEmpty, QuickFilters } from './QuickFilters'

interface TagMenuState {
  conversationId: string
  x: number
  y: number
}

export function ConversationList(): JSX.Element {
  const t = useT()
  const { conversations, counts } = useChatList()
  const allConversations = useStore((s) => s.conversations)
  const quickFilter = useStore((s) => s.quickFilter)
  const markedUnread = useStore((s) => s.settings.markedUnread)
  const markUnread = useStore((s) => s.markUnread)
  const markRead = useStore((s) => s.markRead)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const openBeside = useStore((s) => s.openBeside)
  const layout = useStore((s) => s.layout)
  const canSplit = useStore((s) => s.wide && !s.narrow)
  const beside = new Set(openIds(layout).filter((id) => id !== selectedId))
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const searchHits = useStore((s) => s.searchHits)
  const openHit = useStore((s) => s.openHit)
  const filter = useStore((s) => s.filter)
  const accounts = useStore((s) => s.accounts)
  const typing = useStore((s) => s.typing)
  const language = useStore((s) => s.settings.language)
  const tags = useStore((s) => s.settings.tags)
  const toggleTag = useStore((s) => s.toggleTag)
  const overrides = useStore((s) => s.settings.contactOverrides)
  const prefetch = useStore((s) => s.prefetch)
  const drafts = useStore((s) => s.drafts)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pins = useStore((s) => s.settings.pins)
  const togglePin = useStore((s) => s.togglePin)
  const { list: tagList, byId: tagById } = useTagDefs()
  const muted = useStore((s) => s.settings.muted)
  const toggleMute = useStore((s) => s.toggleMute)
  const openSheet = useStore((s) => s.openSheet)
  const showBadge = useShowPlatformBadge()
  const [menu, setMenu] = useState<TagMenuState | undefined>()
  const menuRef = useRef<HTMLDivElement>(null)
  const hidden = useStore((s) => s.settings.hidden)
  const hideConversation = useStore((s) => s.hideConversation)
  /**
   * The "…" button opens the same menu as a right-click, hanging under the button and kept inside the window. Only
   * a click opens it (resting the pointer on it does not); a second click closes it.
   */
  const openMenuAt = (el: HTMLElement, conversationId: string): void => {
    const r = el.getBoundingClientRect()
    setMenu((m) => (m?.conversationId === conversationId ? undefined : { conversationId, x: Math.max(8, Math.min(r.right - 210, window.innerWidth - 226)), y: r.bottom + 4 }))
  }
  const hasAccounts = Object.keys(accounts).length > 0
  const searching = search.trim().length > 0
  // A chip with nothing in it; a sidebar filter with no chats at all keeps the usual "no conversations" note.
  const quickEmpty = !searching && quickFilter !== 'all' && counts.all > 0 && conversations.length === 0
  // From the store, not the list: a chat can leave the filtered list while its menu is open (untagging it).
  const menuConversation = menu ? allConversations[menu.conversationId] : undefined
  const menuUnread = !!menuConversation && isUnread(menuConversation, markedUnread)

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

  // A right-click low in the list, or near the window's right edge, used to open the menu past the window: move
  // it back inside. offsetWidth/Height ignore the open animation's scale, so this is the size the menu settles at.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el || !menu) return
    const dx = popoverShift({ left: menu.x, right: menu.x + el.offsetWidth }, { left: 0, right: window.innerWidth })
    const dy = popoverShift({ left: menu.y, right: menu.y + el.offsetHeight }, { left: 0, right: window.innerHeight })
    el.style.left = `${menu.x + dx}px`
    el.style.top = `${menu.y + dy}px`
  }, [menu])

  const title =
    filter === 'all'
      ? t('messages')
      : filter.startsWith('account:')
        ? (accounts[filter.slice(8)]?.displayName ?? t('messages'))
        : filter.startsWith('tag:')
          ? (tagById[filter.slice(4)]?.name[language] ?? t('messages'))
          : PLATFORMS[filter as Platform].name

  const visibleHits = searchHits.filter((h) => {
    if (hidden?.[h.conversation.id]) return false
    if (filter === 'all') return true
    if (filter.startsWith('account:')) return h.conversation.accountId === filter.slice(8)
    if (filter.startsWith('tag:')) return (tags[h.conversation.id] ?? []).includes(filter.slice(4))
    return h.conversation.platform === filter
  })

  const ringFor = (id: string): string | undefined => {
    return (tags[id] ?? []).map((tag) => tagById[tag]).find(Boolean)?.color
  }

  return (
    <section className="list-col">
      <header className="list-header drag">
        <h1 className="list-title">{title}</h1>
        <button className="icon-btn no-drag" title={`${t('newChat')} (Ctrl N)`} onClick={() => openSheet({ kind: 'new-chat' })}>
          <SquarePen size={18} strokeWidth={2} />
        </button>
      </header>

      <div className="search-field">
        <Search size={14} strokeWidth={2.4} />
        <input type="text" placeholder={t('searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
        {search && (
          <button className="search-clear" onClick={() => setSearch('')} aria-label={t('close')}>
            <X size={11} strokeWidth={3} />
          </button>
        )}
      </div>

      {!searching && (counts.all > 0 || quickFilter !== 'all') && <QuickFilters counts={counts} />}

      {Object.values(accounts)
        .filter((a) => !a.demo && (a.status === 'needs_auth' || a.status === 'error'))
        .filter((a) => filter === 'all' || filter === a.platform || filter === `account:${a.id}`)
        .map((a) => (
          <ReconnectBanner
            key={a.id}
            accountId={a.id}
            status={a.status}
            reason={a.error}
            label={`${PLATFORMS[a.platform].name}${a.handle ? ` ${a.handle}` : ''}`}
          />
        ))}
      <div className="conv-list scroll">
        {quickEmpty && <QuickFilterEmpty filter={quickFilter} />}
        {!quickEmpty && conversations.length === 0 && (!searching || visibleHits.length === 0) && (
          <div className="conv-empty">
            <strong>{searching ? t('noResults') : t('noConversations')}</strong>
            {!searching && !hasAccounts && t('noConversationsHint')}
          </div>
        )}
        {searching && conversations.length > 0 && <div className="conv-group-label">{t('conversationsSection')}</div>}
        {conversations.map((c) => {
          const isTyping = typing[c.id] && typing[c.id].until > Date.now()
          const preview = c.lastMessage
          const prefix =
            preview && !isTyping && (preview.isOutgoing || c.isGroup) ? `${preview.isOutgoing ? t('you') : preview.senderName.split(' ')[0]}: ` : ''
          const convTags = (tags[c.id] ?? []).filter((tag) => tagById[tag])
          const pinned = isPinned(c, pins)
          const unread = isUnread(c, markedUnread)
          return (
            <button
              key={c.id}
              className={`conv-item ${selectedId === c.id ? 'selected' : ''} ${beside.has(c.id) ? 'beside' : ''} ${unread ? 'unread' : ''}`}
              onClick={(e) => (canSplit && (e.metaKey || e.ctrlKey) ? openBeside(c.id) : select(c.id))}
              draggable={canSplit}
              onDragStart={(e) => {
                e.dataTransfer.setData(CONVERSATION_DRAG, c.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onMouseEnter={() => {
                // Resting on a chat for a moment starts loading it, so opening feels instant.
                if (hoverTimer.current) clearTimeout(hoverTimer.current)
                hoverTimer.current = setTimeout(() => void prefetch(c.id), 250)
              }}
              onMouseLeave={() => {
                if (hoverTimer.current) clearTimeout(hoverTimer.current)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ conversationId: c.id, x: e.clientX, y: e.clientY })
              }}
            >
              <Avatar name={c.title} url={c.avatarUrl} size={44} platform={showBadge ? c.platform : undefined} ring={ringFor(c.id)} />
              <span className="conv-body">
                <span className="conv-top">
                  <span className="conv-title">
                    {c.title}
                    {isBirthdayToday(overrides?.[c.id]?.birthday) && (
                      <span className="conv-birthday" title={t('birthdayToday', { name: c.title })}>
                        🎂
                      </span>
                    )}
                    {convTags.length > 0 && (
                      <span className="conv-tags" title={convTags.map((tag) => tagById[tag].name[language]).join(', ')}>
                        {convTags.map((tag) => (
                          <TagChip key={tag} tag={tagById[tag]} size="xs" iconOnly />
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="conv-time">{c.updatedAt > 0 ? formatListTime(c.updatedAt, language) : ''}</span>
                </span>
                <span className="conv-bottom">
                  <span className={`conv-preview ${isTyping ? 'typing' : ''}`}>
                    {!isTyping && drafts[c.id] && selectedId !== c.id ? (
                      <>
                        <span className="conv-draft">{t('draft')}</span> {drafts[c.id]}
                      </>
                    ) : isTyping ? (
                      c.isGroup ? (
                        t('typingIn', { name: typing[c.id].name })
                      ) : (
                        t('typing')
                      )
                    ) : (
                      <>
                        {prefix}
                        <PreviewText kind={preview?.kind} text={preview?.text ?? ''} />
                      </>
                    )}
                  </span>
                  <span className="conv-meta">
                    {pinned && <Pin size={12} strokeWidth={2.2} className="conv-pinned-mark" />}
                    {(c.muted || isMutedBy({ muted, tags }, c)) && <BellOff size={12} strokeWidth={2.2} />}
                    {c.unreadCount > 0 ? (
                      <span className="unread-pill">{formatBadge(c.unreadCount)}</span>
                    ) : (
                      unread && <span className="unread-pill dot" role="img" aria-label={t('markedUnread')} title={t('markedUnread')} />
                    )}
                  </span>
                </span>
              </span>
              <span
                className={`conv-more ${menu?.conversationId === c.id ? 'open' : ''}`}
                role="button"
                tabIndex={-1}
                title={t('moreActions')}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  openMenuAt(e.currentTarget, c.id)
                }}
              >
                <MoreHorizontal size={16} strokeWidth={2.4} />
              </span>
            </button>
          )
        })}

        {searching && visibleHits.length > 0 && (
          <>
            <div className="conv-group-label">{t('messagesSection')}</div>
            {visibleHits.map((hit) => (
              <button key={`${hit.conversation.id}#${hit.message.id}`} className="conv-item hit" onClick={() => openHit(hit)}>
                <Avatar name={hit.conversation.title} url={hit.conversation.avatarUrl} size={36} platform={showBadge ? hit.conversation.platform : undefined} />
                <span className="conv-body">
                  <span className="conv-top">
                    <span className="conv-title">{hit.conversation.title}</span>
                    <span className="conv-time">{formatListTime(hit.message.sentAt, language)}</span>
                  </span>
                  <span className="conv-bottom">
                    <span className="conv-preview">
                      {hit.message.isOutgoing ? `${t('you')}: ` : hit.conversation.isGroup ? `${hit.message.senderName.split(' ')[0]}: ` : ''}
                      <Highlight text={hit.message.text || hit.message.attachments[0]?.name || ''} query={search} />
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Rendered at the document root: the glass column would otherwise clip a fixed menu. */}
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="context-menu"
            style={{ left: menu.x, top: menu.y, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {menuConversation && (
              <button
                className="context-menu-item"
                onClick={() => {
                  void (menuUnread ? markRead : markUnread)(menuConversation.id)
                  setMenu(undefined)
                }}
              >
                {menuUnread ? <CheckCheck size={15} /> : <CircleDot size={15} />}
                <span>{menuUnread ? t('markRead') : t('markUnread')}</span>
              </button>
            )}
            {canSplit && menu.conversationId !== selectedId && (
              <button
                className="context-menu-item"
                onClick={() => {
                  openBeside(menu.conversationId)
                  setMenu(undefined)
                }}
              >
                <Columns2 size={15} />
                <span>{t('openBeside')}</span>
                <span className="context-menu-shortcut">{modKey}·click</span>
              </button>
            )}
            <button
              className="context-menu-item"
              onClick={() => {
                void togglePin(menu.conversationId)
                setMenu(undefined)
              }}
            >
              {isPinned(menuConversation, pins) ? (
                <PinOff size={15} />
              ) : (
                <Pin size={15} />
              )}
              <span>
                {isPinned(menuConversation, pins) ? t('unpin') : t('pin')}
              </span>
            </button>
            <button
              className="context-menu-item"
              onClick={() => {
                void toggleMute('conversations', menu.conversationId)
                setMenu(undefined)
              }}
            >
              <BellOff size={15} />
              <span>{muted.conversations.includes(menu.conversationId) ? t('unmute') : t('mute')}</span>
            </button>
            <button
              className="context-menu-item"
              onClick={() => {
                void hideConversation(menu.conversationId)
                setMenu(undefined)
              }}
            >
              <EyeOff size={15} />
              <span>{t('hide')}</span>
            </button>
            <div className="context-menu-title">{t('tags')}</div>
            {tagList.map((tag) => {
              const active = (tags[menu.conversationId] ?? []).includes(tag.id)
              return (
                <button
                  key={tag.id}
                  className={`context-menu-item tag-row ${active ? 'active' : ''}`}
                  onClick={() => void toggleTag(menu.conversationId, tag.id)}
                >
                  <TagChip tag={tag} size="sm" flat={!active} />
                  {active && <span className="context-menu-check">✓</span>}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </section>
  )
}

export function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
  const needle = query.trim().toLowerCase()
  const index = text.toLowerCase().indexOf(needle)
  if (index < 0 || !needle) return <>{text}</>
  const start = Math.max(0, index - 24)
  return (
    <>
      {start > 0 ? '…' : ''}
      {text.slice(start, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  )
}
