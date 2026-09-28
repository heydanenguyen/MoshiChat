import { describe, expect, it } from 'vitest'
import { dueReminders, groupTodos, type Todo } from '../src/shared/todos'

const now = new Date(2026, 8, 29, 10, 0).getTime()
const h = 60 * 60 * 1000
const todo = (id: string, over: Partial<Todo> = {}): Todo => ({ id, text: id, createdAt: now - h, ...over })

describe('groupTodos', () => {
  it('sorts open to-dos into overdue, today, upcoming and someday, done last', () => {
    const g = groupTodos(
      [
        todo('later-today', { due: now + 5 * h }),
        todo('overdue-old', { due: now - 30 * h }),
        todo('done-1', { done: true, doneAt: now - h }),
        todo('someday-new', { createdAt: now }),
        todo('tomorrow', { due: now + 26 * h }),
        todo('overdue-new', { due: now - h }),
        todo('soon-today', { due: now + h }),
        todo('someday-old'),
        todo('done-2', { done: true, doneAt: now - 2 * h })
      ],
      now
    )
    expect(g.overdue.map((t) => t.id)).toEqual(['overdue-old', 'overdue-new'])
    expect(g.today.map((t) => t.id)).toEqual(['soon-today', 'later-today'])
    expect(g.upcoming.map((t) => t.id)).toEqual(['tomorrow'])
    expect(g.someday.map((t) => t.id)).toEqual(['someday-new', 'someday-old'])
    expect(g.done.map((t) => t.id)).toEqual(['done-1', 'done-2'])
  })
})

describe('dueReminders', () => {
  it('fires once, only for open to-dos whose time has come', () => {
    const list = [todo('due', { due: now - 1 }), todo('shown', { due: now - 1, remindedAt: now - 1 }), todo('done', { due: now - 1, done: true }), todo('future', { due: now + 1 }), todo('none')]
    expect(dueReminders(list, now).map((t) => t.id)).toEqual(['due'])
  })
})
