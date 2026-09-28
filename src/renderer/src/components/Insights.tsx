import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { ChartNoAxesColumn, Flame, Sparkles, X } from 'lucide-react'
import { computeInsights, onThisDay, type InsightRecord, type Memory } from '@shared/insights'
import { useStore, useT } from '../store'
import { formatListTime } from '../utils'
import { Avatar } from './Avatar'

interface InsightsState {
  records?: InsightRecord[]
  loadedAt?: number
  load(force?: boolean): Promise<void>
}

/** The message records behind the insights, fetched once per session (or when asked again). */
export const useInsights = create<InsightsState>((set, get) => ({
  async load(force) {
    if (!force && get().loadedAt && Date.now() - get().loadedAt! < 10 * 60_000) return
    try {
      set({ records: await window.unison.insights.records(), loadedAt: Date.now() })
    } catch {
      set({ records: [], loadedAt: Date.now() })
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
    setTimeout(() => void jumpTo(memory.record.id), 400)
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

/** Who you talk to most, when, and your streaks: this month or this year. */
export function InsightsSheet(): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const conversations = useStore((s) => s.conversations)
  const closeSheet = useStore((s) => s.closeSheet)
  const select = useStore((s) => s.select)
  const records = useInsights((s) => s.records)
  const load = useInsights((s) => s.load)
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  useEffect(() => {
    void load(true)
  }, [load])
  const insights = useMemo(() => {
    if (!records) return undefined
    const titles = Object.fromEntries(Object.values(conversations).map((c) => [c.id, c.title]))
    return computeInsights(records, titles, Date.now(), period === 'month' ? 30 : 365)
  }, [records, conversations, period])
  const weekdayNames = language === 'vi' ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const maxHour = insights ? Math.max(1, ...insights.hours) : 1
  const maxDay = insights ? Math.max(1, ...insights.weekdays) : 1
  const maxTop = insights?.top[0]?.total ?? 1
  const openChat = (id: string): void => {
    closeSheet()
    select(id)
  }
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet insights-sheet" role="dialog" aria-label={t('insights')}>
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
          {!insights && <div className="details-empty">{t('loading')}</div>}
          {insights && insights.sent + insights.received === 0 && <div className="details-empty">{t('insightsEmpty')}</div>}
          {insights && insights.sent + insights.received > 0 && (
            <>
              <div className="insight-tiles">
                <div className="insight-tile accent">
                  <div className="insight-number">{insights.sent + insights.received}</div>
                  <div className="insight-label">{t('insightsMessages')}</div>
                  <div className="insight-sub">
                    {t('insightsSent', { n: String(insights.sent) })} · {t('insightsReceived', { n: String(insights.received) })}
                  </div>
                </div>
                <div className="insight-tile">
                  <div className="insight-number">{insights.chats}</div>
                  <div className="insight-label">{t('insightsChats')}</div>
                </div>
                <div className="insight-tile">
                  <div className="insight-number">{String(insights.busiestHour).padStart(2, '0')}h</div>
                  <div className="insight-label">{t('insightsBusiestHour')}</div>
                  <div className="insight-sub">{weekdayNames[insights.busiestWeekday]}</div>
                </div>
                {insights.streak && (
                  <div className="insight-tile fire">
                    <div className="insight-number">
                      <Flame size={22} strokeWidth={2.4} /> {insights.streak.streak}
                    </div>
                    <div className="insight-label">{t('insightsStreak')}</div>
                    <div className="insight-sub">{insights.streak.title}</div>
                  </div>
                )}
              </div>

              <div className="insight-section">
                <div className="insight-title">{t('insightsTop')}</div>
                {insights.top.map((c, i) => {
                  const conversation = conversations[c.conversationId]
                  return (
                    <button key={c.conversationId} className="insight-row" onClick={() => openChat(c.conversationId)}>
                      <span className="insight-rank">{i + 1}</span>
                      <Avatar name={c.title} url={conversation?.avatarUrl} size={30} platform={conversation?.platform} />
                      <span className="insight-row-text">
                        <span className="insight-row-name">
                          {c.title}
                          {c.streak >= 2 && (
                            <span className="insight-streak">
                              <Flame size={11} strokeWidth={2.6} /> {c.streak}
                            </span>
                          )}
                        </span>
                        <span className="insight-bar">
                          <span className="insight-bar-fill" style={{ width: `${Math.max(4, (c.total / maxTop) * 100)}%` }} />
                        </span>
                      </span>
                      <span className="insight-row-count">
                        <strong>{c.total}</strong>
                        <span>
                          {c.sent} ↑ {c.received} ↓
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="insight-section">
                <div className="insight-title">{t('insightsHours')}</div>
                <div className="insight-hours">
                  {HOURS.map((h) => (
                    <span key={h} className={`insight-hour ${h === insights.busiestHour ? 'peak' : ''}`} title={`${h}:00 · ${insights.hours[h]}`}>
                      <span className="insight-hour-fill" style={{ height: `${Math.max(4, (insights.hours[h] / maxHour) * 100)}%` }} />
                    </span>
                  ))}
                </div>
                <div className="insight-hours-axis">
                  <span>0h</span>
                  <span>6h</span>
                  <span>12h</span>
                  <span>18h</span>
                  <span>23h</span>
                </div>
              </div>

              <div className="insight-section">
                <div className="insight-title">{t('insightsWeekdays')}</div>
                <div className="insight-weekdays">
                  {insights.weekdays.map((v, i) => (
                    <span key={i} className={`insight-weekday ${i === insights.busiestWeekday ? 'peak' : ''}`}>
                      <span className="insight-weekday-fill" style={{ height: `${Math.max(4, (v / maxDay) * 100)}%` }} />
                      <span className="insight-weekday-name">{weekdayNames[i]}</span>
                    </span>
                  ))}
                </div>
              </div>

              {insights.quiet.length > 0 && (
                <div className="insight-section">
                  <div className="insight-title">{t('insightsQuiet')}</div>
                  <div className="insight-sub" style={{ marginBottom: 6 }}>
                    {t('insightsQuietHint')}
                  </div>
                  {insights.quiet.map((c) => (
                    <button key={c.conversationId} className="insight-row quiet" onClick={() => openChat(c.conversationId)}>
                      <Avatar name={c.title} url={conversations[c.conversationId]?.avatarUrl} size={26} />
                      <span className="insight-row-text">
                        <span className="insight-row-name">{c.title}</span>
                      </span>
                      <span className="insight-row-count">{t('insightsSent', { n: String(c.sent) })}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="insight-foot">
                <ChartNoAxesColumn size={12} strokeWidth={2.4} /> {t('insightsNote')}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
