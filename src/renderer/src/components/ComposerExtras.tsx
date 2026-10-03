import { useEffect, useRef, useState } from 'react'
import { AlarmClock, CalendarClock, Moon, Settings2, Sun, Sunrise, Zap } from 'lucide-react'
import type { QuickReply } from '@shared/types'
import { defaultQuickReplies, fold } from '@shared/extras'
import { useStore, useT } from '../store'
import { formatTime } from '../utils'
import { useKeepInside } from '../popover'

/** The user's quick replies, or the starter set until they edit them. */
export function useQuickReplies(): QuickReply[] {
  const saved = useStore((s) => s.settings.quickReplies)
  const language = useStore((s) => s.settings.language)
  return saved ?? defaultQuickReplies(language)
}

/** Replies matching what follows the "/" (shortcut first, then words in the text). */
export function matchQuickReplies(replies: QuickReply[], query: string): QuickReply[] {
  const q = fold(query.trim())
  if (!q) return replies.slice(0, 8)
  const byShortcut = replies.filter((r) => fold(r.shortcut).startsWith(q))
  const byText = replies.filter((r) => !byShortcut.includes(r) && fold(r.text).includes(q))
  return [...byShortcut, ...byText].slice(0, 8)
}

/** Popover above the composer while typing "/…". Keyboard is handled by the composer. */
export function QuickReplyMenu({ items, active, onPick, onHover }: { items: QuickReply[]; active: number; onPick(r: QuickReply): void; onHover(i: number): void }): JSX.Element {
  const t = useT()
  const openSheet = useStore((s) => s.openSheet)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <div className="quick-menu" role="listbox" aria-label={t('quickReplies')} onMouseDown={(e) => e.preventDefault()}>
      <div className="quick-menu-head">
        <Zap size={13} strokeWidth={2.4} />
        {t('quickReplies')}
        <button className="quick-menu-manage" onClick={() => openSheet({ kind: 'settings', page: 'chat' })} title={t('quickReplyManage')}>
          <Settings2 size={13} strokeWidth={2.4} />
        </button>
      </div>
      <div className="quick-menu-list scroll" ref={list}>
        {items.length === 0 && <div className="quick-menu-empty">{t('quickReplyEmpty')}</div>}
        {items.map((r, i) => (
          <button
            key={r.id}
            data-index={i}
            role="option"
            aria-selected={i === active}
            className={`quick-menu-item ${i === active ? 'active' : ''}`}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(r)}
          >
            <span className="quick-menu-shortcut">/{r.shortcut}</span>
            <span className="quick-menu-text">{r.text}</span>
          </button>
        ))}
      </div>
      <div className="quick-menu-foot">{t('quickReplyKeys')}</div>
    </div>
  )
}

const at = (days: number, hour: number, minute = 0): number => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

/** Pick when a message goes out: quick choices plus any date and time. */
/** Pick a time: for sending later (default) or, with `title`/`noneLabel`, for a to-do reminder (which may have none). */
export function SchedulePicker({
  onPick,
  onClose,
  title,
  noneLabel,
  onNone
}: {
  onPick(sendAt: number): void
  onClose(): void
  title?: string
  noneLabel?: string
  onNone?(): void
}): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const ref = useRef<HTMLDivElement>(null)
  useKeepInside(ref)
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const inHour = new Date(Date.now() + 60 * 60 * 1000)
  const [custom, setCustom] = useState(`${inHour.getFullYear()}-${pad(inHour.getMonth() + 1)}-${pad(inHour.getDate())}T${pad(inHour.getHours())}:${pad(inHour.getMinutes())}`)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Escape closes only the picker: caught first and stopped, so the sheet or chat under it stays open
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const tonight = now.getHours() < 20 ? at(0, 20) : undefined
  const options: Array<{ icon: JSX.Element; label: string; time: number }> = [
    { icon: <AlarmClock size={16} strokeWidth={2.2} />, label: t('scheduleIn1h'), time: Date.now() + 60 * 60 * 1000 },
    ...(tonight ? [{ icon: <Moon size={16} strokeWidth={2.2} />, label: t('scheduleTonight'), time: tonight }] : []),
    { icon: <Sunrise size={16} strokeWidth={2.2} />, label: t('scheduleTomorrowMorning'), time: at(1, 8) },
    { icon: <Sun size={16} strokeWidth={2.2} />, label: t('scheduleTomorrowAfternoon'), time: at(1, 13) }
  ]
  const customTime = new Date(custom).getTime()
  const customValid = Number.isFinite(customTime) && customTime > Date.now() + 30_000

  return (
    <div className="schedule-picker" ref={ref} role="dialog" aria-label={t('scheduleSend')}>
      <div className="schedule-title">
        <CalendarClock size={15} strokeWidth={2.3} />
        {title ?? t('scheduleSend')}
      </div>
      {noneLabel && onNone && (
        <button className="schedule-option" onClick={onNone}>
          <span className="schedule-option-icon">
            <CalendarClock size={16} strokeWidth={2.2} />
          </span>
          <span className="schedule-option-label">{noneLabel}</span>
        </button>
      )}
      {options.map((o) => (
        <button key={o.label} className="schedule-option" onClick={() => onPick(o.time)}>
          <span className="schedule-option-icon">{o.icon}</span>
          <span className="schedule-option-label">{o.label}</span>
          <span className="schedule-option-time">{formatTime(o.time, language)}</span>
        </button>
      ))}
      <div className="schedule-custom">
        <input className="field-input" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn primary" disabled={!customValid} onClick={() => onPick(customTime)}>
          {t('scheduleConfirm')}
        </button>
      </div>
      {!title && <div className="schedule-note">{t('scheduledNote')}</div>}
    </div>
  )
}
