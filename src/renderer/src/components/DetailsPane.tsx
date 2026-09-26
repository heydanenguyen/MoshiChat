import { useEffect, useMemo, useState } from 'react'
import { Cake, Clock, File, FileText, Image, Info, Link2, Mic, Phone, Play, Plus, RefreshCw, Search, User, X } from 'lucide-react'
import type { Message, SharedKind, TagId } from '@shared/types'
import { PLATFORMS, isMutedBy } from '@shared/types'
import { TagCreator } from './TagEditor'
import { TagChip } from './Tag'
import { isPinned, useStore, useT, useTagDefs, type DetailsTab } from '../store'
import { formatBytes, formatCount, formatDate, formatListTime, formatSpan, formatAgo } from '../utils'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'
import { Highlight } from './ConversationList'

const TABS: Array<{ id: DetailsTab; icon: JSX.Element; label: 'tabInfo' | 'tabSearch' | 'tabMedia' | 'tabLinks' | 'tabFiles' }> = [
  { id: 'info', icon: <Info size={16} strokeWidth={2.2} />, label: 'tabInfo' },
  { id: 'search', icon: <Search size={16} strokeWidth={2.2} />, label: 'tabSearch' },
  { id: 'media', icon: <Image size={16} strokeWidth={2.2} />, label: 'tabMedia' },
  { id: 'links', icon: <Link2 size={16} strokeWidth={2.2} />, label: 'tabLinks' },
  { id: 'files', icon: <FileText size={16} strokeWidth={2.2} />, label: 'tabFiles' }
]

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi
const EMPTY_TAGS: TagId[] = []

export function DetailsPane(): JSX.Element | null {
  const t = useT()
  const conversation = useStore((s) => (s.selectedId ? s.conversations[s.selectedId] : undefined))
  const tab = useStore((s) => s.detailsTab)
  const setTab = useStore((s) => s.setDetailsTab)
  const toggleDetails = useStore((s) => s.toggleDetails)
  if (!conversation) return null

  return (
    <aside className="details-col">
      <div className="details-top drag">
        <button className="icon-btn no-drag" onClick={() => toggleDetails()} title={t('close')}>
          <X size={16} strokeWidth={2.4} />
        </button>
      </div>
      <div className="details-tabs">
        {TABS.map((item) => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} title={t(item.label)}>
            {item.icon}
          </button>
        ))}
      </div>
      <div className="details-body scroll">
        {tab === 'info' && <InfoTab conversationId={conversation.id} />}
        {tab === 'search' && <SearchTab conversationId={conversation.id} />}
        {(tab === 'media' || tab === 'links' || tab === 'files') && <SharedTab conversationId={conversation.id} kind={tab} />}
      </div>
    </aside>
  )
}

/** When the last message was: "1 giờ trước", exact time on hover; refreshes every minute. */
function ActivityChip({ at }: { at: number }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(timer)
  }, [])
  const exact = new Date(at).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <span className="details-chip activity" title={t('lastMessageAt', { time: exact })} aria-label={t('lastMessageAt', { time: exact })}>
      <Clock size={14} strokeWidth={2.4} />
      {formatAgo(at, language)}
    </span>
  )
}

