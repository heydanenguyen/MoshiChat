import { useEffect, useState } from 'react'
import { BellOff, Pin, PinOff, Search, SquarePen, X } from 'lucide-react'
import { PLATFORMS, isMutedBy, type Platform } from '@shared/types'
import { isPinned, useShowPlatformBadge, useStore, useT, useTagDefs, useVisibleConversations } from '../store'
import { formatListTime } from '../utils'
import { Avatar } from './Avatar'
import { PreviewText } from './MessageParts'
import { ReconnectBanner } from './ChatView'

interface TagMenuState {
  conversationId: string
  x: number
  y: number
}

export function ConversationList(): JSX.Element {
  const t = useT()
  const conversations = useVisibleConversations()
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
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
  const pins = useStore((s) => s.settings.pins)
  const togglePin = useStore((s) => s.togglePin)
  const { list: tagList, byId: tagById } = useTagDefs()
  const muted = useStore((s) => s.settings.muted)
  const toggleMute = useStore((s) => s.toggleMute)
  const openSheet = useStore((s) => s.openSheet)
  const showBadge = useShowPlatformBadge()
  const [menu, setMenu] = useState<TagMenuState | undefined>()
  const hasAccounts = Object.keys(accounts).length > 0
  const searching = search.trim().length > 0

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

  const title =
    filter === 'all'
      ? t('messages')
      : filter.startsWith('account:')
        ? (accounts[filter.slice(8)]?.displayName ?? t('messages'))
        : filter.startsWith('tag:')
          ? (tagById[filter.slice(4)]?.name[language] ?? t('messages'))
          : PLATFORMS[filter as Platform].name

  const visibleHits = searchHits.filter((h) => {
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
        <input
          type="text"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
        {search && (
          <button className="search-clear" onClick={() => setSearch('')} aria-label={t('close')}>
            <X size={11} strokeWidth={3} />
          </button>
        )}
      </div>

      {Object.values(accounts)
        .filter((a) => !a.demo && (a.status === 'needs_auth' || a.status === 'error'))
        .filter((a) => filter === 'all' || filter === a.platform || filter === `account:${a.id}`)
        .map((a) => (
          <ReconnectBanner key={a.id} accountId={a.id} status={a.status} reason={a.error} label={`${PLATFORMS[a.platform].name}${a.handle ? ` ${a.handle}` : ''}`} />
        ))}
      <div className="conv-list scroll">
        {conversations.length === 0 && (!searching || visibleHits.length === 0) && (
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
            preview && !isTyping && (preview.isOutgoing || c.isGroup)
              ? `${preview.isOutgoing ? t('you') : preview.senderName.split(' ')[0]}: `
              : ''
          const convTags = (tags[c.id] ?? []).filter((tag) => tagById[tag])
          const pinned = isPinned(c, pins)
          return (
            <button
              key={c.id}
              className={`conv-item ${selectedId === c.id ? 'selected' : ''} ${c.unreadCount ? 'unread' : ''}`}
              onClick={() => select(c.id)}
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
                    {convTags.length > 0 && (
                      <span className="conv-tags" title={convTags.map((tag) => tagById[tag].name[language]).join(', ')}>
                        {convTags.map((tag) => (
                          <span key={tag}>{tagById[tag].emoji}</span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="conv-time">{c.updatedAt > 0 ? formatListTime(c.updatedAt, language) : ''}</span>
                </span>
                <span className="conv-bottom">
                  <span className={`conv-preview ${isTyping ? 'typing' : ''}`}>
                    {isTyping
                      ? c.isGroup
                        ? t('typingIn', { name: typing[c.id].name })
                        : t('typing')
                      : (
                        <>
                          {prefix}
                          <PreviewText kind={preview?.kind} text={preview?.text ?? ''} />
                        </>
                      )}
                  </span>
                  <span className="conv-meta">
                    {pinned && <Pin size={12} strokeWidth={2.2} className="conv-pinned-mark" />}
                    {(c.muted || isMutedBy({ muted, tags }, c)) && <BellOff size={12} strokeWidth={2.2} />}
                    {c.unreadCount > 0 && <span className="unread-pill">{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>}
                  </span>
                </span>
              </span>
              <span
                className={`conv-pin-action ${pinned ? 'on' : ''}`}
                role="button"
                tabIndex={-1}
                title={pinned ? t('unpin') : t('pin')}
                onClick={(e) => {
                  e.stopPropagation()
                  void togglePin(c.id)
                }}
              >
                {pinned ? <PinOff size={14} strokeWidth={2.2} /> : <Pin size={14} strokeWidth={2.2} />}
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

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button className="context-menu-item" onClick={() => { void togglePin(menu.conversationId); setMenu(undefined) }}>
            {isPinned(conversations.find((c) => c.id === menu.conversationId), pins) ? <PinOff size={15} /> : <Pin size={15} />}
            <span>{isPinned(conversations.find((c) => c.id === menu.conversationId), pins) ? t('unpin') : t('pin')}</span>
          </button>
          <button className="context-menu-item" onClick={() => { void toggleMute('conversations', menu.conversationId); setMenu(undefined) }}>
            <BellOff size={15} />
            <span>{muted.conversations.includes(menu.conversationId) ? t('unmute') : t('mute')}</span>
          </button>
          <div className="context-menu-title">{t('tags')}</div>
          {tagList.map((tag) => {
            const active = (tags[menu.conversationId] ?? []).includes(tag.id)
            return (
              <button key={tag.id} className={`context-menu-item ${active ? 'active' : ''}`} onClick={() => void toggleTag(menu.conversationId, tag.id)}>
                <span className="tag-swatch" style={{ background: tag.color }}>
                  {tag.emoji}
                </span>
                <span>{tag.name[language]}</span>
                {active && <span className="context-menu-check">✓</span>}
              </button>
            )
          })}
        </div>
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
