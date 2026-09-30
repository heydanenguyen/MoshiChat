import { useCallback, useEffect, useRef, useState } from 'react'
import { AlarmClock, CalendarClock, Check, ChevronDown, ChevronRight, ListTodo, MessageSquare, Moon, Plus, Sunrise, Trash2, X } from 'lucide-react'
import type { Message } from '@shared/types'
import { TODO_GROUPS, dueInfo, groupTodos, quickTimes, type Todo, type TodoGroup } from '@shared/todos'
import { useStore, useT } from '../store'
import { formatListTime, formatTime, tip } from '../utils'
import { Avatar } from './Avatar'
import { LogoMark } from './Logo'
import { SchedulePicker } from './ComposerExtras'

const NO_TODOS: Todo[] = []
const GROUP_KEY: Record<TodoGroup, 'todoOverdue' | 'todoToday' | 'todoUpcoming' | 'todoSomeday' | 'todoDone'> = {
  overdue: 'todoOverdue',
  today: 'todoToday',
  upcoming: 'todoUpcoming',
  someday: 'todoSomeday',
  done: 'todoDone'
}

/** Sidebar counter: open to-dos, so the nav item can show a badge. */
export function useOpenTodos(): number {
  return useStore((s) => (s.settings.todos ?? NO_TODOS).filter((t) => !t.done).length)
}

