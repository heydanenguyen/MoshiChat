import type { Reaction } from './types'

/** My reaction toggled: the same emoji again removes it, another one replaces it. */
export function toggleReaction(reactions: Reaction[], emoji: string): Reaction[] {
  const mine = reactions.find((r) => r.byMe)
  let next = reactions.map((r) => (r.byMe ? { ...r, count: r.count - 1, byMe: false } : r)).filter((r) => r.count > 0)
  if (mine?.emoji !== emoji) {
    const existing = next.find((r) => r.emoji === emoji)
    next = existing ? next.map((r) => (r === existing ? { ...r, count: r.count + 1, byMe: true } : r)) : [...next, { emoji, count: 1, byMe: true }]
  }
  return next
}

/** My reaction taken off (another person's stays). */
export const withoutMine = (reactions: Reaction[]): Reaction[] =>
  reactions.map((r) => (r.byMe ? { ...r, count: r.count - 1, byMe: false } : r)).filter((r) => r.count > 0)
