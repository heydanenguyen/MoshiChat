import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Cake, ChartNoAxesColumn, Crown, Flame, Image as ImageIcon, MessageCircleHeart, NotebookPen, Moon, Share2, Sparkles, X } from 'lucide-react'
import { computeInsights, onThisDay, reconnectCandidates, vibeOf, type ContactInsight, type InsightRecord, type Insights, type Memory, type Reconnect, type ShareCardData, type Vibe } from '@shared/insights'
import { LOGOS } from '@shared/logos'
import { useStore, useT, anchorFor, useShownConversations } from '../store'
import { useAi } from '../aiStore'
import { daysUntilBirthday, fillQuickReply, givenName, turningAge } from '@shared/extras'
import { formatListTime } from '../utils'
import type { TKey } from '../i18n'
import { BuddyLoader } from './BuddyLoader'
import { Avatar } from './Avatar'

interface InsightsState {
  records?: InsightRecord[]
  loadedAt?: number
  /** The 30-day backfill walking chats: done of total (undefined when idle). */
  progress?: { done: number; total: number }
  load(force?: boolean): Promise<void>
  /** Fill the last 30 days of every active chat, refreshing the numbers as chats complete. */
  backfill(): Promise<void>
  /** Quiet friends set aside: chat id to when they may be suggested again. */
  snoozed: Record<string, number>
  snooze(conversationId: string): void
  /** Birthday cards set aside: chat id to the day ("2026-10-01") it was dismissed for. */
  birthdayDismissed: Record<string, string>
  dismissBirthday(conversationId: string): void
}

const BIRTHDAY_KEY = 'moshi.birthday.dismissed'
const dayKey = (d = new Date()): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

function readBirthdayDismissed(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(BIRTHDAY_KEY) ?? '{}') as Record<string, string>
    // Only today's count: a birthday set aside as tomorrow's comes back on the day itself.
    return Object.fromEntries(Object.entries(raw).filter(([, day]) => day === dayKey()))
  } catch {
    return {}
  }
}

const SNOOZE_KEY = 'moshi.reconnect.snoozed'
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

function readSnoozed(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}') as Record<string, number>
    return Object.fromEntries(Object.entries(raw).filter(([, until]) => typeof until === 'number' && until > Date.now()))
  } catch {
    return {}
  }
}

let listening = false

/** The message records behind the insights, fetched once per session (or when asked again). */
export const useInsights = create<InsightsState>((set, get) => ({
  snoozed: readSnoozed(),
  birthdayDismissed: readBirthdayDismissed(),

  dismissBirthday(conversationId) {
    const birthdayDismissed = { ...get().birthdayDismissed, [conversationId]: dayKey() }
    set({ birthdayDismissed })
    try {
      localStorage.setItem(BIRTHDAY_KEY, JSON.stringify(birthdayDismissed))
    } catch {
      /* private mode */
    }
  },

  snooze(conversationId) {
    const snoozed = { ...get().snoozed, [conversationId]: Date.now() + SNOOZE_MS }
    set({ snoozed })
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozed))
    } catch {
      /* private mode */
    }
  },

  async load(force) {
    if (!force && get().loadedAt && Date.now() - get().loadedAt! < 10 * 60_000) return
    try {
      set({ records: await window.unison.insights.records(), loadedAt: Date.now() })
    } catch {
      set({ records: [], loadedAt: Date.now() })
    }
  },

  async backfill() {
    if (get().progress) return
    if (!listening) {
      listening = true
      let last = 0
      window.unison.onEvent((event) => {
        if (event.type !== 'insights:progress') return
        set({ progress: event.done < event.total ? { done: event.done, total: event.total } : undefined })
        // Numbers refresh as chats complete, at most twice a second.
        if (Date.now() - last > 500 || event.done >= event.total) {
          last = Date.now()
          void get().load(true)
        }
      })
    }
    set({ progress: { done: 0, total: 0 } })
    try {
      await window.unison.insights.backfill(30)
    } finally {
      set({ progress: undefined })
      await get().load(true)
    }
  }
}))

