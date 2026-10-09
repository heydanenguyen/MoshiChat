import { describe, expect, it } from 'vitest'
import { pushToast, type QueuedToast } from '../src/renderer/src/toasts'

const toast = (id: number, extra: Partial<QueuedToast> = {}): QueuedToast => ({ id, kind: 'info', ...extra })
const undo = { label: 'Undo' }

describe('pushToast', () => {
  it('stacks up to two toasts, oldest first', () => {
    expect(pushToast([toast(1)], toast(2)).map((t) => t.id)).toEqual([1, 2])
  })

  it('lets the oldest plain toast make room', () => {
    expect(pushToast([toast(1), toast(2)], toast(3)).map((t) => t.id)).toEqual([2, 3])
  })

  it('never overwrites a toast that carries an action with a plain one', () => {
    const list = [toast(1, { action: undo }), toast(2)]
    expect(pushToast(list, toast(3)).map((t) => t.id)).toEqual([1, 3])
  })

  it('keeps both Undo toasts and drops a plain info notice', () => {
    const list = [toast(1, { action: undo }), toast(2, { action: undo })]
    expect(pushToast(list, toast(3)).map((t) => t.id)).toEqual([1, 2])
  })

  it('still shows an error when every toast has an action (the oldest goes)', () => {
    const list = [toast(1, { action: undo }), toast(2, { action: undo })]
    expect(pushToast(list, toast(3, { kind: 'error' })).map((t) => t.id)).toEqual([2, 3])
  })

  it('does not mutate the input', () => {
    const list = Object.freeze([toast(1), toast(2)])
    expect(() => pushToast(list, toast(3))).not.toThrow()
  })
})