/** In the bubble's action bar: turn this message into a to-do, with or without a reminder. */
export function TodoButton({ message, onOpenChange }: { message: Message; onOpenChange?(open: boolean): void }): JSX.Element {
  const t = useT()
  const addTodo = useStore((s) => s.addTodo)
  const already = useStore((s) => !!s.settings.todos?.some((x) => x.messageId === message.id && x.conversationId === message.conversationId && !x.done))
  const [open, setOpenState] = useState(false)
  const setOpen = (next: boolean): void => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  const text = message.text.trim() || message.attachments.map((a) => `[${a.kind}]`).join(' ')
  const add = (due?: number): void => {
    setOpen(false)
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
    <>
      <button className={`icon-btn ${already || open ? 'active' : ''}`} {...tip(t('todoFromMessage'))} onClick={() => setOpen(!open)} aria-pressed={already}>
        <ListTodo size={15} strokeWidth={2} />
      </button>
      {open && (
        <span className="todo-picker-anchor" ref={place}>
          <SchedulePicker onPick={add} onClose={() => setOpen(false)} title={t('todoWhen')} noneLabel={t('todoNoDue')} onNone={() => add(undefined)} />
        </span>
      )}
    </>
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

/** The to-do list: what came due, today, later, undated, then what is done. */
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
  const select = useStore((s) => s.select)
  const jumpTo = useStore((s) => s.jumpTo)
  const dueLabel = useDueLabel()
  const [draft, setDraft] = useState('')
  const [picking, setPicking] = useState<string | 'new' | undefined>()
  const [editing, setEditing] = useState<{ id: string; text: string } | undefined>()
  const [showDone, setShowDone] = useState(false)
  const addInput = useRef<HTMLInputElement>(null)
  const groups = groupTodos(todos)
  const openCount = todos.length - groups.done.length
  const quick = quickTimes()

  useEffect(() => {
    addInput.current?.focus()
  }, [])

  const submit = (due?: number): void => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setPicking(undefined)
    void addTodo({ text: text.slice(0, 200), due })
    addInput.current?.focus()
  }
  const openMessage = (todo: Todo): void => {
    if (!todo.conversationId) return
    closeSheet()
    select(todo.conversationId)
    if (todo.messageId) setTimeout(() => void jumpTo(todo.messageId!), 350)
  }
  const commitEdit = (): void => {
    if (!editing) return
    const text = editing.text.trim().slice(0, 200)
    const current = todos.find((x) => x.id === editing.id)
    if (text && current && text !== current.text) void updateTodo(editing.id, { text })
    setEditing(undefined)
  }
  const clearDone = (): void => {
    void setSettings({ todos: todos.filter((x) => !x.done) })
    setShowDone(false)
  }

  const quickChips = (onPick: (due: number) => void, extra?: JSX.Element): JSX.Element => (
    <div className="todo-quick">
      {quick.tonight && (
        <button className="todo-chip action" onClick={() => onPick(quick.tonight!)}>
          <Moon size={12} strokeWidth={2.4} /> {t('todoTonight', { time: formatTime(quick.tonight, language) })}
        </button>
      )}
      <button className="todo-chip action" onClick={() => onPick(quick.tomorrow)}>
        <Sunrise size={12} strokeWidth={2.4} /> {t('todoTomorrow', { time: formatTime(quick.tomorrow, language) })}
      </button>
      {extra}
    </div>
  )

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet todo-sheet" role="dialog" aria-label={t('todos')}>
        <div className="sheet-header">
          <div className="sheet-title">
            {t('todos')}
            {openCount > 0 && <span className="todo-count">{openCount}</span>}
          </div>
          <button className="icon-btn" onClick={closeSheet} title={t('close')}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="sheet-body scroll">
          <div className={`todo-add ${draft.trim() ? 'typing' : ''}`}>
            <div className="todo-add-row">
              <Plus size={16} strokeWidth={2.4} />
              <input
                ref={addInput}
                className="todo-add-input"
                placeholder={t('todoAddPlaceholder')}
                value={draft}
                maxLength={200}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                  if (e.key === 'Escape') setDraft('')
                }}
              />
              {draft.trim() && (
                <button className="todo-add-go" onClick={() => submit()} title={t('todoEnterHint')}>
                  <Check size={15} strokeWidth={2.8} />
                </button>
              )}
            </div>
            {draft.trim() &&
              quickChips(
                (due) => submit(due),
                <span className="todo-add-when">
                  <button className="todo-chip" onClick={() => setPicking(picking === 'new' ? undefined : 'new')}>
                    <CalendarClock size={12} strokeWidth={2.4} /> {t('todoPickTime')}
                  </button>
                  {picking === 'new' && (
                    <span className="todo-picker-anchor below">
                      <SchedulePicker onPick={submit} onClose={() => setPicking(undefined)} title={t('todoWhen')} noneLabel={t('todoNoDue')} onNone={() => submit(undefined)} />
                    </span>
                  )}
                  <span className="todo-add-hint">{t('todoEnterHint')}</span>
                </span>
              )}
          </div>

          {todos.length === 0 && (
            <div className="todo-empty">
              <LogoMark size={72} mood="calm" title="" />
              <div className="todo-empty-title">{t('todoEmptyTitle')}</div>
              <div className="todo-empty-hint">{t('todoEmpty')}</div>
            </div>
          )}

          {TODO_GROUPS.map((group) => {
            const list = groups[group]
            if (!list.length) return null
            if (group === 'done') {
              return (
                <div key={group} className="todo-group done">
                  <button className="todo-done-toggle" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                    {showDone ? <ChevronDown size={14} strokeWidth={2.6} /> : <ChevronRight size={14} strokeWidth={2.6} />}
                    {t('todoDone')} · {list.length}
                  </button>
                  {showDone && (
                    <>
                      {list.map((todo) => (
                        <div key={todo.id} className="todo-row done">
                          <button className="todo-check on" onClick={() => void updateTodo(todo.id, { done: false })} aria-label={t('todoDone')}>
                            <Check size={13} strokeWidth={3} />
                          </button>
                          <div className="todo-text">
                            <div className="todo-title">{todo.text}</div>
                          </div>
                          <div className="todo-actions">
                            <button className="icon-btn small danger" title={t('todoDelete')} onClick={() => void removeTodo(todo.id)}>
                              <Trash2 size={14} strokeWidth={2.2} />
                            </button>
                          </div>
                        </div>
                      ))}
                      <button className="link-btn todo-clear" onClick={clearDone}>
                        {t('todoClearDone')}
                      </button>
                    </>
                  )}
                </div>
              )
            }
            return (
              <div key={group} className={`todo-group ${group}`}>
                <div className="todo-group-title">
                  <span>
                    {t(GROUP_KEY[group])} <span className="todo-group-count">{list.length}</span>
                  </span>
                </div>
                {list.map((todo) => {
                  const conversation = todo.conversationId ? conversations[todo.conversationId] : undefined
                  const due = todo.due !== undefined ? dueLabel(todo.due) : undefined
                  const isEditing = editing?.id === todo.id
                  return (
                    <div key={todo.id} className={`todo-row ${due?.tone ?? ''}`}>
                      <button className="todo-check" onClick={() => void updateTodo(todo.id, { done: true })} aria-label={t('todoDone')}>
                        <Check size={13} strokeWidth={3} />
                      </button>
                      <div className="todo-text">
                        {isEditing ? (
                          <input
                            className="todo-title-edit"
                            value={editing.text}
                            autoFocus
                            maxLength={200}
                            onChange={(e) => setEditing({ id: todo.id, text: e.target.value })}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditing(undefined)
                            }}
                          />
                        ) : (
                          <button className="todo-title" onClick={() => setEditing({ id: todo.id, text: todo.text })} title={t('todoEditHint')}>
                            {todo.text}
                          </button>
                        )}
                        <div className="todo-meta">
                          {conversation && (
                            <button className="todo-chip chat" onClick={() => openMessage(todo)} title={t('todoOpenChat')}>
                              <Avatar name={conversation.title} url={conversation.avatarUrl} size={16} />
                              {conversation.title}
                            </button>
                          )}
                          {due && (
                            <span className="todo-add-when">
                              <button className={`todo-chip due ${due.tone}`} onClick={() => setPicking(picking === todo.id ? undefined : todo.id)} title={t('todoSetDue')}>
                                <AlarmClock size={11} strokeWidth={2.6} /> {due.text}
                              </button>
                              {picking === todo.id && (
                                <span className="todo-picker-anchor below">
                                  <SchedulePicker
                                    onPick={(next) => {
                                      setPicking(undefined)
                                      void updateTodo(todo.id, { due: next })
                                    }}
                                    onClose={() => setPicking(undefined)}
                                    title={t('todoWhen')}
                                    noneLabel={t('todoNoDue')}
                                    onNone={() => {
                                      setPicking(undefined)
                                      void updateTodo(todo.id, { due: undefined })
                                    }}
                                  />
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        {due?.tone === 'late' && (
                          <div className="todo-snooze">
                            <span className="todo-snooze-label">{t('todoSnooze')}</span>
                            {quickChips((next) => void updateTodo(todo.id, { due: next }))}
                          </div>
                        )}
                      </div>
                      <div className="todo-actions">
                        {!due && (
                          <span className="todo-add-when">
                            <button className="icon-btn small" title={t('todoSetDue')} onClick={() => setPicking(picking === todo.id ? undefined : todo.id)}>
                              <AlarmClock size={14} strokeWidth={2.2} />
                            </button>
                            {picking === todo.id && (
                              <span className="todo-picker-anchor">
                                <SchedulePicker
                                  onPick={(next) => {
                                    setPicking(undefined)
                                    void updateTodo(todo.id, { due: next })
                                  }}
                                  onClose={() => setPicking(undefined)}
                                  title={t('todoWhen')}
                                  noneLabel={t('todoNoDue')}
                                  onNone={() => setPicking(undefined)}
                                />
                              </span>
                            )}
                          </span>
                        )}
                        {todo.conversationId && (
                          <button className="icon-btn small" title={t('todoOpenChat')} onClick={() => openMessage(todo)}>
                            <MessageSquare size={14} strokeWidth={2.2} />
                          </button>
                        )}
                        <button className="icon-btn small danger" title={t('todoDelete')} onClick={() => void removeTodo(todo.id)}>
                          <Trash2 size={14} strokeWidth={2.2} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
