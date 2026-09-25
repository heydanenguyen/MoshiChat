import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BellOff, File, Forward, Info, Pause, Play, Reply, SmilePlus } from 'lucide-react'
import type { Account, Attachment, Conversation, Message } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { useShowPlatformBadge, useStore, useT } from '../store'
import { formatBytes, formatDayLabel, formatTime, sectionize, type MessageGroup } from '../utils'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { EmptyState } from './EmptyState'

const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏']

export function ChatView(): JSX.Element {
  const selectedId = useStore((s) => s.selectedId)
  const conversation = useStore((s) => (s.selectedId ? s.conversations[s.selectedId] : undefined))
  if (!selectedId || !conversation) return <EmptyState kind="no-selection" />
  return <Thread key={conversation.id} conversation={conversation} />
}

function Thread({ conversation }: { conversation: Conversation }): JSX.Element {
  const t = useT()
  const messages = useStore((s) => s.messages[conversation.id])
  const loading = useStore((s) => !!s.loading[conversation.id])
  const hasMore = useStore((s) => !!s.hasMore[conversation.id])
  const typing = useStore((s) => s.typing[conversation.id])
  const account = useStore((s) => s.accounts[conversation.accountId])
  const detailsOpen = useStore((s) => s.detailsOpen)
  const toggleDetails = useStore((s) => s.toggleDetails)
  const loadMore = useStore((s) => s.loadMore)
  const language = useStore((s) => s.settings.language)
  const highlightId = useStore((s) => s.highlightId)
  const addDroppedFiles = useStore((s) => s.addDroppedFiles)
  const showBadge = useShowPlatformBadge()

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const prevHeight = useRef(0)
  const prevFirstId = useRef<string | undefined>(undefined)
  const [dragging, setDragging] = useState(0)

  const isTyping = !!typing && typing.until > Date.now()
  const sections = sectionize(messages ?? [])
  const lastOutgoing = [...(messages ?? [])].reverse().find((m) => m.isOutgoing)
  const features = account?.features ?? { reply: false, react: false, attachments: false }

  // Keep the viewport pinned to the newest message unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const firstId = messages?.[0]?.id
    if (prevFirstId.current && firstId !== prevFirstId.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
    prevFirstId.current = firstId
    prevHeight.current = el.scrollHeight
  }, [messages, isTyping])

  // Jump to a search hit once its bubble exists.
  useEffect(() => {
    if (!highlightId || !messages) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(highlightId)}"]`)
    if (el) {
      stickToBottom.current = false
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [highlightId, messages])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      if (el.scrollTop < 60 && hasMore && !loading) void loadMore(conversation.id)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [conversation.id, hasMore, loading, loadMore])

  const subtitle = isTyping
    ? conversation.isGroup
      ? t('typingIn', { name: typing.name })
      : t('typing')
    : conversation.isGroup
      ? t('members', { count: conversation.participants.length })
      : (conversation.participants.find((p) => !p.isMe)?.handle ?? PLATFORMS[conversation.platform].name)

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(0)
    if (!features.attachments) return
    const files = [...e.dataTransfer.files]
    if (files.length) addDroppedFiles(files)
  }

  return (
    <section
      className="chat-col"
      onDragEnter={(e) => {
        e.preventDefault()
        if (features.attachments) setDragging((d) => d + 1)
      }}
      onDragLeave={() => setDragging((d) => Math.max(0, d - 1))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="chat-header drag">
        <Avatar name={conversation.title} url={conversation.avatarUrl} size={34} platform={showBadge ? conversation.platform : undefined} onClick={() => toggleDetails('info')} />
        <div className="chat-header-info">
          <div className="chat-header-title">
            {conversation.title}
            {conversation.muted && <BellOff size={13} strokeWidth={2.2} style={{ opacity: 0.5 }} />}
          </div>
          <div className={`chat-header-sub ${isTyping ? 'typing' : ''}`}>{subtitle}</div>
        </div>
        <div className="chat-header-actions no-drag">
          <button className={`icon-btn ${detailsOpen ? 'active' : ''}`} onClick={() => toggleDetails()} title={t('details')}>
            <Info size={18} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="chat-scroll scroll" ref={scrollRef}>
        <div className="chat-scroll-inner">
          {loading && !messages && <div className="chat-loading">…</div>}
          {hasMore && messages && (
            <button className="load-more" onClick={() => loadMore(conversation.id)} disabled={loading}>
              {t('loadMore')}
            </button>
          )}
          {sections.map((section) => (
            <div key={section.day} style={{ display: 'contents' }}>
              <div className="day-sep">{formatDayLabel(section.day, language)}</div>
              {section.groups.map((group) => (
                <Group
                  key={group.key}
                  group={group}
                  conversation={conversation}
                  features={features}
                  lastOutgoingId={lastOutgoing?.id}
                  highlightId={highlightId}
                  language={language}
                />
              ))}
            </div>
          ))}
          {isTyping && (
            <div className="msg-group in">
              <div className="msg-avatar-slot">
                <Avatar name={typing.name} size={28} />
              </div>
              <div className="typing-bubble" aria-label={t('typing')}>
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>
      </div>

      {dragging > 0 && <div className="drop-overlay">{t('dropHint')}</div>}
      <Composer disabled={account?.status !== 'connected'} canAttach={features.attachments} />
    </section>
  )
}

function Group({
  group,
  conversation,
  features,
  lastOutgoingId,
  highlightId,
  language
}: {
  group: MessageGroup
  conversation: Conversation
  features: Account['features']
  lastOutgoingId?: string
  highlightId?: string
  language: 'vi' | 'en'
}): JSX.Element {
  const t = useT()
  const react = useStore((s) => s.react)
  const showSender = !group.isOutgoing && conversation.isGroup
  const peer = conversation.participants.find((p) => p.id === group.senderId)
  return (
    <div className={`msg-group ${group.isOutgoing ? 'out' : 'in'}`}>
      {!group.isOutgoing && (
        <div className="msg-avatar-slot">
          <Avatar
            name={group.senderName}
            url={group.senderAvatarUrl ?? (conversation.isGroup ? peer?.avatarUrl : conversation.avatarUrl)}
            size={28}
          />
        </div>
      )}
      <div className="msg-group-body">
        {showSender && <div className="msg-sender">{group.senderName}</div>}
        {group.messages.map((message, index) => {
          const position =
            group.messages.length === 1
              ? 'single'
              : index === 0
                ? 'first'
                : index === group.messages.length - 1
                  ? 'last'
                  : 'middle'
          return (
            <div key={message.id} style={{ display: 'contents' }}>
              <Bubble message={message} position={position} language={language} features={features} highlighted={message.id === highlightId} />
              {message.reactions.length > 0 && (
                <div className="reactions">
                  {message.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      className={`reaction-chip ${r.byMe ? 'mine' : ''}`}
                      onClick={() => features.react && void react(message.id, r.emoji)}
                      title={t('react')}
                    >
                      {r.emoji}
                      {r.count > 1 && <span>{r.count}</span>}
                    </button>
                  ))}
                </div>
              )}
              {message.id === lastOutgoingId && (
                <div className={`status-line ${message.status === 'failed' ? 'failed' : ''}`}>
                  {message.status === 'read'
                    ? t('read')
                    : message.status === 'failed'
                      ? t('failed')
                      : message.status === 'sending'
                        ? t('sending')
                        : t('delivered')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Bubble({
  message,
  position,
  language,
  features,
  highlighted
}: {
  message: Message
  position: 'single' | 'first' | 'middle' | 'last'
  language: 'vi' | 'en'
  features: Account['features']
  highlighted: boolean
}): JSX.Element {
  const t = useT()
  const setReplyTo = useStore((s) => s.setReplyTo)
  const startForward = useStore((s) => s.startForward)
  const react = useStore((s) => s.react)
  const [picker, setPicker] = useState(false)
  const direction = message.isOutgoing ? 'out' : 'in'
  const sticker = message.attachments.find((a) => a.kind === 'sticker' && a.url)
  const media = message.attachments.find((a) => (a.kind === 'image' || a.kind === 'video') && (a.url || a.thumbnailUrl))
  const classes = ['bubble', direction, position]
  if (sticker) classes.push('sticker')
  else if (media) classes.push('media')
  if (message.status === 'failed') classes.push('failed')
  const mine = message.reactions.find((r) => r.byMe)?.emoji

  useEffect(() => {
    if (!picker) return
    const close = (): void => setPicker(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [picker])

  const settled = message.status !== 'sending' && message.status !== 'failed'
  const showActions = settled && (features.reply || features.react || true)

  return (
    <div className={`bubble-row ${highlighted ? 'highlight' : ''}`} data-message-id={message.id}>
      <div className={classes.join(' ')}>
        {message.replyTo && (message.replyTo.text || message.replyTo.senderName) && (
          <div className="reply-quote">
            <strong>{message.replyTo.senderName}</strong>
            {message.replyTo.text}
          </div>
        )}
        {sticker && <img className="attachment-sticker" src={sticker.url} alt={sticker.name ?? t('sticker')} draggable={false} />}
        {!sticker &&
          message.attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} message={message} />)}
        {message.text && (media ? <div className="bubble-caption"><Linkify text={message.text} /></div> : <Linkify text={message.text} />)}
        {!message.text && !message.attachments.length && <span style={{ opacity: 0.6 }}>…</span>}
        {message.edited && <span style={{ opacity: 0.6, fontSize: 11 }}> · {t('edited')}</span>}
      </div>
      {showActions && (
        <div className={`bubble-actions ${picker ? 'open' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
          {features.react && (
            <button className="icon-btn" title={t('react')} onClick={() => setPicker((p) => !p)}>
              <SmilePlus size={15} strokeWidth={2} />
            </button>
          )}
          {features.reply && (
            <button className="icon-btn" title={t('reply')} onClick={() => setReplyTo(message)}>
              <Reply size={15} strokeWidth={2} />
            </button>
          )}
          <button className="icon-btn" title={t('forward')} onClick={() => startForward(message)}>
            <Forward size={15} strokeWidth={2} />
          </button>
          {picker && (
            <div className="emoji-picker">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  className={mine === emoji ? 'active' : ''}
                  onClick={() => {
                    setPicker(false)
                    void react(message.id, emoji)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <span className="bubble-time">{formatTime(message.sentAt, language)}</span>
    </div>
  )
}

function AttachmentView({ attachment, message }: { attachment: Attachment; message: Message }): JSX.Element {
  const t = useT()
  const openLightbox = useStore((s) => s.openLightbox)
  const loadAttachment = useStore((s) => s.loadAttachment)
  const openAttachment = useStore((s) => s.openAttachment)
  const openExternal = (url?: string): void => {
    if (url && /^https?:/.test(url)) void window.unison.app.openExternal(url)
  }
  const viewImage = async (): Promise<void> => {
    const url = attachment.url ?? (await loadAttachment(message.conversationId, message.id, attachment.id)) ?? attachment.thumbnailUrl
    if (url) openLightbox({ url, name: attachment.name })
  }
  switch (attachment.kind) {
    case 'image': {
      const src = attachment.url ?? attachment.thumbnailUrl
      return src ? (
        <img className="attachment-image" src={src} alt={t('photo')} draggable={false} onClick={() => void viewImage()} />
      ) : (
        <div className="attachment-image placeholder">{t('photo')}</div>
      )
    }
    case 'video':
      return (
        <div style={{ position: 'relative' }} onClick={() => (attachment.url && /^https?:/.test(attachment.url) ? openExternal(attachment.url) : void openAttachment(message.conversationId, message.id, attachment.id))}>
          {attachment.thumbnailUrl ? (
            <img className="attachment-image" src={attachment.thumbnailUrl} alt={t('video')} draggable={false} />
          ) : (
            <div className="attachment-image placeholder">{t('video')}</div>
          )}
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.5))'
            }}
          >
            <Play size={34} fill="currentColor" />
          </span>
        </div>
      )
    case 'audio':
      return <AudioPlayer attachment={attachment} message={message} />
    case 'link':
      return (
        <a className="attachment-link" href={attachment.url} onClick={(e) => (e.preventDefault(), openExternal(attachment.url))}>
          {attachment.name ?? attachment.url}
        </a>
      )
    case 'sticker':
      return (
        <span>
          {attachment.name} {t('sticker')}
        </span>
      )
    default:
      return (
        <div className="attachment-file" onClick={() => (attachment.url && /^https?:/.test(attachment.url) ? openExternal(attachment.url) : void openAttachment(message.conversationId, message.id, attachment.id))}>
          <span className="attachment-file-icon">
            <File size={18} />
          </span>
          <span>
            <div className="attachment-file-name">{attachment.name ?? t('file')}</div>
            <div className="attachment-file-meta">{formatBytes(attachment.size) || attachment.kind}</div>
          </span>
        </div>
      )
  }
}

const LINK_RE = /https?:\/\/[^\s<>"')\]]+/g

/** Plain text with clickable URLs. */
function Linkify({ text }: { text: string }): JSX.Element {
  const parts: Array<string | JSX.Element> = []
  let last = 0
  for (const match of text.matchAll(LINK_RE)) {
    const start = match.index ?? 0
    if (start > last) parts.push(text.slice(last, start))
    const url = match[0]
    parts.push(
      <a key={start} className="attachment-link" href={url} onClick={(e) => (e.preventDefault(), void window.unison.app.openExternal(url))}>
        {url}
      </a>
    )
    last = start + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

const BAR_COUNT = 28
/** Deterministic pseudo-waveform so every voice note has its own shape. */
function barsFor(seed: string): number[] {
  let hash = 7
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff
    return 5 + ((hash >> 8) % 14) + (i % 5 === 0 ? 3 : 0)
  })
}

function AudioPlayer({ attachment, message }: { attachment: Attachment; message: Message }): JSX.Element {
  const t = useT()
  const loadAttachment = useStore((s) => s.loadAttachment)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
  const [duration, setDuration] = useState(attachment.duration ?? 0)
  const bars = barsFor(attachment.id)

  const toggle = async (): Promise<void> => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      return
    }
    if (!audio.src || audio.src === window.location.href) {
      if (!attachment.url) {
        setLoading(true)
        const url = await loadAttachment(message.conversationId, message.id, attachment.id)
        setLoading(false)
        if (!url) return
        audio.src = url
      } else {
        audio.src = attachment.url
      }
    }
    try {
      await audio.play()
    } catch {
      /* format not supported */
    }
  }

  const format = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  const shown = playing && duration ? progress * duration : duration

  return (
    <div className="audio-player">
      <button className="audio-play" onClick={() => void toggle()} title={playing ? t('pause') : t('play')}>
        {loading ? <span className="spinner" /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <div className="audio-track">
        <div className="audio-bars">
          {bars.map((h, i) => (
            <span key={i} style={{ height: h }} className={i / BAR_COUNT < progress ? 'played' : ''} />
          ))}
        </div>
        <span className="audio-time">{format(shown)}</span>
      </div>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setProgress(0)
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setDuration(d)
        }}
        onTimeUpdate={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setProgress(e.currentTarget.currentTime / d)
          else if (duration) setProgress(Math.min(1, e.currentTarget.currentTime / duration))
        }}
      />
    </div>
  )
}
