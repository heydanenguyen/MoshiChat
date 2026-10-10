import { describe, expect, it } from 'vitest'
import { narrowChips, remainingUnread, toolbarStep } from '../src/renderer/src/narrowNav'

describe('narrowChips', () => {
  it('starts with All and its total, then one chip per app that has an account, in the sidebar order', () => {
    const chips = narrowChips([{ platform: 'zalo' }, { platform: 'messenger' }, { platform: 'zalo' }], { messenger: 2, zalo: 5, telegram: 1 })
    expect(chips.map((c) => c.id)).toEqual(['all', 'messenger', 'zalo'])
    expect(chips[0]).toEqual({ id: 'all', label: 'All', count: 8 })
    expect(chips.find((c) => c.id === 'zalo')).toMatchObject({ label: 'Zalo', count: 5 })
  })
  it('counts zero for an app nothing is waiting on, and uses the given label for All', () => {
    const chips = narrowChips([{ platform: 'slack' }], {}, 'Tất cả')
    expect(chips).toEqual([
      { id: 'all', label: 'Tất cả', count: 0 },
      { id: 'slack', label: 'Slack', count: 0 }
    ])
  })
  it('is just All when there is no account', () => {
    expect(narrowChips([], { zalo: 3 }).map((c) => c.id)).toEqual(['all'])
  })
})

describe('toolbarStep', () => {
  it('moves with the arrows and wraps at both ends', () => {
    expect(toolbarStep('ArrowRight', 0, 4)).toBe(1)
    expect(toolbarStep('ArrowRight', 3, 4)).toBe(0)
    expect(toolbarStep('ArrowLeft', 0, 4)).toBe(3)
    expect(toolbarStep('ArrowLeft', 2, 4)).toBe(1)
  })
  it('jumps with Home and End, and ignores other keys and an empty toolbar', () => {
    expect(toolbarStep('Home', 2, 4)).toBe(0)
    expect(toolbarStep('End', 1, 4)).toBe(3)
    expect(toolbarStep('a', 1, 4)).toBeUndefined()
    expect(toolbarStep('ArrowDown', 1, 4)).toBeUndefined()
    expect(toolbarStep('ArrowRight', 0, 0)).toBeUndefined()
  })
})

describe('remainingUnread', () => {
  it('takes the open chat out of the total', () => {
    expect(remainingUnread(12, 3)).toBe(9)
    expect(remainingUnread(12, 0)).toBe(12)
  })
  it('never goes below zero', () => {
    expect(remainingUnread(2, 5)).toBe(0)
    expect(remainingUnread(0, 0)).toBe(0)
  })
})
