import type { TMessage } from 'zca-js'
import type { Attachment, Message } from '@shared/types'
import { VIDEO_FILE } from '@shared/media'

/**
 * Zalo's raw messages (zca-js TMessage) as Moshi's own: pure functions, shared by the live adapter (zalo.ts) and the
 * relay reader (zalo-relay-adapter.ts), so a message reads the same on both.
 */

/** Messages with their own card (media and files): the card says what they are. */
export const CARD_TYPES = ['chat.photo', 'chat.video.msg', 'chat.sticker', 'chat.voice', 'chat.gif', 'share.file', 'chat.file']

/**
 * A location, contact card, poll or to-do has no picture to show: it reads as a line of text (a location also links to
 * its map when Zalo sent coordinates).
 */
function lineOf(raw: TMessage): { text: string; link?: { url: string; name: string } } | undefined {
  if (typeof raw.content !== 'object' || !raw.content) return undefined
  const c = raw.content as { title?: string; description?: string; href?: string; action?: string; params?: string }
  const p = paramsOf(c.params)
  if (raw.msgType.startsWith('chat.location')) {
    const place = c.title || c.description || ''
    const text = `📍 ${place}`.trim()
    const lat = Number(p.latitude)
    const lng = Number(p.longitude)
    const mapped = Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)
    return { text, link: mapped ? { url: `https://www.google.com/maps?q=${lat},${lng}`, name: place || 'Map' } : undefined }
  }
  // "recommened" is Zalo's own spelling. A recommended item with no link is a contact card.
  if (raw.msgType === 'chat.recommended' && (/recommen\w*\.user/.test(c.action ?? '') || !c.href)) {
    return { text: `👤 ${[c.title, c.description].filter(Boolean).join(' · ')}`.trim() }
  }
  if (raw.msgType === 'group.poll') return { text: `Poll: ${(p.question as string | undefined) ?? c.title ?? ''}`.trim() }
  if (raw.msgType === 'chat.todo') return { text: `To-do: ${(p.item as { content?: string } | undefined)?.content ?? c.title ?? ''}`.trim() }
  return undefined
}

export function textOf(raw: TMessage): string {
  if (typeof raw.content === 'string') return raw.content
  if (raw.content && typeof raw.content === 'object') {
    const c = raw.content as { title?: string; description?: string; text?: string; href?: string }
    // Media and files say what they are in their own card; their title is the file name, not words to show twice.
    if (CARD_TYPES.includes(raw.msgType)) return ''
    const line = lineOf(raw)
    if (line) return line.text
    // Something this app does not know: its type, rather than an empty bubble.
    return c.text ?? c.title ?? (c.href ? '' : `[${raw.msgType}]`)
  }
  return ''
}

