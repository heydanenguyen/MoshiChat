import { beforeEach, describe, expect, it, vi } from 'vitest'

// withViewTransition needs only a few bits of the page: stub them.
const root = { dataset: {} as Record<string, string> }
let callback: (() => void) | undefined
let finish: () => void = () => undefined
const startViewTransition = vi.fn((cb: () => void) => {
  callback = cb
  return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished: new Promise<void>((resolve) => (finish = resolve)) }
})
let detailsOnScreen = false
let reduced = false
const doc = { documentElement: root, hidden: false, startViewTransition, querySelector: () => (detailsOnScreen ? {} : null) }
vi.stubGlobal('document', doc)
vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) })
const { withViewTransition } = await import('../src/renderer/src/viewTransition')

beforeEach(() => {
  startViewTransition.mockClear()
  callback = undefined
  delete root.dataset.vt
  delete root.dataset.vtDir
  detailsOnScreen = false
  reduced = false
})

describe('withViewTransition', () => {
  it('runs the update inside the transition callback, synchronously, and names the kind while it runs', async () => {
    const update = vi.fn()
    withViewTransition('details', update)
    expect(root.dataset.vt).toBe('details')
    expect(update).not.toHaveBeenCalled()
    callback!()
    expect(update).toHaveBeenCalledTimes(1)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(root.dataset.vt).toBeUndefined()
  })

  it('does not start a second transition while one is running; it just applies the update', async () => {
    withViewTransition('details', () => undefined)
    const second = vi.fn()
    withViewTransition('sidebar', second)
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    finish()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('tells the Details motion whether the pane is opening or closing', async () => {
    withViewTransition('details', () => undefined)
    expect(root.dataset.vtDir).toBe('open')
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(root.dataset.vtDir).toBeUndefined()
    detailsOnScreen = true
    withViewTransition('details', () => undefined)
    expect(root.dataset.vtDir).toBe('close')
    finish()
    await Promise.resolve()
    await Promise.resolve()
    // only the Details pane has a direction
    withViewTransition('sidebar', () => undefined)
    expect(root.dataset.vtDir).toBeUndefined()
    finish()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('under reduced motion only the Details pane still runs a (fading) transition', async () => {
    reduced = true
    const sidebar = vi.fn()
    withViewTransition('sidebar', sidebar)
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(sidebar).toHaveBeenCalledTimes(1)
    withViewTransition('details', () => undefined)
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    finish()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('just runs the update without the API', () => {
    const update = vi.fn()
    ;(doc as { startViewTransition?: unknown }).startViewTransition = undefined
    withViewTransition('to-chat', update)
    expect(update).toHaveBeenCalledTimes(1)
    ;(doc as { startViewTransition?: unknown }).startViewTransition = startViewTransition
  })
})
