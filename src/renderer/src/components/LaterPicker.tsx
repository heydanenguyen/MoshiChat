import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlarmClock, AlarmClockOff, BellRing, CalendarClock, CalendarDays, Clock, Clock3, Coffee, Hourglass, Moon, Sunrise, X } from 'lucide-react'
import { followState, formatLaterTime, isSnoozed, laterPresets, type LaterKind, type PresetId } from '@shared/later'
import { useShownConversations, useStore, useT } from '../store'
import type { TKey } from '../i18n'
import { shortcutLabel } from '../utils'

const PRESET: Record<PresetId, { label: TKey; icon: JSX.Element }> = {
  hour: { label: 'presetHour', icon: <Clock size={15} strokeWidth={2.2} /> },
  hours3: { label: 'presetHours3', icon: <Clock3 size={15} strokeWidth={2.2} /> },
  evening: { label: 'presetEvening', icon: <Moon size={15} strokeWidth={2.2} /> },
  tomorrow: { label: 'presetTomorrow', icon: <Sunrise size={15} strokeWidth={2.2} /> },
  weekend: { label: 'presetWeekend', icon: <Coffee size={15} strokeWidth={2.2} /> },
  days3: { label: 'presetDays3', icon: <Hourglass size={15} strokeWidth={2.2} /> },
  nextWeek: { label: 'presetNextWeek', icon: <CalendarDays size={15} strokeWidth={2.2} /> }
}

/** `datetime-local` speaks local time without a zone: "2026-10-02T09:00". */
const toLocalInput = (t: number): string => {
  const d = new Date(t)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const tomorrowNine = (): number => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9).getTime()
}

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
 * When to bring a chat back, or when to remind you if they have not answered: a few times people actually say
 * ("this evening", "next week"), each with the exact time beside it, then any date and time. Opens where it was
 * asked for (a context menu, the chat header, ⌘⇧H), works from the keyboard (arrows, Enter, Esc) and keeps
 * itself on screen.
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
  const [value, setValue] = useState(() => toLocalInput(tomorrowNine()))
  const [error, setError] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>()
  const ref = useRef<HTMLDivElement>(null)
  const presets = useMemo(() => laterPresets(mode), [mode])
  const now = Date.now()
  const active = mode === 'snooze' ? (isSnoozed(snoozedEntry, now) ? snoozedEntry : undefined) : followState(followEntry, now) === 'waiting' ? followEntry : undefined

  // On screen whatever the anchor: flip left or up when it would spill over an edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const x = picker.x ?? (window.innerWidth - width) / 2
    const y = picker.y ?? (window.innerHeight - height) / 2
    const left = Math.max(8, Math.min(picker.align === 'end' ? x - width : x, window.innerWidth - width - 8))
    const top = Math.max(8, Math.min(y, window.innerHeight - height - 8))
    setPos({ left, top })
  }, [picker.x, picker.y, picker.align, mode, custom, error])

  // Focus the first time on open, so the keyboard can pick right away; give focus back on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => before?.focus?.()
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

  const submitCustom = (): void => {
    const until = new Date(value).getTime()
    if (!Number.isFinite(until) || until <= Date.now() + 60_000) {
      setError(true)
      return
    }
    pick(until)
  }

  // Up and down walk the items (wrapping), Home and End jump.
  const onMenuKey = (e: React.KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next].focus()
  }

  if (!conversation) return null
  return createPortal(
    <div
      ref={ref}
      className="context-menu later-picker"
      role="dialog"
      aria-label={mode === 'snooze' ? t('laterTabSnooze') : t('laterTabFollow')}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="segmented later-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'snooze'} className={mode === 'snooze' ? 'active' : ''} onClick={() => setMode('snooze')}>
          {t('laterTabSnooze')}
        </button>
        <button role="tab" aria-selected={mode === 'follow'} className={mode === 'follow' ? 'active' : ''} onClick={() => setMode('follow')}>
          {t('laterTabFollow')}
        </button>
      </div>
      <p className="later-hint">{mode === 'snooze' ? t('laterSnoozeHint', { name: conversation.title }) : t('laterFollowHint', { name: conversation.title })}</p>
      <div role="menu" aria-orientation="vertical" onKeyDown={onMenuKey}>
        {presets.map((p) => (
          <button key={p.id} role="menuitem" className="context-menu-item later-item" onClick={() => pick(p.until)}>
            <span className="later-icon">{PRESET[p.id].icon}</span>
            <span>{t(PRESET[p.id].label)}</span>
            <span className="context-menu-shortcut later-when">{formatLaterTime(p.until, language)}</span>
          </button>
        ))}
        <button role="menuitem" className="context-menu-item later-item" aria-expanded={custom} onClick={() => setCustom((c) => !c)}>
          <span className="later-icon">
            <CalendarClock size={15} strokeWidth={2.2} />
          </span>
          <span>{t('presetCustom')}</span>
        </button>
        {custom && (
          <form
            className="later-custom"
            // Moshi says what is wrong itself, in the app's language, next to the field.
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              submitCustom()
            }}
          >
            <input
              type="datetime-local"
              className="later-input"
              value={value}
              min={toLocalInput(Date.now() + 60_000)}
              aria-label={t('presetCustom')}
              aria-invalid={error}
              aria-describedby={error ? 'later-error' : undefined}
              onChange={(e) => {
                setValue(e.target.value)
                setError(false)
              }}
              autoFocus
            />
            <button type="submit" className="btn small primary">
              {t('laterSet')}
            </button>
            {error && (
              <span id="later-error" className="later-error" role="alert">
                {t('laterPast')}
              </span>
            )}
          </form>
        )}
        {active && (
          <>
            <div className="later-sep" />
            <button
              role="menuitem"
              className="context-menu-item later-item later-clear"
              onClick={() => {
                close()
                void (mode === 'snooze' ? unsnooze(picker.conversationId) : cancelFollowUp(picker.conversationId))
              }}
            >
              <span className="later-icon">{mode === 'snooze' ? <AlarmClockOff size={15} strokeWidth={2.2} /> : <X size={15} strokeWidth={2.2} />}</span>
              <span>{mode === 'snooze' ? t('unsnoozeAction') : t('unfollowAction')}</span>
              <span className="context-menu-shortcut later-when">{formatLaterTime(active.until, language)}</span>
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
