/** A message this young slides in when it appears; older ones (a chat opening, rows scrolled back into view) just show. */
export const FRESH_MS = 3000

export function isFresh(sentAt: number, now: number = Date.now()): boolean {
  return now - sentAt < FRESH_MS
}
