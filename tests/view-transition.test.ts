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
const animate = vi.fn()
;(root as Record<string, unknown>).animate = animate
vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => ' cubic-bezier(0.2, 0.8, 0.2, 1)' }))
vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }), innerWidth: 1000, innerHeight: 600 })
const { withViewTransition, revealRadius, revealClip, noteThemeOrigin, takeThemeOrigin, REVEAL_MS } = await import('../src/renderer/src/viewTransition')

beforeEach(() => {
  startViewTransition.mockClear()
  animate.mockClear()
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

  it('under reduced motion the sidebar runs no transition, the Details pane still runs a (fading) one', async () => {
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

describe('withViewTransition hooks', () => {
  it('runs before, then the update and after inside the transition, and done at the end', async () => {
    const log: string[] = []
    withViewTransition('chat', () => void log.push('update'), { before: () => log.push('before'), after: () => log.push('after'), done: () => log.push('done'), dir: 'fly' })
    expect(log).toEqual(['before'])
    expect(root.dataset.vt).toBe('chat')
    expect(root.dataset.vtDir).toBe('fly')
    callback!()
    expect(log).toEqual(['before', 'update', 'after'])
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(log).toEqual(['before', 'update', 'after', 'done'])
    expect(root.dataset.vtDir).toBeUndefined()
  })

  it('without a transition it just updates and still calls done (never before or after)', () => {
    ;(doc as { hidden: boolean }).hidden = true
    const log: string[] = []
    withViewTransition('chat', () => void log.push('update'), { before: () => log.push('before'), after: () => log.push('after'), done: () => log.push('done') })
    expect(log).toEqual(['update', 'done'])
    ;(doc as { hidden: boolean }).hidden = false
  })

  it('a chat opening and the theme still run under reduced motion (they only fade); the sidebar does not', async () => {
    reduced = true
    withViewTransition('chat', () => undefined)
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    withViewTransition('theme', () => undefined, { origin: { x: 10, y: 10 } })
    expect(startViewTransition).toHaveBeenCalledTimes(2)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    // no circle under reduced motion
    expect(animate).not.toHaveBeenCalled()
    withViewTransition('sidebar', () => undefined)
    expect(startViewTransition).toHaveBeenCalledTimes(2)
  })

  it('the theme opens a circle from the origin on the new root picture once the transition is ready', async () => {
    withViewTransition('theme', () => undefined, { origin: { x: 250, y: 100 } })
    expect(root.dataset.vt).toBe('theme')
    callback!()
    await Promise.resolve()
    await Promise.resolve()
    expect(animate).toHaveBeenCalledTimes(1)
    const [frames, options] = animate.mock.calls[0]
    expect(frames.clipPath).toEqual(revealClip(250, 100, revealRadius(250, 100, 1000, 600)))
    expect(options).toMatchObject({ duration: REVEAL_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' })
    finish()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('a transition of another kind never draws the circle', async () => {
    withViewTransition('details', () => undefined, { origin: { x: 1, y: 1 } })
    await Promise.resolve()
    await Promise.resolve()
    expect(animate).not.toHaveBeenCalled()
    finish()
    await Promise.resolve()
    await Promise.resolve()
  })
})

describe('withViewTransition while another transition runs', () => {
  it('only the skipped hook runs (the live transition owns the names), never done', async () => {
    withViewTransition('details', () => undefined)
    const log: string[] = []
    withViewTransition('chat', () => void log.push('update'), { done: () => log.push('done'), skipped: () => log.push('skipped') })
    expect(log).toEqual(['update', 'skipped'])
    finish()
    await Promise.resolve()
    await Promise.resolve()
  })
})

describe('the theme circle', () => {
  it('reaches the farthest corner', () => {
    expect(revealRadius(0, 0, 1000, 600)).toBeCloseTo(Math.hypot(1000, 600))
    expect(revealRadius(1000, 600, 1000, 600)).toBeCloseTo(Math.hypot(1000, 600))
    expect(revealRadius(250, 100, 1000, 600)).toBeCloseTo(Math.hypot(750, 500))
    expect(revealRadius(500, 300, 1000, 600)).toBeCloseTo(Math.hypot(500, 300))
  })
  it('grows from a point to the radius', () => {
    expect(revealClip(10, 20, 300)).toEqual(['circle(0px at 10px 20px)', 'circle(300px at 10px 20px)'])
  })
  it('keeps a control position for two seconds, once', () => {
    const el = { getBoundingClientRect: () => ({ left: 100, top: 40, width: 60, height: 20 }) } as unknown as Element
    noteThemeOrigin(el, 1000)
    expect(takeThemeOrigin(1500)).toEqual({ x: 130, y: 50 })
    expect(takeThemeOrigin(1600)).toBeUndefined()
    noteThemeOrigin(el, 1000)
    expect(takeThemeOrigin(3500)).toBeUndefined()
  })
  it('opens from the middle of the window when there is no control (the command palette)', () => {
    noteThemeOrigin(undefined, 5000)
    expect(takeThemeOrigin(5001)).toEqual({ x: 500, y: 300 })
  })
})