function InfoTab({ conversationId }: { conversationId: string }): JSX.Element {
  const t = useT()
  const conversation = useStore((s) => s.conversations[conversationId])
  const account = useStore((s) => s.accounts[conversation?.accountId ?? ''])
  const profile = useStore((s) => s.profiles[conversationId])
  const loadProfile = useStore((s) => s.loadProfile)
  const storedTags = useStore((s) => s.settings.tags[conversationId])
  const tags = storedTags ?? EMPTY_TAGS
  const toggleTag = useStore((s) => s.toggleTag)
  const pins = useStore((s) => s.settings.pins)
  const togglePin = useStore((s) => s.togglePin)
  const { list: tagList, byId: tagById } = useTagDefs()
  const [creating, setCreating] = useState(false)
  const muted = useStore((s) => s.settings.muted)
  const toggleMute = useStore((s) => s.toggleMute)
  const allTags = useStore((s) => s.settings.tags)
  const language = useStore((s) => s.settings.language)
  const openLightbox = useStore((s) => s.openLightbox)

  useEffect(() => {
    void loadProfile(conversationId)
    setCreating(false)
  }, [conversationId, loadProfile])

  if (!conversation) return <></>
  const pinned = isPinned(conversation, pins)
  const name = profile?.name ?? conversation.title
  const avatar = profile?.avatarUrl ?? conversation.avatarUrl
  const handle = profile?.handle ?? conversation.participants.find((p) => !p.isMe)?.handle
  const others = conversation.participants.filter((p) => !p.isMe)
  const facts: Array<{ icon: JSX.Element; label: string; value: string }> = []
  if (profile?.phone) facts.push({ icon: <Phone size={14} />, label: t('phone'), value: profile.phone })
  if (profile?.birthday) facts.push({ icon: <Cake size={14} />, label: t('birthday'), value: formatDate(profile.birthday, language) })
  if (profile?.gender) facts.push({ icon: <User size={14} />, label: t('gender'), value: profile.gender === 'male' ? t('male') : profile.gender === 'female' ? t('female') : profile.gender })
  for (const item of profile?.extra ?? []) facts.push({ icon: <Info size={14} />, label: item.label, value: item.value })

  return (
    <>
      <div className="details-hero">
        <Avatar
          name={name}
          url={avatar}
          size={96}
          ring={tags.map((tag) => tagById[tag]).find(Boolean)?.color}
          className="details-avatar-large"
          onClick={() => avatar && openLightbox({ url: avatar, name })}
        />
        <div className="details-name">{name}</div>
        {(handle || conversation.isGroup) && (
          <div className="details-handle">{conversation.isGroup ? t('members', { count: conversation.participants.length }) : handle}</div>
        )}
        {profile?.bio && <div className="profile-bio">{profile.bio}</div>}
        <div className="details-meta">
          <span className="details-chip">
            <PlatformIcon platform={conversation.platform} size={18} />
            {PLATFORMS[conversation.platform].name}
          </span>
          {conversation.updatedAt > 0 && <ActivityChip at={conversation.updatedAt} />}
        </div>
        {profile === undefined && (
          <div className="progress-row" style={{ marginTop: 10 }}>
            <span className="spinner" />
          </div>
        )}
      </div>

      <div className="details-section">
        <div className="details-section-title">{t('tags')}</div>
        <div className="tag-chips">
          {tagList.map((tag) => {
            const active = tags.includes(tag.id)
            return <TagChip key={tag.id} tag={tag} size="md" flat={!active} onClick={() => void toggleTag(conversationId, tag.id)} />
          })}
          {!creating && (
            <button className="tag-pill md add" onClick={() => setCreating(true)} title={t('tagNew')}>
              <Plus size={15} strokeWidth={2.4} />
              <span className="tag-pill-label">{t('tagNew')}</span>
            </button>
          )}
        </div>
        {creating && (
          <TagCreator
            onCreated={(tag) => {
              setCreating(false)
              void toggleTag(conversationId, tag.id)
            }}
            onCancel={() => setCreating(false)}
          />
        )}
      </div>

      {facts.length > 0 && (
        <div className="details-section">
          <div className="details-section-title">{t('details')}</div>
          <div className="profile-facts">
            {facts.map((fact, i) => (
              <div key={i} className="details-kv">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {fact.icon}
                  {fact.label}
                </span>
                <span style={{ textAlign: 'right' }}>{fact.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {conversation.isGroup && others.length > 0 && (
        <div className="details-section">
          <div className="details-section-title">{t('participants')}</div>
          {others.map((p) => (
            <div key={p.id} className="details-row">
              <Avatar name={p.name} url={p.avatarUrl} size={30} />
              <div className="details-row-text">
                <div className="details-row-name">{p.name}</div>
                {p.handle && <div className="details-row-sub">{p.handle}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="details-section">
        <div className="details-section-title">{t('connectedVia')}</div>
        {account && (
          <div className="details-row">
            <Avatar name={account.displayName} url={account.avatarUrl} size={30} platform={account.platform} />
            <div className="details-row-text">
              <div className="details-row-name">{account.displayName}</div>
              <div className="details-row-sub">{account.handle ?? PLATFORMS[account.platform].name}</div>
            </div>
          </div>
        )}
        <div className="details-kv" style={{ alignItems: 'center' }}>
          <span>{t('pinned')}</span>
          <button className={`switch ${pinned ? 'on' : ''}`} role="switch" aria-checked={pinned} onClick={() => void togglePin(conversationId)} />
        </div>
        <div className="details-kv" style={{ alignItems: 'center' }}>
          <span>{t('notifications')}</span>
          <button
            className={`switch ${!muted.conversations.includes(conversationId) && !conversation.muted ? 'on' : ''}`}
            role="switch"
            aria-checked={!muted.conversations.includes(conversationId)}
            onClick={() => void toggleMute('conversations', conversationId)}
            title={isMutedBy({ muted, tags: allTags }, conversation) ? t('mutedByRule') : undefined}
          />
        </div>
        {isMutedBy({ muted, tags: allTags }, conversation) && !muted.conversations.includes(conversationId) && (
          <div className="field-hint">{t('mutedByRule')}</div>
        )}
      </div>
    </>
  )
}

function SearchTab({ conversationId }: { conversationId: string }): JSX.Element {
  const t = useT()
  const searchIn = useStore((s) => s.searchIn)
  const jumpTo = useStore((s) => s.jumpTo)
  const language = useStore((s) => s.settings.language)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    setBusy(true)
    const timer = setTimeout(() => {
      void searchIn(conversationId, query).then((hits) => {
        setResults(hits)
        setBusy(false)
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [query, conversationId, searchIn])

  return (
    <>
      <div className="details-search">
        <div className="search-field">
          <Search size={14} strokeWidth={2.4} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchInConversation')} spellCheck={false} />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label={t('close')}>
              <X size={11} strokeWidth={3} />
            </button>
          )}
        </div>
      </div>
      {busy && (
        <div className="progress-row" style={{ justifyContent: 'center', padding: 12 }}>
          <span className="spinner" />
        </div>
      )}
      {!busy && query.trim().length >= 2 && results.length === 0 && <div className="details-empty">{t('noResults')}</div>}
      {results.map((m) => (
        <button key={m.id} className="result-item" onClick={() => void jumpTo(m.id)} title={t('jumpToMessage')}>
          <Avatar name={m.senderName} url={m.senderAvatarUrl} size={26} />
          <span className="result-text">
            <span className="result-meta">
              <strong>{m.senderName}</strong>
              <span>{formatListTime(m.sentAt, language)}</span>
            </span>
            <span className="result-snippet">
              <Highlight text={m.text || m.attachments[0]?.name || ''} query={query} />
            </span>
          </span>
        </button>
      ))}
    </>
  )
}

function SharedTab({ conversationId, kind }: { conversationId: string; kind: SharedKind }): JSX.Element {
  const t = useT()
  const key = `${conversationId}|${kind}`
  const messages = useStore((s) => s.shared[key])
  const loadShared = useStore((s) => s.loadShared)
  const jumpTo = useStore((s) => s.jumpTo)
  const openLightbox = useStore((s) => s.openLightbox)
  const loadAttachment = useStore((s) => s.loadAttachment)
  const openAttachment = useStore((s) => s.openAttachment)
  const language = useStore((s) => s.settings.language)
  useEffect(() => {
    void loadShared(conversationId, kind, true)
  }, [conversationId, kind, loadShared])

  const items = useMemo(() => {
    const list = messages ?? []
    if (kind === 'links') {
      return list.flatMap((m) => {
        const urls = new Set<string>()
        for (const a of m.attachments) if (a.kind === 'link' && a.url) urls.add(a.url)
        for (const match of m.text.matchAll(URL_RE)) urls.add(match[0])
        return [...urls].map((url) => ({ message: m, url, title: m.attachments.find((a) => a.url === url)?.name }))
      })
    }
    const kinds = kind === 'media' ? ['image', 'video'] : ['file', 'audio']
    return list.flatMap((m) => m.attachments.filter((a) => kinds.includes(a.kind)).map((attachment) => ({ message: m, attachment })))
  }, [messages, kind])

  const header = (
    <div className="details-section-title" style={{ padding: '0 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      {t(kind === 'media' ? 'tabMedia' : kind === 'links' ? 'tabLinks' : 'tabFiles')}
      <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => void loadShared(conversationId, kind, true)} title={t('refresh')}>
        <RefreshCw size={13} />
      </button>
    </div>
  )

  if (!messages) {
    return (
      <>
        {header}
        <div className="progress-row" style={{ justifyContent: 'center', padding: 12 }}>
          <span className="spinner" />
        </div>
      </>
    )
  }
  if (!items.length) {
    return (
      <>
        {header}
        <div className="details-empty">{t('nothingShared')}</div>
      </>
    )
  }

  if (kind === 'media') {
    return (
      <>
        {header}
        <div className="media-grid">
          {(items as Array<{ message: Message; attachment: Message['attachments'][number] }>).map(({ message, attachment }) => {
            const src = attachment.url ?? attachment.thumbnailUrl
            const open = async (): Promise<void> => {
              if (attachment.kind === 'video') {
                await openAttachment(message.conversationId, message.id, attachment.id)
                return
              }
              const url = attachment.url ?? (await loadAttachment(message.conversationId, message.id, attachment.id)) ?? attachment.thumbnailUrl
              if (url) openLightbox({ url, name: attachment.name ?? formatListTime(message.sentAt, language) })
            }
            return (
              <button key={`${message.id}-${attachment.id}`} className="media-cell" onClick={() => void open()} title={formatListTime(message.sentAt, language)}>
                {src ? <img src={src} alt="" draggable={false} loading="lazy" /> : <Image size={20} />}
                {attachment.kind === 'video' && (
                  <span className="play">
                    <Play size={22} fill="currentColor" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </>
    )
  }

  if (kind === 'links') {
    return (
      <>
        {header}
        {(items as Array<{ message: Message; url: string; title?: string }>).map(({ message, url, title }, i) => {
          let host = url
          try {
            host = new URL(url).hostname.replace(/^www\./, '')
          } catch {
            /* keep raw */
          }
          return (
            <button key={`${message.id}-${i}`} className="link-item" onClick={() => void window.unison.app.openExternal(url)} title={t('openLink')}>
              <span className="link-favicon">{host.slice(0, 1).toUpperCase()}</span>
              <span className="link-text">
                <span className="link-title">{title ?? host}</span>
                <span className="link-url">{url}</span>
                <span className="link-url">
                  {message.senderName} · {formatListTime(message.sentAt, language)}
                </span>
              </span>
            </button>
          )
        })}
      </>
    )
  }

  return (
    <>
      {header}
      {(items as Array<{ message: Message; attachment: Message['attachments'][number] }>).map(({ message, attachment }) => (
        <button
          key={`${message.id}-${attachment.id}`}
          className="link-item"
          onClick={() => void openAttachment(message.conversationId, message.id, attachment.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            void jumpTo(message.id)
          }}
          title={t('openFile')}
        >
          <span className="link-favicon">{attachment.kind === 'audio' ? <Mic size={16} /> : <File size={16} />}</span>
          <span className="link-text">
            <span className="link-title">{attachment.name ?? (attachment.kind === 'audio' ? t('voice') : t('file'))}</span>
            <span className="link-url">
              {formatBytes(attachment.size) || attachment.kind} · {message.senderName} · {formatListTime(message.sentAt, language)}
            </span>
          </span>
        </button>
      ))}
    </>
  )
}
