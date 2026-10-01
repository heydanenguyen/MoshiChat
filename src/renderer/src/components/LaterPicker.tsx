import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlarmClock, AlarmClockOff, BellRing, CalendarClock, CalendarDays, ChevronDown, Clock, Clock3, Coffee, Hourglass, Moon, Sunrise, X } from 'lucide-react'
import { atTime, dayLabel, followState, formatLaterTime, isSnoozed, laterPresets, nextDays, presetWhen, shortClock, type LaterKind, type PresetId } from '@shared/later'
import { useShownConversations, useStore, useT } from '../store'
import type { TKey } from '../i18n'
import { shortcutLabel } from '../utils'
import { Avatar } from './Avatar'

/** Each time of day keeps its own colour, so the list reads at a glance (and stays the same every time). */
const PRESET: Record<PresetId, { label: TKey; icon: JSX.Element; tone: string }> = {
  hour: { label: 'presetHour', icon: <Clock size={15} strokeWidth={2.2} />, tone: 'sky' },
  hours3: { label: 'presetHours3', icon: <Clock3 size={15} strokeWidth={2.2} />, tone: 'sky' },
  evening: { label: 'presetEvening', icon: <Moon size={15} strokeWidth={2.2} />, tone: 'violet' },
  tomorrow: { label: 'presetTomorrow', icon: <Sunrise size={15} strokeWidth={2.2} />, tone: 'amber' },
  weekend: { label: 'presetWeekend', icon: <Coffee size={15} strokeWidth={2.2} />, tone: 'rose' },
  days3: { label: 'presetDays3', icon: <Hourglass size={15} strokeWidth={2.2} />, tone: 'teal' },
  nextWeek: { label: 'presetNextWeek', icon: <CalendarDays size={15} strokeWidth={2.2} />, tone: 'green' }
}

/** Times offered under "Pick a date and time": morning, noon, afternoon, evening, night. */
const TIMES: Array<[number, number]> = [
  [8, 0],
  [12, 0],
  [14, 0],
  [18, 0],
  [21, 0]
]

/** "09:30" for an <input type="time">. */
const hhmm = (h: number, m: number): string => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

/**
 * In the chat header: snooze this chat or set a follow-up. While a follow-up waits the bell shows instead, and
 * opens straight on it (so it can be moved or cancelled).
 */
export function LaterButton({ conversationId }: { conversationId: string }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const follow = useStore((s) => s.settings.followUps?.[conversationId])
  const openLaterPicker = useStore((s) => s.openLaterPicker)
  const waiting = followState(follow) === 'waiting'
  const label = waiting ? t('laterFollowingUntil', { time: formatLaterTime(follow!.until, language) }) : `${t('laterHeaderTitle')} (${shortcutLabel('H', true)})`
  return (
    <button
      className={`icon-btn ${waiting ? 'active' : ''}`}
      data-later-anchor
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        openLaterPicker({ conversationId, mode: waiting ? 'follow' : 'snooze', x: r.right, y: r.bottom + 6, align: 'end' })
      }}
    >
      {waiting ? <BellRing size={18} strokeWidth={2} /> : <AlarmClock size={18} strokeWidth={2} />}
    </button>
  )
}

/**
 * When to bring a chat back, or when to remind you if they have not answered. Who it is about sits at the top;
 * then the times people actually say ("This evening", "Next week"), each with only the part of the time its name
 * does not already say; then any day and time, picked from a strip of days and a few usual hours rather than a
 * bare date field. Opens where it was asked for (a context menu, the chat header, ⌘⇧H), works from the keyboard
 * (arrows, Enter, Esc) and keeps itself on screen.
 */
export function LaterPicker(): JSX.Element | null {
  const picker = useStore((s) => s.laterPicker)
  if (!picker) return null
  return <LaterPickerBody key={`${picker.conversationId}|${picker.x}|${picker.y}`} />
}

