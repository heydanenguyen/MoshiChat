import { useCallback, useEffect, useRef, useState } from 'react'
import { AlarmClock, CalendarClock, Check, ListTodo, Moon, Plus, Sunrise, Trash2, X } from 'lucide-react'
import type { Message } from '@shared/types'
import { dueInfo, parseDue, quickTimes, type Todo } from '@shared/todos'
import { useStore, useT } from '../store'
import { formatListTime, formatTime, tip } from '../utils'
import { Avatar } from './Avatar'
import { LogoMark } from './Logo'
import { SchedulePicker } from './ComposerExtras'
import { isComposingEnter } from '../imeGuard'

const NO_TODOS: Todo[] = []

/** Sidebar counter: open to-dos, so the nav item can show a badge. */
export function useOpenTodos(): number {
  return useStore((s) => (s.settings.todos ?? NO_TODOS).filter((t) => !t.done).length)
}

/** In the bubble's action bar: turn this message into a to-do, with or without a reminder. */
export function TodoButton({ message, onOpenChange }: { message: Message; onOpenChange?(open: boolean): void }): JSX.Element {
  const t = useT()
  const already = useStore((s) => !!s.settings.todos?.some((x) => x.messageId === message.id && x.conversationId === message.conversationId && !x.done))
  const [open, setOpenState] = useState(false)
  const setOpen = (next: boolean): void => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  return (
    <>
      <button className={`icon-btn ${already || open ? 'active' : ''}`} {...tip(t('todoFromMessage'))} onClick={() => setOpen(!open)} aria-pressed={already}>
        <ListTodo size={15} strokeWidth={2} />
      </button>
      {open && <TodoPicker message={message} onClose={() => setOpen(false)} />}
    </>
  )
}

/** "When?" for a to-do made from a message: a time, or none. Adds it and closes. */
export function TodoPicker({ message, onClose }: { message: Message; onClose(): void }): JSX.Element {
  const t = useT()
  const addTodo = useStore((s) => s.addTodo)
  const text = message.text.trim() || message.attachments.map((a) => `[${a.kind}]`).join(' ')
  const add = (due?: number): void => {
    onClose()
    void addTodo({ conversationId: message.conversationId, messageId: message.id, text: text.slice(0, 200), due })
  }
  // Keep the picker inside the chat: slide it sideways at the column's edges, open it below the
  // bar when the message is near the top (the bar itself floats beside the bubble).
  const place = useCallback((anchor: HTMLSpanElement | null) => {
    const sheet = anchor?.firstElementChild as HTMLElement | null
    const bounds = anchor?.closest('.chat-scroll')?.getBoundingClientRect()
    if (!anchor || !sheet || !bounds) return
    const animation = sheet.style.animation
    sheet.style.animation = 'none'
    const r = sheet.getBoundingClientRect()
    sheet.style.animation = animation
    if (r.top < bounds.top + 8 && r.bottom + r.height < bounds.bottom) anchor.classList.add('below')
    const dx = Math.min(0, bounds.right - 8 - r.right) || Math.max(0, bounds.left + 8 - r.left)
    if (dx) sheet.style.translate = `${dx}px 0`
  }, [])
  return (
    <span className="todo-picker-anchor" ref={place}>
      <SchedulePicker onPick={add} onClose={onClose} title={t('todoWhen')} noneLabel={t('todoNoDue')} onNone={() => add(undefined)} />
    </span>
  )
}

/** "Overdue 2 days", "Today 18:00", "Tomorrow 09:00", or the date; with a tone for colour. */
function useDueLabel(): (due: number) => { text: string; tone: string } {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  return (due) => {
    const info = dueInfo(due)
    const time = formatTime(due, language)
    switch (info.tone) {
      case 'late':
        return {
          tone: 'late',
          text: info.lateDays >= 1 ? t('todoLateDays', { n: String(info.lateDays) }) : info.lateMinutes >= 60 ? t('todoLateHours', { n: String(Math.floor(info.lateMinutes / 60)) }) : t('todoLateMinutes', { n: String(Math.max(1, info.lateMinutes)) })
        }
      case 'today':
        return { tone: 'today', text: t('todoDueToday', { time }) }
      case 'tomorrow':
        return { tone: 'tomorrow', text: t('todoDueTomorrow', { time }) }
      default:
        return { tone: 'later', text: `${formatListTime(due, language)} · ${time}` }
    }
  }
}

