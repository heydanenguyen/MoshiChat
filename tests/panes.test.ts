import { describe, expect, it } from 'vitest'
import { activate, activeId, closePane, isSplit, openBeside, openIn, prune, pushRecent, restoreLayout, single, suggestBeside, toggleSplit } from '../src/renderer/src/panes'

describe('split chat panes', () => {
  it('opens in the active pane and never shows one chat twice', () => {
    let layout = openIn(single(), 'a', 0)
    expect(layout).toEqual({ panes: ['a'], active: 0 })
    layout = openBeside(layout, 'b')
    expect(layout).toEqual({ panes: ['a', 'b'], active: 1 })
    // Selecting a chat that is already on the left just moves the focus there.
    expect(openIn(layout, 'a', 1)).toEqual({ panes: ['a', 'b'], active: 0 })
    expect(openBeside(layout, 'b')).toEqual({ panes: ['a', 'b'], active: 1 })
    // A third chat replaces the chat in the active pane.
    expect(openIn(layout, 'c', 1)).toEqual({ panes: ['a', 'c'], active: 1 })
    // "Open beside" from the right pane fills the left one.
    expect(openBeside(layout, 'c')).toEqual({ panes: ['c', 'b'], active: 0 })
  })

  it('splits with the previous chat and unsplits to the active one', () => {
    const layout = single('a')
    expect(toggleSplit(layout, 'b')).toEqual({ panes: ['a', 'b'], active: 1 })
    expect(toggleSplit(layout, 'a')).toEqual({ panes: ['a', undefined], active: 1 })
    expect(toggleSplit(layout)).toEqual({ panes: ['a', undefined], active: 1 })
    expect(toggleSplit({ panes: ['a', 'b'], active: 0 })).toEqual(single('a'))
    expect(toggleSplit({ panes: ['a', 'b'], active: 1 })).toEqual(single('b'))
  })

  it('closes a pane and keeps the other chat', () => {
    expect(closePane({ panes: ['a', 'b'], active: 1 }, 1)).toEqual(single('a'))
    expect(closePane({ panes: ['a', 'b'], active: 0 }, 0)).toEqual(single('b'))
    expect(closePane({ panes: ['a', undefined], active: 1 }, 1)).toEqual(single('a'))
    expect(closePane(single('a'), 0)).toEqual(single('a'))
  })

  it('activates only panes that exist', () => {
    expect(activate(single('a'), 1).active).toBe(0)
    expect(activate({ panes: ['a', 'b'], active: 0 }, 1).active).toBe(1)
    expect(activeId({ panes: ['a', 'b'], active: 1 })).toBe('b')
    expect(isSplit(single('a'))).toBe(false)
  })

  it('prunes chats that disappeared', () => {
    const exists = (id: string): boolean => id !== 'gone'
    expect(prune({ panes: ['a', 'gone'], active: 1 }, exists)).toEqual(single('a'))
    expect(prune({ panes: ['gone', 'b'], active: 0 }, exists)).toEqual(single('b'))
    expect(prune({ panes: ['gone', 'gone'], active: 0 }, exists)).toEqual(single())
    expect(prune(single('gone'), exists)).toEqual(single())
    const kept = { panes: ['a', 'b'], active: 1 as const }
    expect(prune(kept, exists)).toBe(kept)
  })

  it('suggests the last read chat that is not on screen', () => {
    const recent = pushRecent(pushRecent(pushRecent([], 'a'), 'b'), 'a')
    expect(recent).toEqual(['a', 'b'])
    expect(suggestBeside(single('a'), recent)).toBe('b')
    expect(suggestBeside({ panes: ['a', 'b'], active: 0 }, recent)).toBeUndefined()
  })

  it('restores a saved layout defensively', () => {
    const exists = (id: string): boolean => ['a', 'b'].includes(id)
    expect(restoreLayout({ panes: ['a', 'b'], active: 1 }, exists)).toEqual({ panes: ['a', 'b'], active: 1 })
    expect(restoreLayout({ panes: ['a', 'zzz'], active: 1 }, exists)).toEqual(single('a'))
    expect(restoreLayout({ panes: [1, 2, 3] }, exists)).toEqual(single())
    expect(restoreLayout(null, exists)).toEqual(single())
    expect(restoreLayout('garbage', exists)).toEqual(single())
  })
})
