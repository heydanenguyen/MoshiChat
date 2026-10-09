import { useEffect, useRef, useState } from 'react'
import { CircleDashed, Clapperboard, EyeOff, File, FileText, Image, ImagePlay, Info, Link2, Mic, Phone, PhoneMissed, Play, Sticker, Undo2, Video } from 'lucide-react'
import type { Attachment, Message, Platform, PreviewKind } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { useStore, useT } from '../store'
import type { TKey } from '../i18n'
import { mediaSrc, previewSrc } from '@shared/media'

const formatClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`

const hostOf = (url?: string): string => {
  try {
    return url ? new URL(url).host.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------- stories

/** The story a message replies to, reacts to or shares, drawn above the bubble like Instagram does. */
export function StoryRef({ attachment, message, platform }: { attachment: Attachment; message: Message; platform: Platform }): JSX.Element {
  const t = useT()
  const openLightbox = useStore((s) => s.openLightbox)
  const name = attachment.author || t('theirStory')
  const mine = message.isOutgoing
  const label = (() => {
    switch (attachment.label) {
      case 'story_reaction':
        return mine ? t('storyReactToThem', { name }) : t('storyReactToYou')
      case 'story_mention':
        return mine ? t('storyMentionThem', { name }) : t('storyMentionYou')
      case 'story_share':
        return attachment.author ? t('storyShared', { name: attachment.author }) : t('storySharedPlain')
      default:
        return mine ? t('storyReplyToThem', { name }) : t('storyReplyToYou')
    }
  })()
  const reaction = attachment.label === 'story_reaction' ? message.text : undefined
  const isVideo = !!attachment.url && attachment.url !== attachment.thumbnailUrl
  const open = (): void => {
    if (attachment.expired || !attachment.url) return
    openLightbox({
      url: attachment.url,
      video: isVideo,
      poster: attachment.thumbnailUrl,
      name: label
    })
  }
  return (
    <div className={`story-ref ${mine ? 'out' : 'in'}`}>
      <div className="story-ref-label">
        <CircleDashed size={12} strokeWidth={2.6} />
        {label}
      </div>
      <button className={`story-card ${attachment.expired ? 'gone' : ''}`} onClick={open} disabled={attachment.expired} title={PLATFORMS[platform].name}>
        {attachment.thumbnailUrl && !attachment.expired ? (
          <>
            <img src={attachment.thumbnailUrl} alt="" draggable={false} loading="lazy" />
            {isVideo && (
              <span className="story-play">
                <Play size={14} fill="currentColor" />
              </span>
            )}
          </>
        ) : (
          <span className="story-gone">
            <EyeOff size={18} strokeWidth={2} />
            {t('storyGone')}
          </span>
        )}
        {reaction && <span className="story-reaction">{reaction}</span>}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- posts, reels, links

/** A shared post or reel: preview, author and caption; plays reels in place when the platform gave us the video. */
export function PostCard({ attachment, platform }: { attachment: Attachment; platform: Platform }): JSX.Element {
  const t = useT()
  const openLightbox = useStore((s) => s.openLightbox)
  const platformName = PLATFORMS[platform].name
  const open = (): void => {
    if (!attachment.url) return
    void window.unison.app.openExternal(attachment.url)
  }
  const preview = (): void => {
    if (!attachment.thumbnailUrl) return open()
    openLightbox({
      url: attachment.thumbnailUrl,
      name: attachment.caption,
      externalUrl: attachment.url,
      externalLabel: t('openIn', { platform: platformName })
    })
  }
  const ratio = attachment.width && attachment.height ? Math.min(Math.max(attachment.height / attachment.width, 0.8), attachment.reel ? 1.6 : 1.25) : attachment.reel ? 1.6 : 1.25
  return (
    <div className={`post-card ${attachment.reel ? 'reel' : ''}`}>
      {attachment.author && (
        <div className="post-card-head">
          <span className="post-card-avatar">{attachment.author.slice(0, 1).toUpperCase()}</span>
          <span className="post-card-author">{attachment.author}</span>
          <span className="post-card-kind">{attachment.reel ? t('reel') : t('post')}</span>
        </div>
      )}
      {attachment.expired ? (
        <button className="post-card-media gone" onClick={open}>
          <EyeOff size={18} strokeWidth={2} />
          {t('postGone')}
        </button>
      ) : (
        <button className="post-card-media" style={{ aspectRatio: `1 / ${ratio}` }} onClick={preview}>
          <img src={attachment.thumbnailUrl} alt="" draggable={false} loading="lazy" />
          {attachment.reel && (
            <span className="post-card-badge">
              <Clapperboard size={13} strokeWidth={2.4} />
              {attachment.duration ? formatClock(attachment.duration) : t('reel')}
            </span>
          )}
        </button>
      )}
      {attachment.caption && <div className="post-card-caption">{attachment.caption}</div>}
      <button className="post-card-open" onClick={open}>
        {t('openIn', { platform: platformName })}
      </button>
    </div>
  )
}

/** Rich link preview (title, summary, image) when the platform sends one. */
export function LinkCard({ attachment }: { attachment: Attachment }): JSX.Element {
  const open = (): void => {
    if (attachment.url && /^https?:/.test(attachment.url)) void window.unison.app.openExternal(attachment.url)
  }
  if (!attachment.name && !attachment.caption && !attachment.thumbnailUrl) {
    return (
      <a className="attachment-link" href={attachment.url} onClick={(e) => (e.preventDefault(), open())}>
        {attachment.url}
      </a>
    )
  }
  return (
    <button className="link-card" onClick={open}>
      {attachment.thumbnailUrl && <img src={attachment.thumbnailUrl} alt="" draggable={false} loading="lazy" />}
      <span className="link-card-body">
        <span className="link-card-host">
          <Link2 size={12} strokeWidth={2.4} />
          {hostOf(attachment.url)}
        </span>
        {attachment.name && <span className="link-card-title">{attachment.name}</span>}
        {attachment.caption && <span className="link-card-summary">{attachment.caption}</span>}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- video

/**
 * A GIF that came as a video: loops only while it is in view and the window is in front (see .window-idle).
 * Every GIF in a long chat used to keep decoding for as long as the chat was open, scrolled away or not.
 */
function GifVideo({ src, poster, onError }: { src?: string; poster?: string; onError(): void }): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const root = document.documentElement
    let visible = false
    let idleNow = root.classList.contains('window-idle')
    const update = (): void => {
      if (visible && !idleNow) void video.play().catch(() => undefined)
      else video.pause()
    }
    const inView = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        update()
      },
      { root: video.closest('.chat-scroll'), threshold: 0 }
    )
    inView.observe(video)
    // <html> changes class for other reasons too (theme, …): act only when the idle state flips.
    const idle = new MutationObserver(() => {
      const next = root.classList.contains('window-idle')
      if (next === idleNow) return
      idleNow = next
      update()
    })
    idle.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => {
      inView.disconnect()
      idle.disconnect()
    }
  }, [])
  return <video ref={ref} className="attachment-image" src={src} poster={poster} loop muted playsInline preload="metadata" onError={onError} />
}

/** Poster with a play button; plays full screen in the app instead of bouncing to the browser. */
export function VideoThumb({ attachment, onFallback }: { attachment: Attachment; onFallback(): void }): JSX.Element {
  const t = useT()
  const openLightbox = useStore((s) => s.openLightbox)
  const [failed, setFailed] = useState(false)
  const playable = !!attachment.url && /^https?:|^file:|^data:/.test(attachment.url)
  const play = (): void => {
    if (playable && attachment.url)
      openLightbox({
        url: attachment.url,
        video: true,
        poster: attachment.thumbnailUrl
      })
    else onFallback()
  }
  if (attachment.gif && playable && !failed) {
    return (
      <button className="video-thumb gif" onClick={play} title="GIF">
        <GifVideo src={mediaSrc(attachment.url)} poster={attachment.thumbnailUrl} onError={() => setFailed(true)} />
        <span className="gif-badge">GIF</span>
      </button>
    )
  }
  return (
    <button className="video-thumb" onClick={play} title={t('video')}>
      {attachment.thumbnailUrl && !failed ? (
        <img className="attachment-image" src={previewSrc(attachment.thumbnailUrl, 960)} alt={t('video')} draggable={false} onError={() => setFailed(true)} />
      ) : playable && !failed ? (
        // No poster from the platform (a video sent as a file): its own first frame stands in.
        <video className="attachment-image" src={`${mediaSrc(attachment.url)}#t=0.1`} preload="metadata" muted playsInline onError={() => setFailed(true)} />
      ) : (
        <div className="attachment-image placeholder">{t('video')}</div>
      )}
      {attachment.gif ? (
        <span className="gif-badge">GIF</span>
      ) : (
        <>
          <span className="video-play">
            <Play size={22} fill="currentColor" />
          </span>
          {attachment.duration ? <span className="video-duration">{formatClock(attachment.duration)}</span> : null}
        </>
      )}
    </button>
  )
}