const DAY = 86_400_000
const startOfDay = (ts: number): number => new Date(ts).setHours(0, 0, 0, 0)
type View = number | 'someday'

/**
 * To-dos, built to be read in one look. A big title says where you are (Today, a day, or Unscheduled) with how much
 * is left; a strip of the week moves between days. On today, the next thing to do stands alone as a large card with
 * a big check; the rest is a plain list with times on the right, overdue first in amber. What is done folds into one
 * line. One place to add, at the bottom; a time written in ("mai 9h", "tối nay") is read out of it.
 */
export function TodoSheet(): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const todos = useStore((s) => s.settings.todos ?? NO_TODOS)
  const conversations = useStore((s) => s.conversations)
  const closeSheet = useStore((s) => s.closeSheet)
  const addTodo = useStore((s) => s.addTodo)
  const updateTodo = useStore((s) => s.updateTodo)
  const removeTodo = useStore((s) => s.removeTodo)
  const setSettings = useStore((s) => s.setSettings)
  const showToast = useStore((s) => s.showToast)
  const select = useStore((s) => s.select)
  const jumpTo = useStore((s) => s.jumpTo)
  const dueLabel = useDueLabel()
  const now = Date.now()
  const today = startOfDay(now)
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB'
  const quick = quickTimes(now)
  const [view, setView] = useState<View>(today)
  const [draft, setDraft] = useState('')
  const [skipParse, setSkipParse] = useState(false)
  const [picking, setPicking] = useState<{ id: string; style: React.CSSProperties } | undefined>()
  const [bumpDay, setBumpDay] = useState<number | undefined>()
  const justAdded = useRef(0)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | undefined>()
  const [completing, setCompleting] = useState<string[]>([])
  const [showDone, setShowDone] = useState(false)
  const addInput = useRef<HTMLInputElement>(null)

  const open = todos.filter((x) => !x.done)
  const byDue = (a: Todo, b: Todo): number => (a.due ?? 0) - (b.due ?? 0)
  /** Open to-dos for a day; today also carries everything overdue. */
  const openOn = (day: number): Todo[] =>
    open.filter((x) => x.due !== undefined && (day === today ? x.due < today + DAY : startOfDay(x.due) === day)).sort(byDue)
  const someday = open.filter((x) => x.due === undefined).sort((a, b) => b.createdAt - a.createdAt)
  const doneToday = todos.filter((x) => x.done && (x.doneAt ?? 0) >= today).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
  const week = Array.from({ length: 7 }, (_, i) => today + i * DAY)

  const list = view === 'someday' ? someday : openOn(view)
  const isToday = view === today
  const [next, ...rest] = isToday ? list : [undefined, ...list]
  const total = list.length + (isToday ? doneToday.length : 0)
  const progress = isToday && total ? doneToday.length / total : 0
  const parsed = skipParse ? { text: draft.trim() } : parseDue(draft, now)

  useEffect(() => {
    addInput.current?.focus()
  }, [])

  const submit = (due?: number): void => {
    const text = (due === undefined ? parsed.text : draft.trim()) || draft.trim()
    if (!text) return
    // nothing typed for the time: the day being looked at; today means "some time today" (kept as 23:59), another day 9:00
    const when = due ?? parsed.due ?? (view === 'someday' ? undefined : view === today ? today + DAY - 60_000 : view + 9 * 3_600_000)
    setDraft('')
    setSkipParse(false)
    setPicking(undefined)
    justAdded.current = Date.now()
    void addTodo({ text: text.slice(0, 200), due: when })
    const lands = when === undefined ? undefined : Math.max(startOfDay(when), today)
    if (lands !== undefined && lands !== view) {
      setBumpDay(lands)
      setTimeout(() => setBumpDay(undefined), 700)
    }
    if (when === undefined && view !== today) setView('someday')
    addInput.current?.focus()
  }
  const complete = (todo: Todo): void => {
    setCompleting((ids) => [...ids, todo.id])
    setTimeout(() => {
      void updateTodo(todo.id, { done: true })
      setCompleting((ids) => ids.filter((x) => x !== todo.id))
      showToast(t('todoCompleted'), 'info', { label: t('undo'), run: () => void updateTodo(todo.id, { done: false }) })
    }, 760)
  }
  const openMessage = (todo: Todo): void => {
    if (!todo.conversationId) return
    closeSheet()
    select(todo.conversationId)
    if (todo.messageId) setTimeout(() => void jumpTo(todo.messageId!, { from: todo.conversationId }), 350)
  }
  const commitEdit = (): void => {
    if (!editing) return
    const text = editing.text.trim().slice(0, 200)
    const current = todos.find((x) => x.id === editing.id)
    if (text && current && text !== current.text) void updateTodo(editing.id, { text })
    setEditing(undefined)
  }
  const pickerPop = picking ? (
    <div className="tz-pop" style={picking.style}>
      <SchedulePicker
        onPick={(nextDue) => (picking.id === 'new' ? submit(nextDue) : reschedule(picking.id, nextDue))}
        onClose={() => setPicking(undefined)}
        title={t('todoWhen')}
        noneLabel={t('todoNoDue')}
        onNone={() => (picking.id === 'new' ? submit(undefined) : reschedule(picking.id, undefined))}
      />
    </div>
  ) : null
  const reschedule = (id: string, due: number | undefined): void => {
    setPicking(undefined)
    void updateTodo(id, { due })
  }
  /** Opens the time picker next to the button, inside the sheet: above it when there is more room above. */
  const openPicker = (id: string, button: HTMLElement): void => {
    if (picking?.id === id) return setPicking(undefined)
    const sheet = sheetRef.current?.getBoundingClientRect()
    const at = button.getBoundingClientRect()
    if (!sheet) return
    const width = 296
    const left = Math.min(Math.max(12, at.left - sheet.left), sheet.width - width - 12)
    const up = at.top - sheet.top > sheet.bottom - at.bottom
    setPicking({ id, style: up ? { left, bottom: sheet.bottom - at.top + 8 } : { left, top: at.bottom - sheet.top + 8 } })
  }

  const textOf = (todo: Todo, cls: string): JSX.Element =>
    editing?.id === todo.id ? (
      <input
        className={`${cls} tz-edit`}
        value={editing.text}
        autoFocus
        maxLength={200}
        onChange={(e) => setEditing({ id: todo.id, text: e.target.value })}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (isComposingEnter(e)) return
          if (e.key === 'Enter') commitEdit()
          if (e.key === 'Escape') {
            // Only this edit, not the sheet behind it.
            e.preventDefault()
            setEditing(undefined)
          }
        }}
      />
    ) : (
      <button className={cls} onClick={() => !todo.done && setEditing({ id: todo.id, text: todo.text })} title={todo.done ? undefined : t('todoEditHint')}>
        {todo.text}
      </button>
    )
  const source = (todo: Todo): JSX.Element | null => {
    const c = todo.conversationId ? conversations[todo.conversationId] : undefined
    return c ? (
      <button className="tz-source" onClick={() => openMessage(todo)} title={t('todoOpenChat')}>
        <Avatar name={c.title} url={c.avatarUrl} size={18} />
        <span>{c.title}</span>
      </button>
    ) : null
  }
  /** "09:30", or "Overdue 2 days" in amber; the time is the button to change it. */
  const when = (todo: Todo): JSX.Element => {
    const late = todo.due !== undefined && todo.due < now
    const anytime = todo.due !== undefined && new Date(todo.due).getHours() === 23 && new Date(todo.due).getMinutes() === 59
    const label = todo.due === undefined ? t('todoSetDue') : late ? dueLabel(todo.due).text : anytime && startOfDay(todo.due) === (view === 'someday' ? -1 : view) ? t('todoAnytime') : view === today || startOfDay(todo.due) === view ? formatTime(todo.due, language) : dueLabel(todo.due).text
    return (
      <span className="todo-add-when">
        <button className={`tz-when ${late ? 'late' : ''} ${todo.due === undefined ? 'unset' : ''}`} onClick={(e) => openPicker(todo.id, e.currentTarget)} title={t('todoSetDue')}>
          {label}
        </button>
      </span>
    )
  }
  const check = (todo: Todo, big = false): JSX.Element => (
    <button
      className={`tz-check ${big ? 'big' : ''} ${todo.done || completing.includes(todo.id) ? 'on' : ''} ${completing.includes(todo.id) ? 'pop' : ''}`}
      onClick={() => (todo.done ? void updateTodo(todo.id, { done: false }) : complete(todo))}
      aria-label={todo.done ? t('todoReopen') : t('todoMarkDone')}
    >
      <Check size={big ? 22 : 13} strokeWidth={3} />
    </button>
  )
  const entering = (todo: Todo): boolean => todo.createdAt >= justAdded.current - 200 && Date.now() - todo.createdAt < 1500
  const row = (todo: Todo, index = 0): JSX.Element => (
    <li key={todo.id} style={{ ['--i' as string]: index } as React.CSSProperties} className={`tz-row ${todo.done ? 'done' : ''} ${completing.includes(todo.id) ? 'leaving' : ''} ${entering(todo) ? 'entering' : ''}`}>
      {check(todo)}
      <div className="tz-row-main">
        {textOf(todo, 'tz-row-text')}
        {source(todo)}
      </div>
      {!todo.done && when(todo)}
      <button className="icon-btn small tz-del" title={t('todoDelete')} onClick={() => void removeTodo(todo.id)}>
        <Trash2 size={13} strokeWidth={2.2} />
      </button>
    </li>
  )

  const title = view === 'someday' ? t('todoSomeday') : isToday ? t('todoToday') : view === today + DAY ? t('todoTomorrowDay') : new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'numeric' }).format(view)
  const subtitle = isToday
    ? list.length
      ? t('todoLeftDone', { left: String(list.length), done: String(doneToday.length) })
      : doneToday.length
        ? t('todoAllClear')
        : t('todoFreeDay')
    : list.length
      ? t('todoCountOnDay', { n: String(list.length) })
      : t('todoNothingHere')
  const nextLate = next?.due !== undefined && next.due < now

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet tz-sheet" role="dialog" aria-label={t('todos')} ref={sheetRef}>
        <header className="tz-head">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-btn tz-close" onClick={closeSheet} title={t('close')}>
            <X size={18} strokeWidth={2.4} />
          </button>
        </header>
        {isToday && total > 0 && (
          <div className="tz-bar" aria-hidden>
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        )}

        <nav className="tz-week" aria-label={t('todos')}>
          {week.map((day) => {
            const n = openOn(day).length
            const d = new Date(day)
            return (
              <button key={day} className={`tz-day ${view === day ? 'active' : ''} ${bumpDay === day ? 'bump' : ''}`} onClick={() => setView(day)} aria-pressed={view === day}>
                <span className="tz-day-name">{day === today ? t('todoTodayShort') : new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)}</span>
                <b>{d.getDate()}</b>
                <i className={n ? 'has' : ''} />
              </button>
            )
          })}
          <button className={`tz-day someday ${view === 'someday' ? 'active' : ''}`} onClick={() => setView('someday')} aria-pressed={view === 'someday'}>
            <span className="tz-day-name">{t('todoSomedayShort')}</span>
            <b>{someday.length}</b>
            <i />
          </button>
        </nav>

        <div className="tz-body scroll">
          {next && (
            <section key={next.id} className={`tz-next ${nextLate ? 'late' : ''} ${completing.includes(next.id) ? 'leaving' : ''} ${entering(next) ? 'entering' : ''}`}>
              <div className="tz-next-main">
                <span className="tz-next-label">{nextLate ? t('todoOverdue') : t('todoNext')}</span>
                {textOf(next, 'tz-next-text')}
                <div className="tz-next-meta">
                  {when(next)}
                  {source(next)}
                  {nextLate && (
                    <>
                      {quick.tonight && (
                        <button className="tz-snooze" onClick={() => reschedule(next.id, quick.tonight)}>
                          {t('todoTonightShort')}
                        </button>
                      )}
                      <button className="tz-snooze" onClick={() => reschedule(next.id, quick.tomorrow)}>
                        {t('todoTomorrowShort')}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {check(next, true)}
            </section>
          )}

          {rest.length > 0 && (
            <>
              {isToday && <h3 className="tz-section">{t('todoLater')}</h3>}
              <ul className="tz-list">{(rest as Todo[]).map(row)}</ul>
            </>
          )}

          {!list.length && (
            <div className="tz-empty">
              <LogoMark size={64} mood={isToday && doneToday.length ? 'happy' : 'calm'} title="" />
              <b>{isToday && doneToday.length ? t('todoAllClear') : t('todoNothingHere')}</b>
              <span>{todos.length ? t('todoAddBelow') : t('todoEmpty')}</span>
            </div>
          )}

          {isToday && doneToday.length > 0 && (
            <div className="tz-done">
              <button className="tz-done-toggle" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                <Check size={13} strokeWidth={3} />
                <span key={doneToday.length} className="tz-done-count">
                  {t('todoDoneTodayCount', { n: String(doneToday.length) })}
                </span>
                <span className="tz-done-more">{showDone ? t('todoCollapse') : t('todoShowAll')}</span>
              </button>
              {showDone && (
                <>
                  <ul className="tz-list">{doneToday.map(row)}</ul>
                  <button className="link-btn tz-clear" onClick={() => void setSettings({ todos: todos.filter((x) => !x.done) })}>
                    {t('todoClearDone')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {pickerPop}
        <footer className="tz-add composer">
          {draft.trim() && (
            <div className="tz-add-when">
              {parsed.due !== undefined ? (
                <span className="tz-found">
                  <AlarmClock size={13} strokeWidth={2.6} />
                  {parsed.due < now ? t('todoTimePassed', { when: formatTime(parsed.due, language) }) : t('todoWillRemind', { when: dueLabel(parsed.due).text })}
                  <button onClick={() => setSkipParse(true)} aria-label={t('todoNoDue')}>
                    <X size={12} strokeWidth={2.8} />
                  </button>
                </span>
              ) : (
                <>
                  {quick.tonight && (
                    <button className="tz-snooze" onClick={() => submit(quick.tonight)}>
                      <Moon size={12} strokeWidth={2.4} /> {t('todoTonight', { time: formatTime(quick.tonight, language) })}
                    </button>
                  )}
                  <button className="tz-snooze" onClick={() => submit(quick.tomorrow)}>
                    <Sunrise size={12} strokeWidth={2.4} /> {t('todoTomorrow', { time: formatTime(quick.tomorrow, language) })}
                  </button>
                  <span className="todo-add-when">
                    <button className="tz-snooze" onClick={(e) => openPicker('new', e.currentTarget)}>
                      <CalendarClock size={12} strokeWidth={2.4} /> {t('todoPickTime')}
                    </button>
                  </span>
                </>
              )}
            </div>
          )}
          <div className="composer-box tz-box">
            <input
              ref={addInput}
              placeholder={t('todoAddSmart')}
              value={draft}
              maxLength={200}
              onChange={(e) => {
                setDraft(e.target.value)
                if (!e.target.value) setSkipParse(false)
              }}
              onKeyDown={(e) => {
                if (isComposingEnter(e)) return
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape' && draft) {
                  // The first Escape clears the line, the next one closes the sheet.
                  e.preventDefault()
                  setDraft('')
                }
              }}
            />
            <button className="tz-add-go" onClick={() => submit()} disabled={!draft.trim()} aria-label={t('todoAddButton')}>
              <Plus size={20} strokeWidth={2.6} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
