import { describe, expect, it } from 'vitest'
import { mergePresence, presenceView, type PresenceEntry } from '../src/renderer/src/usePresence'

// No DOM test environment here (node only, no testing-library), so the hooks are covered through the pure
// pieces they are built from.
describe('presenceView', () => {
  it('is mounted and open while open', () => {
    expect(presenceView(true, true)).toEqual({ mounted: true, state: 'open' })
    expect(presenceView(true, false)).toEqual({ mounted: true, state: 'open' })
  })

  it('stays mounted as closing until the hold ends', () => {
    expect(presenceView(false, true)).toEqual({ mounted: true, state: 'closing' })
    expect(presenceView(false, false)).toEqual({ mounted: false, state: 'closing' })
  })
})

describe('mergePresence', () => {
  const key = (n: number): number => n
  const entry = (item: number, closing = false): PresenceEntry<number> => ({ item, closing })

  it('returns the same array when nothing changed', () => {
    const prev = [entry(1), entry(2)]
    expect(mergePresence(prev, [1, 2], key)).toBe(prev)
  })

  it('appends new items', () => {
    expect(mergePresence([entry(1)], [1, 2], key)).toEqual([entry(1), entry(2)])
  })

  it('keeps a removed item in its place, marked closing', () => {
    expect(mergePresence([entry(1), entry(2)], [2], key)).toEqual([entry(1, true), entry(2)])
  })

  it('does not reorder around a closing item when another arrives', () => {
    const closing = mergePresence([entry(1), entry(2)], [2], key)
    expect(mergePresence(closing, [2, 3], key)).toEqual([entry(1, true), entry(2), entry(3)])
  })

  it('revives an item that comes back while it is closing', () => {
    const closing = mergePresence([entry(1)], [], key)
    expect(mergePresence(closing, [1], key)).toEqual([entry(1)])
  })

  it('takes the newest object for an item that stays', () => {
    const a = { id: 1, text: 'a' }
    const b = { id: 1, text: 'b' }
    const merged = mergePresence([{ item: a, closing: false }], [b], (x) => x.id)
    expect(merged[0].item).toBe(b)
  })
})
