import type { Attachment, SystemNotice } from '@shared/types'

/** Attachment objects as ws3-fca formats them (history and realtime). */
export type FcaAttachment = Record<string, unknown> & { type?: string }

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : typeof v === 'string' && Number(v) > 0 ? Number(v) : undefined)
const seconds = (ms: unknown): number | undefined => {
  const n = num(ms)
  return n ? n / 1000 : undefined
}

export function mapFcaAttachment(raw: FcaAttachment, id: string): Attachment {
  const url = str(raw.url) ?? str(raw.largePreviewUrl) ?? str(raw.previewUrl)
  const size = { width: num(raw.width) ?? num(raw.previewWidth), height: num(raw.height) ?? num(raw.previewHeight) }
  switch (raw.type) {
    case 'photo':
      return { id, kind: 'image', url, thumbnailUrl: str(raw.previewUrl) ?? str(raw.thumbnailUrl), ...size }
    case 'animated_image':
      return { id, kind: 'image', url, thumbnailUrl: str(raw.previewUrl), name: 'GIF', ...size }
    case 'video':
      return { id, kind: 'video', url: str(raw.url), thumbnailUrl: str(raw.previewUrl) ?? str(raw.thumbnailUrl), duration: seconds(raw.duration), ...size }
    case 'audio':
      return { id, kind: 'audio', url: str(raw.url), name: raw.isVoiceMail || /^audioclip/i.test(str(raw.filename) ?? '') ? 'Voice message' : (str(raw.filename) ?? 'Audio'), duration: seconds(raw.duration) }
    case 'sticker':
      return { id, kind: 'sticker', url: str(raw.url), name: str(raw.description) ?? '' }
    case 'share': {
      const link = str(raw.url)
      const image = str(raw.image) ?? str(raw.previewUrl)
      // Shared reels, posts and stories from Instagram/Facebook render as post cards.
      const social = link && /(instagram\.com|facebook\.com|fb\.watch)\/(p|reel|reels|stories|watch|share)\b/.test(link)
      if (social) {
        return {
          id,
          kind: 'post',
          url: link,
          thumbnailUrl: image,
          caption: str(raw.description) ?? str(raw.title),
          author: str(raw.source),
          reel: !!raw.playable || /\/reels?\//.test(link),
          duration: seconds(raw.duration),
          width: num(raw.width),
          height: num(raw.height),
          expired: !image
        }
      }
      return { id, kind: 'link', url: link, name: str(raw.title), caption: str(raw.description), thumbnailUrl: image }
    }
    case 'unknown':
      return { id, kind: 'file', name: 'Attachment' }
    default:
      return { id, kind: 'file', url, name: str(raw.filename) ?? str(raw.name) ?? 'File' }
  }
}

/** Admin rows from history ("event" items): calls become call notices, the rest show Facebook's own text. */
export function mapFcaEvent(raw: { logMessageType?: string; logMessageData?: unknown; snippet?: string; logMessageBody?: string }): { text: string; system: SystemNotice } {
  const data = (raw.logMessageData ?? {}) as Record<string, unknown>
  const text = raw.snippet ?? raw.logMessageBody ?? ''
  if (raw.logMessageType === 'log:thread-call' || /call/i.test(raw.logMessageType ?? '')) {
    const event = String(data.event ?? data.call_event ?? '')
    const missed = /missed|no_answer|declined/i.test(event) || /missed|nhỡ|lỡ/i.test(text)
    const video = data.is_video_call === true || data.is_video_call === 'true' || /video/i.test(event) || /video/i.test(text)
    return { text, system: { kind: missed ? 'missed_call' : 'call', seconds: num(data.call_duration), audio: !video } }
  }
  return { text, system: { kind: 'event' } }
}