function LaterPickerBody(): JSX.Element | null {
  const t = useT()
  const picker = useStore((s) => s.laterPicker)!
  const language = useStore((s) => s.settings.language)
  const snoozedEntry = useStore((s) => s.settings.snoozed?.[picker.conversationId])
  const followEntry = useStore((s) => s.settings.followUps?.[picker.conversationId])
  const conversation = useShownConversations()[picker.conversationId]
  const close = useStore((s) => s.closeLaterPicker)
  const snooze = useStore((s) => s.snooze)
  const unsnooze = useStore((s) => s.unsnooze)
  const followUp = useStore((s) => s.followUp)
  const cancelFollowUp = useStore((s) => s.cancelFollowUp)
  const [mode, setMode] = useState<LaterKind>(picker.mode)
  const [custom, setCustom] = useState(false)
  const days = useMemo(() => nextDays(7), [])
  const [day, setDay] = useState(days[1])
  const [time, setTime] = useState(hhmm(9, 0))
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>()
  const ref = useRef<HTMLDivElement>(null)
  const presets = useMemo(() => laterPresets(mode), [mode])
  const now = Date.now()
  const active = mode === 'snooze' ? (isSnoozed(snoozedEntry, now) ? snoozedEntry : undefined) : followState(followEntry, now) === 'waiting' ? followEntry : undefined
  const [hour, minute] = time.split(':').map(Number)
  const chosen = atTime(day, hour || 0, minute || 0)
  const chosenOk = chosen > now + 60_000

  // On screen whatever the anchor: flip left or up when it would spill over an edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Layout size, not getBoundingClientRect: while the open animation scales the picker the rect is smaller,
    // and measuring it then placed the picker further right than after a tab switch (it jumped left).
    const width = el.offsetWidth
    const height = el.offsetHeight
    const x = picker.x ?? (window.innerWidth - width) / 2
    const y = picker.y ?? (window.innerHeight - height) / 2
    const left = Math.max(8, Math.min(picker.align === 'end' ? x - width : x, window.innerWidth - width - 8))
    const top = Math.max(8, Math.min(y, window.innerHeight - height - 8))
    setPos({ left, top })
  }, [picker.x, picker.y, picker.align, mode, custom, active])

  // Opened from the keyboard (⌘⇧H): the first time is focused, ready for Enter. Opened with the mouse: the picker
  // itself takes focus, so the arrows still work but no row looks chosen before you choose. Focus goes back on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    if (picker.keyboard) ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    else ref.current?.focus()
    return () => before?.focus?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
    }
  }, [close])

  const pick = (until: number): void => {
    close()
    void (mode === 'snooze' ? snooze(picker.conversationId, until) : followUp(picker.conversationId, until))
  }

  // Up and down walk the rows (wrapping), Home and End jump.
  const onMenuKey = (e: React.KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    // Nothing focused yet (opened with the mouse): down starts at the top, up at the bottom.
    const from = at < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : at
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (from + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next].focus()
  }

  if (!conversation) return null
  const snoozing = mode === 'snooze'
  return createPortal(
    <div
      ref={ref}
      className="later-picker"
      tabIndex={-1}
      onKeyDown={onMenuKey}
      role="dialog"
      aria-label={snoozing ? t('laterTabSnooze') : t('laterTabFollow')}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="later-head">
        <Avatar name={conversation.title} url={conversation.avatarUrl} size={30} platform={conversation.platform} />
        <div className="later-head-text">
          <span className="later-head-name">{conversation.title}</span>
          <span className="later-head-sub">{snoozing ? t('laterSnoozeHint') : t('laterFollowHint')}</span>
        </div>
        <button className="icon-btn small later-close" onClick={close} aria-label={t('close')}>
          <X size={14} strokeWidth={2.4} />
        </button>
      </div>

      <div className="segmented later-tabs" role="tablist">
        <button role="tab" aria-selected={snoozing} className={snoozing ? 'active' : ''} onClick={() => setMode('snooze')}>
          <AlarmClock size={14} strokeWidth={2.4} aria-hidden /> {t('laterTabSnooze')}
        </button>
        <button role="tab" aria-selected={!snoozing} className={!snoozing ? 'active' : ''} onClick={() => setMode('follow')}>
          <BellRing size={14} strokeWidth={2.4} aria-hidden /> {t('laterTabFollow')}
        </button>
      </div>

      {active && (
        <div className="later-current" role="status">
          <span className="later-current-text">
            {snoozing ? <AlarmClock size={13} strokeWidth={2.4} aria-hidden /> : <BellRing size={13} strokeWidth={2.4} aria-hidden />}
            {snoozing ? t('laterSnoozedUntil', { time: formatLaterTime(active.until, language) }) : t('laterFollowingUntil', { time: formatLaterTime(active.until, language) })}
          </span>
          <button
            className="later-current-clear"
            onClick={() => {
              close()
              void (snoozing ? unsnooze(picker.conversationId) : cancelFollowUp(picker.conversationId))
            }}
          >
            {snoozing ? <AlarmClockOff size={13} strokeWidth={2.4} aria-hidden /> : <X size={13} strokeWidth={2.4} aria-hidden />}
            {snoozing ? t('unsnoozeAction') : t('unfollowAction')}
          </button>
        </div>
      )}

      <div className="later-list" role="menu" aria-orientation="vertical">
        {presets.map((p) => (
          <button key={p.id} role="menuitem" className="later-row" onClick={() => pick(p.until)} title={formatLaterTime(p.until, language)}>
            <span className={`later-tile ${PRESET[p.id].tone}`} aria-hidden>
              {PRESET[p.id].icon}
            </span>
            <span className="later-row-label">{t(PRESET[p.id].label)}</span>
            <span className="later-row-when">{presetWhen(p, language)}</span>
          </button>
        ))}
        <button role="menuitem" className={`later-row later-custom-toggle ${custom ? 'open' : ''}`} aria-expanded={custom} onClick={() => setCustom((c) => !c)}>
          <span className="later-tile slate" aria-hidden>
            <CalendarClock size={15} strokeWidth={2.2} />
          </span>
          <span className="later-row-label">{t('presetCustom')}</span>
          <ChevronDown size={15} strokeWidth={2.4} className="later-chevron" aria-hidden />
        </button>
      </div>

      {custom && (
        <div className="later-custom">
          <div className="later-days" role="group" aria-label={t('laterDay')}>
            {days.map((d) => {
              const label = dayLabel(d, language)
              // Today only while one of the usual hours is still ahead.
              if (label.relative === 'today' && !TIMES.some(([h, m]) => atTime(d, h, m) > now + 60_000)) return null
              return (
                <button key={d} className={`later-day ${d === day ? 'on' : ''}`} aria-pressed={d === day} onClick={() => setDay(d)}>
                  <span className="later-day-name">{label.relative === 'today' ? t('laterToday') : label.relative === 'tomorrow' ? t('laterTomorrowShort') : label.weekday}</span>
                  <span className="later-day-num">{label.day}</span>
                </button>
              )
            })}
          </div>
          <div className="later-times" role="group" aria-label={t('laterTime')}>
            {TIMES.map(([h, m]) => {
              const value = hhmm(h, m)
              const past = atTime(day, h, m) <= now + 60_000
              return (
                <button key={value} className={`later-time ${time === value ? 'on' : ''}`} aria-pressed={time === value} disabled={past} onClick={() => setTime(value)}>
                  {shortClock(atTime(day, h, m), language)}
                </button>
              )
            })}
            <input className="later-time-input" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} aria-label={t('laterTimeOther')} />
          </div>
          <div className="later-confirm">
            <span className={`later-summary ${chosenOk ? '' : 'error'}`} role={chosenOk ? undefined : 'alert'}>
              {chosenOk ? formatLaterTime(chosen, language) : t('laterPast')}
            </span>
            <button className="btn small primary" disabled={!chosenOk} onClick={() => pick(chosen)}>
              {snoozing ? t('laterConfirmSnooze') : t('laterConfirmFollow')}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