/**
 * The records as people: one person across apps counts as one friend, their chats' messages adding up
 * under the person. Plus what the insight functions need to know about those people.
 */
function usePeopleRecords(): { records?: InsightRecord[]; titles: Record<string, string>; groups: Set<string>; lastActivity: Record<string, number> } {
  const conversations = useShownConversations()
  const rawConversations = useStore((s) => s.conversations)
  const people = useStore((s) => s.settings.people)
  const records = useInsights((s) => s.records)
  return useMemo(() => {
    const shown = Object.values(conversations)
    return {
      records: records && people ? records.map((r) => ({ ...r, conversationId: anchorFor({ settings: { people }, conversations: rawConversations }, r.conversationId) })) : records,
      titles: Object.fromEntries(shown.map((c) => [c.id, c.title])),
      groups: new Set(shown.filter((c) => c.isGroup).map((c) => c.id)),
      lastActivity: Object.fromEntries(shown.map((c) => [c.id, c.updatedAt]))
    }
  }, [records, conversations, rawConversations, people])
}

/** Close friends who have gone quiet, strongest first (snoozed ones left out). */
function useReconnect(): Reconnect[] {
  const { records, titles, groups, lastActivity } = usePeopleRecords()
  const snoozed = useInsights((s) => s.snoozed)
  return useMemo(() => (records ? reconnectCandidates(records, titles, { groups, lastActivity, snoozed }) : []), [records, titles, groups, lastActivity, snoozed])
}

/** "12 ngày im lặng · thường 2 ngày một lần": how long, against how often you usually talk. */
function reconnectMeta(r: Reconnect, t: ReturnType<typeof useT>): string {
  const usual = r.usualDays <= 1 ? t('reconnectUsualDaily') : t('reconnectUsual', { n: String(r.usualDays) })
  return `${t('reconnectSilent', { n: String(r.silentDays) })} · ${usual}`
}

/** Open the chat and, when the chat model is here, offer three ways to pick it back up. */
function useOpenReconnect(): (r: Reconnect) => void {
  const select = useStore((s) => s.select)
  const opener = useAi((s) => s.opener)
  return (r) => {
    select(r.conversationId)
    void opener(r.conversationId, r.silentDays)
  }
}

export interface BirthdaySoon {
  conversationId: string
  title: string
  /** 0: today, 1: tomorrow. */
  days: number
  age?: number
}

/**
 * Birthdays today and tomorrow among one-to-one chats: what you set on the contact, else what a platform said.
 * Today's drops off once you have written to them today, and either drops off when dismissed for the day.
 */
function useBirthdaysSoon(): BirthdaySoon[] {
  const conversations = useShownConversations()
  const overrides = useStore((s) => s.settings.contactOverrides)
  const known = useStore((s) => s.settings.knownBirthdays)
  const hidden = useStore((s) => s.settings.hidden)
  const enabled = useStore((s) => s.settings.birthdayReminders !== false)
  const profiles = useStore((s) => s.profiles)
  const dismissed = useInsights((s) => s.birthdayDismissed)
  return useMemo(() => {
    if (!enabled) return []
    const now = new Date()
    const today = dayKey(now)
    const out: BirthdaySoon[] = []
    for (const c of Object.values(conversations)) {
      if (c.isGroup || hidden?.[c.id] || dismissed[c.id] === today) continue
      const birthday = overrides?.[c.id]?.birthday ?? known?.[c.id] ?? profiles[c.id]?.birthday
      const days = daysUntilBirthday(birthday, now)
      if (days === undefined || days > 1) continue
      const last = c.lastMessage
      if (days === 0 && last?.isOutgoing && dayKey(new Date(last.sentAt)) === today) continue
      out.push({ conversationId: c.id, title: c.title, days, age: turningAge(birthday, now) })
    }
    return out.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title))
  }, [conversations, overrides, known, hidden, enabled, profiles, dismissed])
}

