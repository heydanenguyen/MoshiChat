import { useState } from 'react'
import { AlarmClock, Check, ListTodo, MessageSquare, Plus, Trash2, X } from 'lucide-react'
import type { Message } from '@shared/types'
import { TODO_GROUPS, groupTodos, type Todo, type TodoGroup } from '@shared/todos'
import { useStore, useT } from '../store'
import { formatListTime } from '../utils'
import { Avatar } from './Avatar'
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
export function TodoButton({ message }: { message: Message }): JSX.Element {
  const t = useT()
  const addTodo = useStore((s) => s.addTodo)
  const language = useStore((s) => s.settings.language)
  const already = useStore((s) => !!s.settings.todos?.some((x) => x.messageId === message.id && x.conversationId === message.conversationId && !x.done))
  const [open, setOpen] = useState(false)
  const text = message.text.trim() || message.attachments.map((a) => (language === 'vi' ? `[${a.kind}]` : `[${a.kind}]`)).join(' ')
  const add = (due?: number): void => {
    setOpen(false)
    void addTodo({ conversationId: message.conversationId, messageId: message.id, text: text.slice(0, 200), due })
  }
  return (
    <>
      <button className={`icon-btn ${already ? 'active' : ''}`} title={t('todoFromMessage')} onClick={() => setOpen((o) => !o)} aria-pressed={already}>
        <ListTodo size={15} strokeWidth={2} />
      </button>
      {open && (
        <span className="todo-picker-anchor">
          <SchedulePicker onPick={add} onClose={() => setOpen(false)} title={t('todoWhen')} noneLabel={t('todoNoDue')} onNone={() => add(undefined)} />
        </span>
      )}
    </>
  )
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
  const select = useStore((s) => s.select)
  const jumpTo = useStore((s) => s.jumpTo)
  const [draft, setDraft] = useState('')
  const [picking, setPicking] = useState<string | 'new' | undefined>()
  const [showDone, setShowDone] = useState(false)
  const groups = groupTodos(todos)
  const openCount = todos.length - groups.done.length

  const submit = (due?: number): void => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setPicking(undefined)
    void addTodo({ text: text.slice(0, 200), due })
  }
  const openMessage = (todo: Todo): void => {
    if (!todo.conversationId) return
    closeSheet()
    select(todo.conversationId)
    if (todo.messageId) setTimeout(() => void jumpTo(todo.messageId!), 350)
  }

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
          <div className="todo-add">
            <Plus size={16} strokeWidth={2.4} />
            <input
              className="todo-add-input"
              placeholder={t('todoAddPlaceholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            <span className="todo-add-when">
              <button className="icon-btn small" title={t('todoSetDue')} disabled={!draft.trim()} onClick={() => setPicking(picking === 'new' ? undefined : 'new')}>
                <AlarmClock size={15} strokeWidth={2.2} />
              </button>
              {picking === 'new' && (
                <span className="todo-picker-anchor below">
                  <SchedulePicker onPick={submit} onClose={() => setPicking(undefined)} title={t('todoWhen')} noneLabel={t('todoNoDue')} onNone={() => submit(undefined)} />
                </span>
              )}
            </span>
          </div>
          {todos.length === 0 && <div className="details-empty">{t('todoEmpty')}</div>}
          {TODO_GROUPS.map((group) => {
            const list = groups[group]
            if (!list.length) return null
            if (group === 'done' && !showDone) {
              return (
                <button key={group} className="todo-group-toggle" onClick={() => setShowDone(true)}>
                  {t('todoDone')} · {list.length}
                </button>
              )
            }
            return (
              <div key={group} className={`todo-group ${group}`}>
                <div className="todo-group-title">
                  {t(GROUP_KEY[group])}
                  {group === 'done' && (
                    <button className="link-btn" onClick={() => setShowDone(false)}>
                      {t('todoCollapse')}
                    </button>
                  )}
                </div>
                {list.map((todo) => {
                  const conversation = todo.conversationId ? conversations[todo.conversationId] : undefined
                  return (
                    <div key={todo.id} className={`todo-row ${todo.done ? 'done' : ''}`}>
                      <button className={`todo-check ${todo.done ? 'on' : ''}`} onClick={() => void updateTodo(todo.id, { done: !todo.done })} aria-label={t('todoDone')}>
                        <Check size={13} strokeWidth={3} />
                      </button>
                      <div className="todo-text">
                        <div className="todo-title">{todo.text}</div>
                        <div className="todo-meta">
                          {conversation && (
                            <button className="todo-chat" onClick={() => openMessage(todo)} title={t('todoOpenChat')}>
                              <Avatar name={conversation.title} url={conversation.avatarUrl} size={16} />
                              {conversation.title}
                            </button>
                          )}
                          {todo.due !== undefined && (
                            <span className={`todo-due ${!todo.done && todo.due < Date.now() ? 'late' : ''}`}>
                              <AlarmClock size={11} strokeWidth={2.4} /> {formatListTime(todo.due, language)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="todo-actions">
                        {todo.conversationId && (
                          <button className="icon-btn small" title={t('todoOpenChat')} onClick={() => openMessage(todo)}>
                            <MessageSquare size={14} strokeWidth={2.2} />
                          </button>
                        )}
                        <span className="todo-add-when">
                          <button className="icon-btn small" title={t('todoSetDue')} onClick={() => setPicking(picking === todo.id ? undefined : todo.id)}>
                            <AlarmClock size={14} strokeWidth={2.2} />
                          </button>
                          {picking === todo.id && (
                            <span className="todo-picker-anchor">
                              <SchedulePicker
                                onPick={(due) => {
                                  setPicking(undefined)
                                  void updateTodo(todo.id, { due })
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
