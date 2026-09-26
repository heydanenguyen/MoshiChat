import type { Language, Message } from '@shared/types'

const locale = (lang: Language): string => (lang === 'vi' ? 'vi-VN' : 'en-US')

export function formatListTime(ts: number, lang: Language): string {
  const date = new Date(ts)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return date.toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return lang === 'vi' ? 'Hôm qua' : 'Yesterday'
  const week = 6 * 24 * 60 * 60 * 1000
  if (now.getTime() - ts < week) return date.toLocaleDateString(locale(lang), { weekday: 'short' })
  return date.toLocaleDateString(locale(lang), { day: 'numeric', month: 'numeric' })
}

export function formatTime(ts: number, lang: Language): string {
  return new Date(ts).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' })
}

export function formatDayLabel(ts: number, lang: Language): string {
  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return lang === 'vi' ? 'Hôm nay' : 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return lang === 'vi' ? 'Hôm qua' : 'Yesterday'
  return date.toLocaleDateString(locale(lang), { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Birthday-style dates: full ISO date or --MM-DD when the year is hidden. */
export function formatDate(value: string, lang: Language): string {
  const partial = /^--(\d{2})-(\d{2})$/.exec(value)
  if (partial) {
    const d = new Date(2000, Number(partial[1]) - 1, Number(partial[2]))
    return d.toLocaleDateString(locale(lang), { day: 'numeric', month: 'long' })
  }
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (full) {
    const d = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]))
    return d.toLocaleDateString(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' })
  }
  return value
}

/** "Tháng 9, 2026" / "September 2026". */
export function formatMonthLabel(ts: number, lang: Language): string {
  const date = new Date(ts)
  if (lang === 'vi') return `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`
  return date.toLocaleDateString(locale(lang), { month: 'long', year: 'numeric' })
}

/** "27 thg 9 · 21:40" (year added when it is not this year); `dateOnly` drops the time. */
export function formatMomentDate(ts: number, lang: Language, dateOnly = false): string {
  const date = new Date(ts)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const day = date.toLocaleDateString(locale(lang), { day: 'numeric', month: 'short', ...(sameYear && !dateOnly ? {} : { year: 'numeric' }) })
  return dateOnly ? day : `${day} · ${formatTime(ts, lang)}`
}

/** "1 năm 3 tháng" / "2 years 1 month" style span between two timestamps. */
export function formatSpan(from: number, to: number, lang: Language): string {
  const days = Math.max(0, Math.floor((to - from) / 86_400_000))
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  const vi = lang === 'vi'
  if (years > 0) {
    const y = vi ? `${years} năm` : `${years} ${years === 1 ? 'year' : 'years'}`
    if (!months) return y
    return `${y} ${vi ? `${months} tháng` : `${months} ${months === 1 ? 'month' : 'months'}`}`
  }
  if (months > 0) return vi ? `${months} tháng` : `${months} ${months === 1 ? 'month' : 'months'}`
  if (days > 0) return vi ? `${days} ngày` : `${days} ${days === 1 ? 'day' : 'days'}`
  return vi ? 'hôm nay' : 'today'
}

/** "vừa xong", "5 phút trước", "3 giờ trước", "2 tháng trước" / English equivalents. */
export function formatAgo(ts: number, lang: Language, now = Date.now()): string {
  const vi = lang === 'vi'
  const minutes = Math.floor((now - ts) / 60_000)
  if (minutes < 1) return vi ? 'vừa xong' : 'just now'
  if (minutes < 60) return vi ? `${minutes} phút trước` : `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return vi ? `${hours} giờ trước` : `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  return `${formatSpan(ts, now, lang)} ${vi ? 'trước' : 'ago'}`
}

export function formatCount(n: number, lang: Language): string {
  return n.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** Deterministic pastel gradient for initials avatars. */
export function gradientFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `linear-gradient(145deg, hsl(${hue} 70% 62%), hsl(${(hue + 40) % 360} 65% 48%))`
}

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export interface MessageGroup {
  key: string
  senderId: string
  senderName: string
  senderAvatarUrl?: string
  isOutgoing: boolean
  messages: Message[]
  /** A centered notice (call, event) rather than a sender's run of bubbles. */
  system?: boolean
}

export interface DaySection {
  day: number
  groups: MessageGroup[]
}

const GROUP_WINDOW = 3 * 60 * 1000

/** Split messages into day sections and sender runs, Messages.app style. */
export function sectionize(messages: Message[]): DaySection[] {
  const sections: DaySection[] = []
  for (const message of messages) {
    const day = new Date(message.sentAt).setHours(0, 0, 0, 0)
    let section = sections[sections.length - 1]
    if (!section || section.day !== day) {
      section = { day, groups: [] }
      sections.push(section)
    }
    let group = section.groups[section.groups.length - 1]
    const last = group?.messages[group.messages.length - 1]
    if (message.system) {
      section.groups.push({ key: message.id, senderId: message.senderId, senderName: message.senderName, isOutgoing: message.isOutgoing, messages: [message], system: true })
      continue
    }
    if (!group || group.system || group.senderId !== message.senderId || !last || message.sentAt - last.sentAt > GROUP_WINDOW) {
      group = {
        key: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
        senderAvatarUrl: message.senderAvatarUrl,
        isOutgoing: message.isOutgoing,
        messages: []
      }
      section.groups.push(group)
    }
    group.messages.push(message)
  }
  return sections
}

export const isMac = typeof window !== 'undefined' && (window.unison?.app.platform ?? 'win32') === 'darwin'
export const modKey = isMac ? '⌘' : 'Ctrl'

const EMOJI_GRAPHEME = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}\u{200D}\u{FE0F}\u{20E3}#*0-9])+$/u

/**
 * 1-3 when the text is only emoji (shown large, no bubble, like Instagram/iMessage); 0 otherwise.
 * Counts user-perceived characters, so flags, skin tones and ZWJ families count as one.
 */
export function jumboEmojiCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 40) return 0
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)].map((s) => s.segment).filter((s) => s.trim())
  if (!segments.length || segments.length > 3) return 0
  const allEmoji = segments.every((g) => EMOJI_GRAPHEME.test(g) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g))
  return allEmoji ? segments.length : 0
}
