import { useEffect, useState } from 'react'
import { BellOff, Pin, Search, SquarePen, X } from 'lucide-react'
import { PLATFORMS, TAGS, TAG_ORDER, isMutedBy, type Platform, type TagId } from '@shared/types'
import { useShowPlatformBadge, useStore, useT, useVisibleConversations } from '../store'
import { formatListTime } from '../utils'
import { Avatar } from './Avatar'

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
          ? TAGS[filter.slice(4) as TagId].name[language]
          : PLATFORMS[filter as Platform].name

  const visibleHits = searchHits.filter((h) => {
    if (filter === 'all') return true
    if (filter.startsWith('account:')) return h.conversation.accountId === filter.slice(8)
    if (filter.startsWith('tag:')) return (tags[h.conversation.id] ?? []).includes(filter.slice(4) as TagId)
    return h.conversation.platform === filter
  })

  const ringFor = (id: string): string | undefined => {
    const first = (tags[id] ?? [])[0]
    return first ? TAGS[first].color : undefined
  }

  return (
    <section className="list-col">
      <header className="list-header drag">
        <h1 className="list-title">{title}</h1>
        <button className="icon-btn no-drag" title={`${t('shortcutSearch')} (Ctrl K)`} onClick={() => openSheet({ kind: 'command' })}>
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
          const convTags = tags[c.id] ?? []
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
                      <span className="conv-tags" title={convTags.map((tag) => TAGS[tag].name[language]).join(', ')}>
                        {convTags.map((tag) => (
                          <span key={tag}>{TAGS[tag].emoji}</span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="conv-time">{formatListTime(c.updatedAt, language)}</span>
                </span>
                <span className="conv-bottom">
                  <span className={`conv-preview ${isTyping ? 'typing' : ''}`}>
                    {isTyping
                      ? c.isGroup
                        ? t('typingIn', { name: typing[c.id].name })
                        : t('typing')
                      : `${prefix}${preview?.text ?? ''}`}
                  </span>
                  <span className="conv-meta">
                    {c.pinned && <Pin size={12} strokeWidth={2.2} />}
                    {(c.muted || isMutedBy({ muted, tags }, c)) && <BellOff size={12} strokeWidth={2.2} />}
                    {c.unreadCount > 0 && <span className="unread-pill">{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>}
                  </span>
                </span>
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
          <button className="context-menu-item" onClick={() => { void toggleMute('conversations', menu.conversationId); setMenu(undefined) }}>
            <BellOff size={15} />
            <span>{muted.conversations.includes(menu.conversationId) ? t('unmute') : t('mute')}</span>
          </button>
          <div className="context-menu-title">{t('tags')}</div>
          {TAG_ORDER.map((tag) => {
            const active = (tags[menu.conversationId] ?? []).includes(tag)
            return (
              <button key={tag} className={`context-menu-item ${active ? 'active' : ''}`} onClick={() => void toggleTag(menu.conversationId, tag)}>
                <span className="tag-swatch" style={{ background: TAGS[tag].color }}>
                  {TAGS[tag].emoji}
                </span>
                <span>{TAGS[tag].name[language]}</span>
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
