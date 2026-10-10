import { describe, expect, it } from 'vitest'
import { isQuietStyle, rowState, type RowInput } from '../src/renderer/src/rowState'

const base: RowInput = { unread: false, muted: false, isTyping: false, draft: undefined, selected: false, lastOutgoing: false, status: undefined, tagIds: [] }
const state = (patch: Partial<RowInput>): ReturnType<typeof rowState> => rowState({ ...base, ...patch })

describe('rowState', () => {
  it('shows the unread dot only for a chat that is unread and not muted', () => {
    expect(state({ unread: true }).dot).toBe(true)
    expect(state({ unread: true, muted: true }).dot).toBe(false)
    expect(state({ unread: false }).dot).toBe(false)
  })

  it('lets typing replace the preview, then a draft, then the last message', () => {
    expect(state({ isTyping: true, draft: 'hi' }).line).toBe('typing')
    expect(state({ draft: 'hi' }).line).toBe('draft')
    expect(state({}).line).toBe('message')
  })

  it('shows no draft on the chat that is open (the composer has it)', () => {
    expect(state({ draft: 'hi', selected: true }).line).toBe('message')
  })

  it('draws a receipt only on my own last message: one check sent, two read', () => {
    expect(state({ lastOutgoing: true }).receipt).toBe('sent')
    expect(state({ lastOutgoing: true, status: 'delivered' }).receipt).toBe('sent')
    expect(state({ lastOutgoing: true, status: 'read' }).receipt).toBe('read')
    expect(state({ lastOutgoing: false, status: 'read' }).receipt).toBeUndefined()
  })

  it('has no receipt while sending or after a failure, nor under a typing or draft line', () => {
    expect(state({ lastOutgoing: true, status: 'sending' }).receipt).toBeUndefined()
    expect(state({ lastOutgoing: true, status: 'failed' }).receipt).toBeUndefined()
    expect(state({ lastOutgoing: true, isTyping: true }).receipt).toBeUndefined()
    expect(state({ lastOutgoing: true, draft: 'hi' }).receipt).toBeUndefined()
  })

  it('marks close friends by the love, family and best-friend tags', () => {
    expect(state({ tagIds: ['family'] }).close).toBe(true)
    expect(state({ tagIds: ['work', 'love'] }).close).toBe(true)
    expect(state({ tagIds: ['friend'] }).close).toBe(true)
    expect(state({ tagIds: ['work', 'vip'] }).close).toBe(false)
    expect(state({}).close).toBe(false)
  })

  it('keeps one tag chip in the row and counts the rest', () => {
    expect(state({ tagIds: [] })).toMatchObject({ chip: undefined, hiddenTags: 0 })
    expect(state({ tagIds: ['work'] })).toMatchObject({ chip: 'work', hiddenTags: 0 })
    expect(state({ tagIds: ['work', 'vip', 'fun'] })).toMatchObject({ chip: 'work', hiddenTags: 2 })
  })
})

describe('isQuietStyle', () => {
  it('is the Moshi look: no style picked, or "moshi"', () => {
    expect(isQuietStyle(undefined)).toBe(true)
    expect(isQuietStyle('moshi')).toBe(true)
  })

  it('leaves Liquid, Mono and Pals with their own rows', () => {
    for (const style of ['liquid', 'mono', 'pals']) expect(isQuietStyle(style)).toBe(false)
  })
})