export function stickerIdOf(raw: TMessage): number | undefined {
  if (typeof raw.content !== 'object' || !raw.content) return undefined
  const c = raw.content as { id?: number | string; stickerId?: number | string }
  const n = Number(c.id ?? c.stickerId)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** A Zalo sticker's picture: a still image, or a sprite sheet of `frames` frames over `duration` seconds. */
export interface StickerPicture {
  url: string
  /** Absent: remembered before sprite sheets were kept, so worth looking up again. */
  frames?: number
  duration?: number
  /** Pictures from an older way of reading Zalo's answer (or none) are looked up again. */
  v?: number
}
export const STICKER_PICTURE_VERSION = 2

/** Seconds one loop of a sprite sticker takes. Zalo's duration is per frame (milliseconds), 250 when it has none. */
export function loopSeconds(duration: unknown, frames: number): number {
  const perFrame = Number(duration) > 0 ? Number(duration) : 250
  return (perFrame * frames) / 1000
}

/** A photo sticker (made from a picture, an AI sticker, one from Zalo's photo sticker search): drawn borderless. */
export function isPhotoSticker(raw: TMessage): boolean {
  const ext = typeof raw.propertyExt === 'string' ? paramsOf(raw.propertyExt) : (raw.propertyExt as Record<string, unknown> | undefined)
  return raw.msgType === 'chat.photo' && Number(ext?.type) === 3
}

export function attachmentsOf(raw: TMessage, sticker?: StickerPicture): Attachment[] {
  if (typeof raw.content !== 'object' || !raw.content) return []
  const line = lineOf(raw)
  if (line) return line.link ? [{ id: `${raw.msgId}-a`, kind: 'link', url: line.link.url, name: line.link.name }] : []
  const c = raw.content as { href?: string; thumb?: string; title?: string; description?: string; params?: string; type?: string }
  const id = `${raw.msgId}-a`
  const p = paramsOf(c.params)
  // Width and height let the bubble keep its place while the picture loads.
  const box = Number(p.width) > 0 && Number(p.height) > 0 ? { width: Number(p.width), height: Number(p.height) } : {}
  switch (raw.msgType) {
    case 'chat.photo': {
      // A photo sticker moves in its WebP; the photo itself is the still (and is all an older sticker has).
      const webp = (p.webp as { url?: string } | undefined)?.url
      if (isPhotoSticker(raw)) return [{ id, kind: 'sticker', name: '', url: webp || c.href, ...box }]
      return [{ id, kind: 'image', url: c.href, thumbnailUrl: c.thumb, ...box }]
    }
    case 'chat.video.msg':
      return [{ id, kind: 'video', url: c.href, thumbnailUrl: c.thumb, ...box, ...(Number(p.duration) > 0 ? { duration: Number(p.duration) / 1000 } : {}) }]
    case 'chat.voice':
      return [{ id, kind: 'audio', url: c.href, name: 'Voice message' }]
    case 'chat.sticker':
      return [{ id, kind: 'sticker', name: '', url: sticker?.url, ...(sticker?.frames && sticker.frames > 1 ? { frames: sticker.frames, duration: sticker.duration } : {}) }]
    case 'chat.gif':
      return [{ id, kind: 'image', url: c.href, thumbnailUrl: c.thumb, ...box }]
    case 'share.file':
    case 'chat.file': {
      const name = c.title ?? 'File'
      // A video sent as a file (from a computer, or "send as file" on the phone) still gets a player.
      if (VIDEO_FILE.test(name) || /^(mp4|m4v|mov|webm)$/i.test(String(p.fileExt ?? ''))) return [{ id, kind: 'video', url: c.href, thumbnailUrl: c.thumb || undefined, name, size: sizeFrom(c.params) }]
      return [{ id, kind: 'file', url: c.href, name, size: sizeFrom(c.params) }]
    }
    case 'chat.recommended':
      return [{ id, kind: 'link', url: c.href, name: c.title ?? c.href }]
    default:
      return c.href ? [{ id, kind: 'link', url: c.href, name: c.title ?? c.href }] : []
  }
}

/** Zalo's attachment params (a JSON string), or nothing. */
function paramsOf(params?: string): Record<string, unknown> {
  if (!params || params[0] !== '{') return {}
  try {
    return JSON.parse(params) as Record<string, unknown>
  } catch {
    return {}
  }
}

function sizeFrom(params?: string): number | undefined {
  if (!params) return undefined
  try {
    const parsed = JSON.parse(params) as { fileSize?: string | number }
    return parsed.fileSize ? Number(parsed.fileSize) : undefined
  } catch {
    return undefined
  }
}

export interface MessageContext {
  conversationId: string
  meId: string
  meName: string
  meAvatar?: string
  /** Name / picture of a sender the raw message does not carry. */
  nameOf(userId: string): string | undefined
  avatarOf(userId: string): string | undefined
  reactions: Message['reactions']
  sticker?: StickerPicture
}

/** One raw message as a Message. `isSelf` overrides the sender check (a message the socket says is mine). */
export function mapMessage(raw: TMessage, c: MessageContext, isSelf?: boolean): Message {
  const outgoing = isSelf ?? (raw.uidFrom === '0' || raw.uidFrom === c.meId)
  const message: Message = {
    id: raw.msgId,
    conversationId: c.conversationId,
    senderId: outgoing ? c.meId : raw.uidFrom,
    senderName: outgoing ? c.meName : raw.dName || c.nameOf(raw.uidFrom) || 'Zalo',
    senderAvatarUrl: outgoing ? c.meAvatar : c.avatarOf(raw.uidFrom),
    text: textOf(raw),
    attachments: attachmentsOf(raw, c.sticker),
    reactions: c.reactions,
    sentAt: Number(raw.ts),
    isOutgoing: outgoing,
    status: 'delivered'
  }
  if (raw.quote) {
    message.replyTo = { id: String(raw.quote.globalMsgId), senderName: raw.quote.fromD, text: raw.quote.msg || (raw.quote.attach ? 'Attachment' : '') }
  }
  return message
}
