import { describe, expect, it } from 'vitest'
import { isComposingEnter } from '../src/renderer/src/imeGuard'

describe('isComposingEnter', () => {
  it('is true for an Enter that commits a composition', () => {
    expect(isComposingEnter({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe(true)
  })

  it('is true for the IME placeholder key code', () => {
    expect(isComposingEnter({ key: 'Enter', keyCode: 229, nativeEvent: { isComposing: false } })).toBe(true)
  })

  it('is true when the flag sits on the event itself (a native KeyboardEvent)', () => {
    expect(isComposingEnter({ key: 'Enter', isComposing: true })).toBe(true)
  })

  it('is false for a plain Enter', () => {
    expect(isComposingEnter({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: false } })).toBe(false)
    expect(isComposingEnter({ key: 'Enter' })).toBe(false)
  })

  it('is false for other keys even while composing', () => {
    expect(isComposingEnter({ key: 'a', keyCode: 229, nativeEvent: { isComposing: true } })).toBe(false)
  })
})
