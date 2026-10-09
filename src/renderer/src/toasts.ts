export interface QueuedToast {
  id: number
  kind: 'error' | 'info'
  action?: unknown
}

/** How many toasts stack at once. */
export const MAX_TOASTS = 2

/**
 * Add a toast to the stack (oldest first). When it is full, the oldest plain toast makes room so one that carries a
 * button (Undo) is never pushed off by a passing message. If every toast has a button, the oldest goes, except that
 * a plain info notice is simply dropped rather than evicting an Undo.
 */
export function pushToast<T extends QueuedToast>(list: readonly T[], toast: T, max = MAX_TOASTS): T[] {
  if (list.length < max) return [...list, toast]
  const plain = list.findIndex((t) => !t.action)
  if (plain >= 0) return [...list.slice(0, plain), ...list.slice(plain + 1), toast]
  if (!toast.action && toast.kind === 'info') return [...list]
  return [...list.slice(1), toast]
}