/** The first line of your note about someone, if you wrote one. */
function useNoteLine(conversationId: string | undefined): string | undefined {
  const note = useStore((s) => (conversationId ? s.settings.contactOverrides?.[conversationId]?.note : undefined))
  return note?.trim().split('\n')[0] || undefined
}

/**
 * Sidebar nudge about one person, only when there is someone: a birthday today, then one tomorrow, then a close
 * friend gone quiet against your usual rhythm with them. Your note about them comes along as a reminder of what
 * to say. "Later" sets a quiet friend aside for a week, a birthday for the day.
 */
export function ReconnectCard({ collapsed }: { collapsed: boolean }): JSX.Element | null {
  const t = useT()
  const conversations = useShownConversations()
  const reconnectOn = useStore((s) => s.settings.closeFriends !== false && s.settings.reconnectNudge !== false)
  const select = useStore((s) => s.select)
  const setComposerDraft = useStore((s) => s.setComposerDraft)
  const load = useInsights((s) => s.load)
  const snooze = useInsights((s) => s.snooze)
  const dismissBirthday = useInsights((s) => s.dismissBirthday)
  const openReconnect = useOpenReconnect()
  useEffect(() => {
    if (reconnectOn) void load()
  }, [load, reconnectOn])
  const birthday = useBirthdaysSoon()[0]
  const quiet = useReconnect()[0]
  const friend = reconnectOn ? quiet : undefined
  const id = birthday?.conversationId ?? friend?.conversationId
  const note = useNoteLine(id)
  if (!birthday && !friend) return null
  const conversation = conversations[id!]
  const title = birthday?.title ?? friend!.title

  let kicker: string
  let meta: string
  let primary: { label: string; icon: JSX.Element; run(): void }
  let later: () => void
  if (birthday) {
    kicker = birthday.days === 0 ? t('birthdayKickerToday') : t('birthdayKickerTomorrow')
    meta = birthday.age ? t('birthdayTurns', { n: String(birthday.age) }) : birthday.days === 0 ? t('birthdayMetaToday') : t('birthdayMetaTomorrow')
    primary =
      birthday.days === 0
        ? {
            label: t('birthdayWishAction'),
            icon: <Cake size={14} strokeWidth={2.4} />,
            run: () => {
              select(birthday.conversationId)
              setComposerDraft(birthday.conversationId, fillQuickReply(t('birthdayWishText'), givenName(birthday.title) || birthday.title))
            }
          }
        : { label: t('birthdayOpenAction'), icon: <MessageCircleHeart size={14} strokeWidth={2.4} />, run: () => select(birthday.conversationId) }
    later = () => dismissBirthday(birthday.conversationId)
  } else {
    kicker = t('reconnectKicker')
    meta = reconnectMeta(friend!, t)
    primary = { label: t('reconnectSay'), icon: <MessageCircleHeart size={14} strokeWidth={2.4} />, run: () => openReconnect(friend!) }
    later = () => snooze(friend!.conversationId)
  }

  if (collapsed) {
    return (
      <button className="nav-item subtle reconnect-rail" onClick={primary.run} title={`${kicker}: ${title} · ${meta}`}>
        <span className="nav-item-icon">{birthday ? <Cake size={16} strokeWidth={2.2} /> : <MessageCircleHeart size={16} strokeWidth={2.2} />}</span>
        <span className="rail-dot" />
      </button>
    )
  }
  return (
    <div className={`reconnect-card ${birthday ? 'birthday' : ''}`} role="note">
      <button className="reconnect-main" onClick={primary.run} title={primary.label}>
        <Avatar name={title} url={conversation?.avatarUrl} size={36} platform={conversation?.platform} />
        <span className="reconnect-text">
          <span className="reconnect-kicker">{kicker}</span>
          <span className="reconnect-name">{title}</span>
          <span className="reconnect-meta">{meta}</span>
        </span>
      </button>
      {note && (
        <p className="reconnect-note" title={note}>
          <NotebookPen size={12} strokeWidth={2.4} aria-label={t('noteTitle')} />
          <span>{note}</span>
        </p>
      )}
      <div className="reconnect-actions">
        <button className="btn small primary" onClick={primary.run}>
          {primary.icon}
          {primary.label}
        </button>
        <button className="btn small ghost" onClick={later} title={birthday ? t('birthdayLaterHint') : t('reconnectLaterHint')}>
          {t('reconnectLater')}
        </button>
      </div>
    </div>
  )
}

