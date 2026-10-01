import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types'
import { shareSettings } from '../src/shared/settings-share'

const base = (): Settings => ({ ...DEFAULT_SETTINGS, pins: { a: true }, tags: { a: ['work'] }, archived: { b: 1 } })

describe('settings from the main process', () => {
  it('keeps the old object for every key that did not change', () => {
    const before = base()
    // What IPC hands back: a fresh deep copy with one key changed.
    const incoming = { ...structuredClone(before), pins: { a: true, c: true } }
    const after = shareSettings(before, incoming)
    expect(after).not.toBe(before)
    expect(after.pins).toEqual({ a: true, c: true })
    expect(after.tags).toBe(before.tags)
    expect(after.archived).toBe(before.archived)
    expect(after.muted).toBe(before.muted)
  })

  it('returns the very same settings when nothing changed', () => {
    const before = base()
    expect(shareSettings(before, structuredClone(before))).toBe(before)
  })

  it('notices a key that was removed or added', () => {
    const before = { ...base(), followUps: { x: { until: 1 } } } as Settings
    const incoming = structuredClone(before) as Partial<Settings>
    delete incoming.followUps
    const after = shareSettings(before, incoming as Settings)
    expect(after).not.toBe(before)
    expect(after.followUps).toBeUndefined()
  })
})
