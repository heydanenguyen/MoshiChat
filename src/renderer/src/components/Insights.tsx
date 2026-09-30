import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChartNoAxesColumn, Crown, Flame, Moon, Sparkles, X } from 'lucide-react'
import { computeInsights, onThisDay, vibeOf, type ContactInsight, type InsightRecord, type Insights, type Memory, type Vibe } from '@shared/insights'
import { LOGOS } from '@shared/logos'
import { useStore, useT, anchorFor, useShownConversations } from '../store'
import { formatListTime } from '../utils'
import type { TKey } from '../i18n'
import { Avatar } from './Avatar'

interface InsightsState {
  records?: InsightRecord[]
  loadedAt?: number
  /** The 30-day backfill walking chats: done of total (undefined when idle). */
  progress?: { done: number; total: number }
  load(force?: boolean): Promise<void>
  /** Fill the last 30 days of every active chat, refreshing the numbers as chats complete. */
  backfill(): Promise<void>
}

let listening = false

/** The message records behind the insights, fetched once per session (or when asked again). */
export const useInsights = create<InsightsState>((set, get) => ({
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

const MEMORY_KEY = 'moshi.memory.dismissed'
const todayKey = (): string => new Date().toDateString()

/** Sidebar card: one message from this day in an earlier year (or month, or last week). */
export function MemoryCard({ collapsed }: { collapsed: boolean }): JSX.Element | null {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const conversations = useStore((s) => s.conversations)
  const select = useStore((s) => s.select)
  const jumpTo = useStore((s) => s.jumpTo)
  const records = useInsights((s) => s.records)
  const load = useInsights((s) => s.load)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(MEMORY_KEY) === todayKey()
    } catch {
      return false
    }
  })
  useEffect(() => {
    void load()
  }, [load])
  const memory: Memory | undefined = useMemo(() => (records ? onThisDay(records) : undefined), [records])
  if (dismissed || !memory) return null
  const conversation = conversations[memory.record.conversationId]
  const ago =
    'years' in memory.ago
      ? memory.ago.years === 1
        ? t('memoryYearAgo')
        : t('memoryYearsAgo', { n: String(memory.ago.years) })
      : 'months' in memory.ago
        ? memory.ago.months === 1
          ? t('memoryMonthAgo')
          : t('memoryMonthsAgo', { n: String(memory.ago.months) })
        : t('memoryWeekAgo')
  const open = (): void => {
    select(memory.record.conversationId)
    setTimeout(() => void jumpTo(memory.record.id, { from: memory.record.conversationId }), 400)
  }
  const dismiss = (): void => {
    setDismissed(true)
    try {
      localStorage.setItem(MEMORY_KEY, todayKey())
    } catch {
      /* private mode */
    }
  }
  if (collapsed) {
    return (
      <button className="nav-item subtle memory-rail" onClick={open} title={`${t('memoryTitle')} · ${ago}`}>
        <span className="nav-item-icon">
          <Sparkles size={16} strokeWidth={2.2} />
        </span>
      </button>
    )
  }
  return (
    <div className="memory-card" role="note">
      <div className="memory-head">
        <Sparkles size={13} strokeWidth={2.4} />
        <span>{t('memoryTitle')}</span>
        <span className="memory-ago">{ago}</span>
        <button className="update-card-close" onClick={dismiss} title={t('close')}>
          <X size={12} strokeWidth={2.6} />
        </button>
      </div>
      <button className="memory-body" onClick={open} title={t('memoryOpen')}>
        {conversation && <Avatar name={conversation.title} url={conversation.avatarUrl} size={28} />}
        <span className="memory-text">
          <span className="memory-who">{memory.record.isOutgoing ? t('you') : memory.record.senderName}</span>
          <span className="memory-snippet">{memory.record.text.trim() || (memory.record.hasPhoto ? t('memoryPhoto') : '…')}</span>
          <span className="memory-when">
            {conversation?.title} · {formatListTime(memory.record.sentAt, language)}
          </span>
        </span>
      </button>
    </div>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const WEEKDAYS = {
  vi: ['thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy', 'Chủ nhật'],
  en: ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
}

/** "2 AM" / "2 giờ sáng": the hour the way people say it. */
function hourPhrase(h: number, language: string): string {
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
const INNER = [-12, 168, 78]
const OUTER = [-66, 4, 62, 122, 222]
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
type Persona = 'early' | 'lunch' | 'afternoon' | 'evening' | 'night'
const personaOf = (h: number): Persona => (h >= 5 && h < 11 ? 'early' : h < 14 && h >= 11 ? 'lunch' : h >= 14 && h < 18 ? 'afternoon' : h >= 18 && h < 22 ? 'evening' : 'night')
const PERSONA_LABEL: Record<Persona, TKey> = { early: 'cfPersonaEarly', lunch: 'cfPersonaLunch', afternoon: 'cfPersonaAfternoon', evening: 'cfPersonaEvening', night: 'cfPersonaNight' }

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
  const rawConversations = useStore((s) => s.conversations)
  const people = useStore((s) => s.settings.people)
  const closeSheet = useStore((s) => s.closeSheet)
  const select = useStore((s) => s.select)
  const records = useInsights((s) => s.records)
  const load = useInsights((s) => s.load)
  const backfill = useInsights((s) => s.backfill)
  const progress = useInsights((s) => s.progress)
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  useEffect(() => {
    void load(true).then(() => backfill())
  }, [load, backfill])
  const insights = useMemo(() => {
    if (!records) return undefined
    // One person across apps counts as one friend: their chats' messages (and days) add up under the person.
    const byPerson = people ? records.map((r) => ({ ...r, conversationId: anchorFor({ settings: { people }, conversations: rawConversations }, r.conversationId) })) : records
    const titles = Object.fromEntries(Object.values(conversations).map((c) => [c.id, c.title]))
    const groups = new Set(Object.values(conversations).filter((c) => c.isGroup).map((c) => c.id))
    return computeInsights(byPerson, titles, Date.now(), period === 'month' ? 30 : 365, groups)
  }, [records, conversations, rawConversations, people, period])
  const openChat = (id: string): void => {
    closeSheet()
    select(id)
  }
  const closest = insights?.top[0]
  const rest = insights?.top.slice(3) ?? []
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