/** Photos that can no longer be shown (opened view-once media). */
export function GoneMedia(): JSX.Element {
  const t = useT()
  return (
    <div className="gone-media">
      <EyeOff size={16} strokeWidth={2.2} />
      {t('viewOnceGone')}
    </div>
  )
}

// ---------------------------------------------------------------- centered notices

export function SystemRow({ message, platform }: { message: Message; platform: Platform }): JSX.Element {
  const t = useT()
  const notice = message.system!
  const time = new Date(message.sentAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
  if (notice.kind === 'call' || notice.kind === 'missed_call') {
    const missed = notice.kind === 'missed_call'
    const label = missed ? t('callMissed') : notice.audio ? t('callAudio') : t('callVideo')
    return (
      <div className={`system-row call ${missed ? 'missed' : ''}`}>
        <span className="system-icon">
          {missed ? <PhoneMissed size={14} strokeWidth={2.4} /> : notice.audio ? <Phone size={14} strokeWidth={2.4} /> : <Video size={14} strokeWidth={2.4} />}
        </span>
        <span>
          <strong>{label}</strong>
          {notice.seconds ? ` · ${notice.seconds >= 60 ? t('durationMin', { m: Math.round(notice.seconds / 60) }) : t('durationSec', { s: notice.seconds })}` : ''}
          <span className="system-time"> · {time}</span>
        </span>
      </div>
    )
  }
  if (notice.kind === 'unavailable') {
    return (
      <div className="system-row">
        <span className="system-icon">
          <Info size={14} strokeWidth={2.4} />
        </span>
        <span>{t('onlyInApp', { platform: PLATFORMS[platform].name })}</span>
      </div>
    )
  }
  return <div className="system-row event">{message.text}</div>
}

// ---------------------------------------------------------------- conversation list

const PREVIEW: Record<PreviewKind, { icon: typeof Image; key: TKey }> = {
  photo: { icon: Image, key: 'previewPhoto' },
  video: { icon: Video, key: 'previewVideo' },
  voice: { icon: Mic, key: 'previewVoice' },
  sticker: { icon: Sticker, key: 'previewSticker' },
  gif: { icon: ImagePlay, key: 'previewGif' },
  link: { icon: Link2, key: 'previewLink' },
  file: { icon: File, key: 'previewFile' },
  post: { icon: FileText, key: 'previewPost' },
  reel: { icon: Clapperboard, key: 'previewReel' },
  story_reply: { icon: CircleDashed, key: 'previewStoryReply' },
  story_reaction: { icon: CircleDashed, key: 'previewStoryReaction' },
  story_mention: { icon: CircleDashed, key: 'previewStoryMention' },
  story_share: { icon: CircleDashed, key: 'previewStoryShare' },
  call: { icon: Phone, key: 'previewCall' },
  unavailable: { icon: Info, key: 'previewUnavailable' },
  unsent: { icon: Undo2, key: 'previewUnsent' }
}

/** "📷 Photo", "◌ Story reply: haha" — icon plus localized label, with the text when there is one. */
export function PreviewText({ kind, text }: { kind?: PreviewKind; text: string }): JSX.Element {
  const t = useT()
  if (!kind) return <>{text}</>
  const { icon: Icon, key } = PREVIEW[kind]
  // Platform fallbacks ("Photo", "Voice message") are replaced by the localized label.
  const generic = !text || /^(photo|video|voice message|sticker|attachment|file|link|gif|shared a story|replied to a story)$/i.test(text.trim())
  const shown = kind === 'story_reaction' && text ? `${t(key)} ${text}` : generic ? t(key) : kind.startsWith('story_') ? `${t(key)}: ${text}` : text
  return (
    <span className="preview-kind">
      <Icon size={13} strokeWidth={2.4} />
      <span className="preview-kind-text">{shown}</span>
    </span>
  )
}
