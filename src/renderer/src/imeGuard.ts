/**
 * An Enter that only commits an input-method composition (Vietnamese Telex/VNI, CJK). Typing "việc" and pressing
 * Enter must finish the word, not save "vie": handlers return early when this is true. Chromium reports keyCode 229
 * for keys swallowed by the IME, and the flag on the native event covers the keydown right after compositionend.
 */
export function isComposingEnter(e: { key: string; keyCode?: number; nativeEvent?: { isComposing?: boolean }; isComposing?: boolean }): boolean {
  return e.key === 'Enter' && (!!e.nativeEvent?.isComposing || !!e.isComposing || e.keyCode === 229)
}
