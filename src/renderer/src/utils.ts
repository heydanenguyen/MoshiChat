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
    if (!group || group.senderId !== message.senderId || !last || message.sentAt - last.sentAt > GROUP_WINDOW) {
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
