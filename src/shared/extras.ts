import type { Language, QuickReply } from './types'

/** Full-screen moments some messages trigger in the chat (like iMessage/Messenger word effects). */
export type EffectKind = 'birthday' | 'newyear' | 'congrats' | 'love'

/** Lower case, accents stripped (so "Chúc mừng sinh nhật" and "chuc mung sinh nhat" both match). */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
}

const RULES: Array<[EffectKind, RegExp]> = [
  ['birthday', /\b(chuc mung sinh nhat|sinh nhat vui ve|mung sinh nhat|happy (birthday|b-?day)|hpbd|hbd)\b/],
  ['newyear', /\b(chuc mung nam moi|happy new year|an khang thinh vuong|van su nhu y)\b/],
  ['congrats', /\b(chuc mung|congrats|congratulations|congratz)\b/],
  // Unaccented Vietnamese only for unambiguous pairs ("yeu cau" is also "yêu cầu", a request).
  ['love', /\b((i )?love (you|u|ya)|luv (you|u)|(yeu|iu) (em|anh|ban|may|vo|chong)|thuong (em|anh) (lam|nhieu))\b/]
]

/** Which effect a message should play, if any. Pure hearts ("❤️❤️") count as love. */
export function detectEffect(text: string): EffectKind | undefined {
  if (!text) return undefined
  if (/^\s*(?:(?:❤️|❤|💕|💖|💗|💓|😍|🥰)\s*){1,6}$/u.test(text)) return 'love'
  // Accented Vietnamese love notes are matched before folding, so "yêu cầu" (a request) never counts.
  const lower = text.toLowerCase()
  if (/(^|\s)(yêu|iu|thương)\s+(em|anh|bạn|cậu|mày|con|mẹ|bố|vợ|chồng|nhiều)(?=$|[\s!.,?~❤])/u.test(lower)) return 'love'
  const folded = fold(text)
  for (const [kind, re] of RULES) if (re.test(folded)) return kind
  return undefined
}

/** Starter quick replies (users edit them in Settings). `{name}` becomes the other person's first name. */
export function defaultQuickReplies(language: Language): QuickReply[] {
  const vi = language === 'vi'
  const list: Array<[string, string]> = vi
    ? [
        ['camon', 'Cảm ơn {name} nhiều nha!'],
        ['ok', 'Oke, mình nhận được rồi nhé.'],
        ['ban', 'Mình đang bận chút, lát mình nhắn lại {name} nha.'],
        ['sn', 'Chúc mừng sinh nhật {name}! Chúc {name} tuổi mới thật nhiều niềm vui 🎂'],
        ['dennoi', 'Mình tới nơi rồi nè!']
      ]
    : [
        ['thanks', 'Thanks so much, {name}!'],
        ['ok', 'Got it, thanks!'],
        ['busy', "I'm a bit busy right now, I'll get back to you soon, {name}."],
        ['hbd', 'Happy birthday, {name}! Wishing you a wonderful year ahead 🎂'],
        ['here', "I'm here!"]
      ]
  return list.map(([shortcut, text], i) => ({ id: `default-${i}`, shortcut, text }))
}

/** Fill in `{name}`. */
export function fillQuickReply(text: string, name: string): string {
  return text.replace(/\{name\}/g, name)
}

/** The given name to use in a greeting: Vietnamese names put it last, western ones first. */
export function givenName(fullName: string): string {
  // Drop "(work)", emoji and other decoration around a display name first.
  const cleaned = fullName
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ')
    .trim()
  const parts = (cleaned || fullName.trim()).split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? ''
  const vietnamese = /[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/i.test(fullName) || parts.length >= 3
  return vietnamese ? parts[parts.length - 1] : parts[0]
}

/** True when a YYYY-MM-DD or --MM-DD birthday falls on the given day. */
export function isBirthdayToday(birthday: string | undefined, now = new Date()): boolean {
  if (!birthday) return false
  const m = /^(?:\d{4}|-)-(\d{2})-(\d{2})$/.exec(birthday)
  if (!m) return false
  return Number(m[1]) === now.getMonth() + 1 && Number(m[2]) === now.getDate()
}

/** Month and day of a YYYY-MM-DD or --MM-DD birthday, and its year when known. */
export function parseBirthday(birthday: string | undefined): { month: number; day: number; year?: number } | undefined {
  const m = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(birthday ?? '')
  if (!m) return undefined
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  return { month, day, year: m[1] === '-' ? undefined : Number(m[1]) }
}

/** Whole days until the next birthday: 0 on the day, 1 the day before. 29 February falls on 1 March in other years. */
export function daysUntilBirthday(birthday: string | undefined, now = new Date()): number | undefined {
  const b = parseBirthday(birthday)
  if (!b) return undefined
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(now.getFullYear(), b.month - 1, b.day)
  if (next < today) next = new Date(now.getFullYear() + 1, b.month - 1, b.day)
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}

/** The age someone turns on their next birthday, when the year is known. */
export function turningAge(birthday: string | undefined, now = new Date()): number | undefined {
  const b = parseBirthday(birthday)
  const days = daysUntilBirthday(birthday, now)
  if (!b?.year || days === undefined) return undefined
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  const age = next.getFullYear() - b.year
  return age > 0 && age < 130 ? age : undefined
}

/** Chat wallpapers: presets drawn in CSS (see app.css `[data-wallpaper]`), or an uploaded photo (data URL). */
export const WALLPAPERS = ['peach', 'mint', 'lilac', 'sunset', 'night', 'dots', 'hearts', 'bubbles', 'buddies'] as const
export type WallpaperPreset = (typeof WALLPAPERS)[number]

export function isWallpaperPreset(value: string | undefined): value is WallpaperPreset {
  return !!value && (WALLPAPERS as readonly string[]).includes(value)
}
