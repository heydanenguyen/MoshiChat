import { beforeEach, describe, expect, it, vi } from 'vitest'

// withViewTransition needs only a few bits of the page: stub them.
const root = { dataset: {} as Record<string, string> }
let callback: (() => void) | undefined
let finish: () => void = () => undefined
const startViewTransition = vi.fn((cb: () => void) => {
  callback = cb
  return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished: new Promise<void>((resolve) => (finish = resolve)) }
})
const doc = { documentElement: root, hidden: false, startViewTransition }
vi.stubGlobal('document', doc)
vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
const { withViewTransition } = await import('../src/renderer/src/viewTransition')

beforeEach(() => {
  startViewTransition.mockClear()
  callback = undefined
  delete root.dataset.vt
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

  it('just runs the update without the API', () => {
    const update = vi.fn()
    ;(doc as { startViewTransition?: unknown }).startViewTransition = undefined
    withViewTransition('to-chat', update)
    expect(update).toHaveBeenCalledTimes(1)
    ;(doc as { startViewTransition?: unknown }).startViewTransition = startViewTransition
  })
})