/** In Close friends: everyone who has gone quiet (up to five), each with a way back in. */
function ReconnectList({ onClose }: { onClose(): void }): JSX.Element | null {
  const t = useT()
  const conversations = useShownConversations()
  const snooze = useInsights((s) => s.snooze)
  const openReconnect = useOpenReconnect()
  const list = useReconnect().slice(0, 5)
  if (!list.length) return null
  return (
    <>
      <h3 className="cf-title">{t('cfReconnect')}</h3>
      <ul className="cf-reconnect">
        {list.map((r) => {
          const conversation = conversations[r.conversationId]
          return (
            <li key={r.conversationId}>
              <Avatar name={r.title} url={conversation?.avatarUrl} size={40} platform={conversation?.platform} />
              <span className="cf-reconnect-body">
                <span className="cf-person-name">{r.title}</span>
                <span className="cf-reconnect-meta">{reconnectMeta(r, t)}</span>
              </span>
              <button
                className="btn small primary"
                onClick={() => {
                  onClose()
                  openReconnect(r)
                }}
              >
                {t('reconnectSay')}
              </button>
              <button className="icon-btn small" onClick={() => snooze(r.conversationId)} title={t('reconnectLaterHint')}>
                <X size={14} strokeWidth={2.4} />
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** In Close friends, and only on a real anniversary: a message from this date in an earlier year. */
function MemoryRow({ onClose }: { onClose(): void }): JSX.Element | null {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const conversations = useStore((s) => s.conversations)
  const select = useStore((s) => s.select)
  const jumpTo = useStore((s) => s.jumpTo)
  const records = useInsights((s) => s.records)
  const memory: Memory | undefined = useMemo(() => (records ? onThisDay(records) : undefined), [records])
  if (!memory) return null
  const { record } = memory
  const conversation = conversations[record.conversationId]
  const who = record.isOutgoing ? t('you') : record.senderName
  const open = (): void => {
    onClose()
    select(record.conversationId)
    setTimeout(() => void jumpTo(record.id, { from: record.conversationId }), 400)
  }
  return (
    <>
      <h3 className="cf-title">{t('memoryTitle')}</h3>
      <button className="cf-memory" onClick={open} title={t('memoryOpen')}>
        {/* In a group the face is whoever wrote it, not the group's picture. */}
        {conversation?.isGroup ? <Avatar name={who} size={40} /> : <Avatar name={conversation?.title ?? who} url={conversation?.avatarUrl} size={40} />}
        <span className="cf-memory-body">
          <span className="cf-memory-ago">{memory.years === 1 ? t('memoryYearAgo') : t('memoryYearsAgo', { n: String(memory.years) })}</span>
          <span className="cf-memory-snippet">
            <b>{who}:</b>{' '}
            {record.text.trim() ||
              (record.hasPhoto ? (
                <>
                  <ImageIcon size={13} strokeWidth={2.4} /> {t('memoryPhoto')}
                </>
              ) : (
                '…'
              ))}
          </span>
          <span className="cf-memory-when">
            {conversation?.title} · {formatListTime(record.sentAt, language)}
          </span>
        </span>
      </button>
    </>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
export const WEEKDAYS = {
  vi: ['thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy', 'Chủ nhật'],
  en: ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
}

/** "2 AM" / "2 giờ sáng": the hour the way people say it. */
export function hourPhrase(h: number, language: string): string {
  if (language === 'vi') {
    const part = h < 11 ? 'sáng' : h < 13 ? 'trưa' : h < 18 ? 'chiều' : h < 22 ? 'tối' : 'đêm'
    return `${h > 12 ? h - 12 : h === 0 ? 12 : h} giờ ${part}`
  }
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
}

/**
 * The friends around you: you in the middle, the closest three on the inner ring, the next five further out.
 * Nearer and bigger means closer. They fly out from you once when the sheet opens (or the period changes).
 */
export const INNER = [-12, 168, 78]
export const OUTER = [-66, 4, 62, 122, 222]
function FriendOrbit({ top, onOpen }: { top: ContactInsight[]; onOpen(id: string): void }): JSX.Element {
  const t = useT()
  const conversations = useShownConversations()
  const accounts = useStore((s) => s.accounts)
  const me = Object.values(accounts).find((a) => !a.demo) ?? Object.values(accounts)[0]
  const friends = top.slice(0, 8)
  return (
    <div className="cf-orbit" role="group" aria-label={t('insights')}>
      <span className="cf-ring inner" aria-hidden />
      <span className="cf-ring outer" aria-hidden />
      <span className="cf-me">
        <Avatar name={me?.displayName ?? t('cfYou')} url={me?.avatarUrl} size={52} />
        <span className="cf-me-label">{t('cfYou')}</span>
      </span>
      {friends.map((c, i) => {
        const inner = i < 3
        const angle = ((inner ? INNER[i] : OUTER[i - 3]) * Math.PI) / 180
        // Ring radii as a share of the sky, so the orbit keeps its shape at any sheet width.
        const [rx, ry] = inner ? [26, 27] : [42, 41]
        const x = Math.cos(angle) * rx
        const y = Math.sin(angle) * ry
        const size = i === 0 ? 60 : inner ? 48 : 38
        const conversation = conversations[c.conversationId]
        return (
          <button
            key={c.conversationId}
            className={`cf-friend ${i === 0 ? 'first' : inner ? 'near' : 'far'}`}
            style={{ '--x': `${x}%`, '--y': `${y}%`, '--delay': `${120 + i * 70}ms` } as React.CSSProperties}
            onClick={() => onOpen(c.conversationId)}
            title={c.title}
            aria-label={c.title}
          >
            <span className="cf-friend-face">
              <Avatar name={c.title} url={conversation?.avatarUrl} size={size} />
              {i === 0 && (
                <span className="cf-crown" aria-hidden>
                  <Crown size={12} strokeWidth={2.6} />
                </span>
              )}
              {c.streak >= 2 && (
                <span className="cf-flame" aria-hidden>
                  <Flame size={10} strokeWidth={2.8} />
                  {c.streak}
                </span>
              )}
            </span>
            {inner && <span className="cf-friend-name">{firstWord(c.title)}</span>}
          </button>
        )
      })}
    </div>
  )
}

const firstWord = (name: string): string => (name.length <= 12 ? name : name.split(/\s+/)[0])

const VIBE_ICON: Record<Vibe, JSX.Element> = {
  night: <Moon size={12} strokeWidth={2.6} />,
  you: <ArrowUpRight size={12} strokeWidth={2.6} />,
  them: <ArrowDownLeft size={12} strokeWidth={2.6} />,
  even: <ArrowLeftRight size={12} strokeWidth={2.6} />
}
const VIBE_LABEL: Record<Vibe, TKey> = { night: 'vibeNight', you: 'vibeYou', them: 'vibeThem', even: 'vibeEven' }

/** When you talk most, as a character: the time card takes its colours from it. */
export type Persona = 'early' | 'lunch' | 'afternoon' | 'evening' | 'night'
export const personaOf = (h: number): Persona => (h >= 5 && h < 11 ? 'early' : h < 14 && h >= 11 ? 'lunch' : h >= 14 && h < 18 ? 'afternoon' : h >= 18 && h < 22 ? 'evening' : 'night')
export const PERSONA_LABEL: Record<Persona, TKey> = { early: 'cfPersonaEarly', lunch: 'cfPersonaLunch', afternoon: 'cfPersonaAfternoon', evening: 'cfPersonaEvening', night: 'cfPersonaNight' }

/** The day as a clock: 24 rays, longer where you talked more, the busiest one lit. Midnight at the top. */
function DayClock({ hours, peak }: { hours: number[]; peak: number }): JSX.Element {
  const max = Math.max(1, ...hours)
  const C = 64
  return (
    <svg className="cf-clock" viewBox="0 0 128 128" aria-hidden>
      <circle cx={C} cy={C} r={20} className="cf-clock-face" />
      {hours.map((v, h) => {
        const a = (h / 24) * Math.PI * 2 - Math.PI / 2
        const r0 = 26
        const r1 = r0 + 6 + (v / max) * 32
        return <line key={h} x1={C + Math.cos(a) * r0} y1={C + Math.sin(a) * r0} x2={C + Math.cos(a) * r1} y2={C + Math.sin(a) * r1} className={h === peak ? 'peak' : v ? 'on' : 'off'} />
      })}
      <text x={C} y={C + 5} textAnchor="middle" className="cf-clock-hour">
        {peak}h
      </text>
    </svg>
  )
}

/**
 * The period as three bold story cards, Wrapped-style: how much you talked (with a playful yardstick), your
 * golden hour as a character on its own colours, and the streak on fire.
 */
function StoryCards({ insights, language }: { insights: Insights; language: string }): JSX.Element {
  const t = useT()
  const total = insights.sent + insights.received
  // About six words a chat message and 250 words a printed page.
  const pages = Math.round((total * 6) / 250)
  const persona = personaOf(insights.busiestHour)
  const weekday = (language === 'vi' ? WEEKDAYS.vi : WEEKDAYS.en)[insights.busiestWeekday]
  const streak = insights.streak
  return (
    <div className="cf-story">
      <section className="cf-card messages">
        <span className="cf-bubbles" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <p className="cf-kicker">{t('cfCardMessagesKicker')}</p>
        <p className="cf-giant">{total.toLocaleString(language)}</p>
        <p className="cf-unit">{t('cfCardMessagesUnit')}</p>
        <div className="cf-split">
          <span>
            <b>{insights.sent.toLocaleString(language)}</b> {t('cfCardSent')}
          </span>
          <span>
            <b>{insights.received.toLocaleString(language)}</b> {t('cfCardReceived')}
          </span>
        </div>
        {pages >= 1 && <p className="cf-fun">{t('cfCardPages', { n: String(pages) })}</p>}
      </section>
      <div className="cf-story-pair">
        <section className={`cf-card time ${persona}`}>
          <p className="cf-kicker">{t('cfCardTimeKicker')}</p>
          <DayClock hours={insights.hours} peak={insights.busiestHour} />
          <p className="cf-persona">{t(PERSONA_LABEL[persona])}</p>
          <p className="cf-card-sub">{t('cfCardTimeSub', { hour: hourPhrase(insights.busiestHour, language), weekday })}</p>
        </section>
        <section className={`cf-card streak ${streak ? '' : 'none'}`}>
          <Flame className="cf-streak-art" size={150} strokeWidth={1.4} aria-hidden />
          <p className="cf-kicker">{t('cfCardStreakKicker')}</p>
          {streak ? (
            <>
              <p className="cf-giant">{streak.streak}</p>
              <p className="cf-unit">{t('cfCardStreakUnit')}</p>
              <p className="cf-card-sub">{t('cfCardStreakWith', { name: streak.title })}</p>
            </>
          ) : (
            <p className="cf-card-sub">{t('cfCardNoStreak')}</p>
          )}
        </section>
      </div>
    </div>
  )
}

const MEDALS = ['gold', 'silver', 'bronze'] as const

/** The top three on a podium: second, first, third, each on a metal step with a medal on a ribbon. */
function Podium({ top, onOpen }: { top: ContactInsight[]; onOpen(id: string): void }): JSX.Element {
  const t = useT()
  const conversations = useShownConversations()
  // Visual order on the podium: 2nd on the left, 1st in the middle, 3rd on the right.
  const order = [1, 0, 2].filter((i) => top[i])
  return (
    <div className="cf-podium">
      {order.map((i) => {
        const c = top[i]
        const medal = MEDALS[i]
        return (
          <button key={c.conversationId} className={`cf-place ${medal}`} onClick={() => onOpen(c.conversationId)} aria-label={`${i + 1}. ${c.title}`}>
            <span className="cf-place-face">
              <Avatar name={c.title} url={conversations[c.conversationId]?.avatarUrl} size={i === 0 ? 76 : 60} />
              <span className="cf-medal" aria-hidden>
                <span className="cf-ribbon" />
                <span className="cf-medal-disc">{i + 1}</span>
              </span>
            </span>
            <span className="cf-place-name">{c.title}</span>
            <span className="cf-place-meta">
              {t('cfTotal', { n: String(c.total) })}
              {c.streak >= 2 && (
                <span className="cf-streak-chip">
                  <Flame size={11} strokeWidth={2.8} />
                  {c.streak}
                </span>
              )}
            </span>
            <span className="cf-step" aria-hidden>
              <span>{i + 1}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Who you talk to most, when, and your streaks: the last 30 days or this year. */
export function InsightsSheet(): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const logo = useStore((s) => s.settings.logo ?? 'buddies')
  const conversations = useShownConversations()
  const closeSheet = useStore((s) => s.closeSheet)
  const select = useStore((s) => s.select)
  const load = useInsights((s) => s.load)
  const backfill = useInsights((s) => s.backfill)
  const progress = useInsights((s) => s.progress)
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const [sharing, setSharing] = useState(false)
  const accounts = useStore((s) => s.accounts)
  const showToast = useStore((s) => s.showToast)
  useEffect(() => {
    void load(true).then(() => backfill())
  }, [load, backfill])
  const byPerson = usePeopleRecords()
  const insights = useMemo(
    () => (byPerson.records ? computeInsights(byPerson.records, byPerson.titles, Date.now(), period === 'month' ? 30 : 365, byPerson.groups) : undefined),
    [byPerson, period]
  )
  const openChat = (id: string): void => {
    closeSheet()
    select(id)
  }
  const closest = insights?.top[0]
  const rest = insights?.top.slice(3) ?? []
  // The story picture: everything resolved here, since it is drawn in a window without the app's store.
  const share = async (): Promise<void> => {
    if (!insights || sharing) return
    const me = Object.values(accounts).find((a) => !a.demo) ?? Object.values(accounts)[0]
    const card: ShareCardData = {
      language: language === 'vi' ? 'vi' : 'en',
      period,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f7df3',
      logoColor: (LOGOS[logo] ?? LOGOS.buddies).color,
      logo,
      me: { name: me?.displayName ?? t('cfYou'), avatarUrl: me?.avatarUrl },
      friends: insights.top.slice(0, 8).map((c) => ({ name: c.title, avatarUrl: conversations[c.conversationId]?.avatarUrl, streak: c.streak, total: c.total })),
      total: insights.sent + insights.received,
      sent: insights.sent,
      received: insights.received,
      busiestHour: insights.busiestHour,
      busiestWeekday: insights.busiestWeekday,
      streak: insights.streak ? { name: insights.streak.title, days: insights.streak.streak } : undefined
    }
    setSharing(true)
    try {
      const { path } = await window.unison.insights.share(card)
      if (path) showToast(t('shareSaved'))
    } catch {
      showToast(t('shareFailed'), 'error')
    } finally {
      setSharing(false)
    }
  }
  // Their side of every balance bar wears the colour of the logo character you picked.
  const sheetStyle = { '--cf-them': (LOGOS[logo] ?? LOGOS.buddies).color } as React.CSSProperties
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet insights-sheet" role="dialog" aria-label={t('insights')} style={sheetStyle}>
        <div className="sheet-header">
          <div className="sheet-title">{t('insights')}</div>
          <div className="segmented insights-period">
            <button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>
              {t('insightsMonth')}
            </button>
            <button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>
              {t('insightsYear')}
            </button>
          </div>
          <button className="btn small secondary cf-share" onClick={() => void share()} disabled={!insights || insights.top.length === 0 || sharing}>
            {sharing ? <BuddyLoader size={14} inline /> : <Share2 size={14} strokeWidth={2.4} />}
            {t('shareButton')}
          </button>
          <button className="icon-btn" onClick={closeSheet} title={t('close')}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="sheet-body scroll">
          {progress && (
            <div className="insight-progress" role="status">
              <div className="ai-progress-track">
                <div className="ai-progress-fill" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 4}%` }} />
              </div>
              <span>{progress.total ? t('insightsFilling', { done: String(progress.done), total: String(progress.total) }) : t('insightsFillingStart')}</span>
            </div>
          )}
          {!insights && <div className="details-empty">{t('loading')}</div>}
          {insights && insights.sent + insights.received === 0 && <div className="details-empty">{t('insightsEmpty')}</div>}
          {insights && insights.sent + insights.received > 0 && (
            <>
              {insights.top.length > 0 && <FriendOrbit key={period} top={insights.top} onOpen={openChat} />}
              {closest && <h2 className="cf-headline">{t(period === 'month' ? 'cfClosest' : 'cfClosestYear', { name: closest.title })}</h2>}

              <StoryCards insights={insights} language={language} />

              {insights.top.length > 0 && (
                <>
                  <h3 className="cf-title">{t('cfPodium')}</h3>
                  <Podium top={insights.top} onOpen={openChat} />
                </>
              )}

              {rest.length > 0 && (
                <>
                  <h3 className="cf-title">{t('cfAlsoClose')}</h3>
                  <ol className="cf-people" start={4}>
                    {rest.map((c, i) => {
                      const conversation = conversations[c.conversationId]
                      const vibe = vibeOf(c, insights.nightShare)
                      const mine = c.total ? (c.sent / c.total) * 100 : 50
                      return (
                        <li key={c.conversationId}>
                          <button className="cf-person" onClick={() => openChat(c.conversationId)}>
                            <span className="cf-rank">{i + 4}</span>
                            <Avatar name={c.title} url={conversation?.avatarUrl} size={40} platform={conversation?.platform} />
                            <span className="cf-person-body">
                              <span className="cf-person-top">
                                <span className="cf-person-name">{c.title}</span>
                                {c.streak >= 2 && (
                                  <span className="cf-streak-chip">
                                    <Flame size={11} strokeWidth={2.8} />
                                    {c.streak}
                                  </span>
                                )}
                                <span className="cf-total">{t('cfTotal', { n: String(c.total) })}</span>
                              </span>
                              <span className={`cf-vibe ${vibe}`}>
                                {VIBE_ICON[vibe]}
                                {t(VIBE_LABEL[vibe])}
                              </span>
                              <span className="cf-balance" role="img" aria-label={`${t('cfYouN', { n: String(c.sent) })}, ${t('cfThemN', { n: String(c.received) })}`}>
                                <span className="cf-balance-you" style={{ width: `${mine}%` }} />
                                <span className="cf-balance-them" />
                              </span>
                              <span className="cf-balance-legend" aria-hidden>
                                <span>{t('cfYouN', { n: String(c.sent) })}</span>
                                <span>{t('cfThemN', { n: String(c.received) })}</span>
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                </>
              )}
              <ReconnectList onClose={closeSheet} />
              <MemoryRow onClose={closeSheet} />
              <div className="insight-foot">
                <ChartNoAxesColumn size={12} strokeWidth={2.4} /> {period === 'month' ? t('insightsNoteMonth') : t('insightsNoteYear')}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
