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

/**
 * Zalo's reaction codes (zca-js `Reactions`) and the emoji each one looks like in the Zalo app. Zalo sends and
 * takes codes, never emoji; anything missing here shows as a neutral sparkle instead of a raw code like "/-rose".
 */
export const ZALO_EMOJI: Record<string, string> = {
  '/-heart': '❤️',
  '/-strong': '👍',
  ':>': '😆',
  ':o': '😮',
  ':-((': '😭',
  ':-h': '😡',
  ':-*': '😘',
  ":')": '😂',
  '/-shit': '💩',
  '/-rose': '🌹',
  '/-break': '💔',
  '/-weak': '👎',
  ';xx': '😍',
  ';-/': '😕',
  ';-)': '😉',
  '/-fade': '🥀',
  '/-li': '☀️',
  '/-bd': '🎂',
  '/-bome': '💣',
  '/-ok': '👌',
  '/-v': '✌️',
  '/-thanks': '🤝',
  '/-punch': '👊',
  '/-share': '📤',
  '_()_': '🙏',
  '/-no': '✋',
  '/-bad': '😖',
  '/-loveu': '🤟',
  '--b': '😓',
  ':((': '😢',
  'x-)': '😎',
  '8-)': '🤓',
  ';-d': '😁',
  'b-)': '🕶️',
  ':--|': '😐',
  'p-(': '😟',
  ':-bye': '👋',
  '|-)': '😴',
  ':wipe': '😅',
  ':-dig': '🤭',
  '&-(': '😧',
  ':handclap': '👏',
  '>-|': '😠',
  ';-x': '🤐',
  ':-o': '😲',
  ';-s': '😳',
  ';-a': '😨',
  ':-<': '☹️',
  ':))': '😄',
  '$-)': '🤑',
  '/-beer': '🍺'
}

/** The six Zalo puts under every message, in its order. */
export const ZALO_QUICK = ['❤️', '👍', '😆', '😮', '😭', '😡']

const ZALO_CODE: Record<string, string> = Object.fromEntries(Object.entries(ZALO_EMOJI).map(([code, emoji]) => [emoji, code]))
// Emoji people pick elsewhere that Zalo has a close code for.
ZALO_CODE['😊'] = ':>'

/** Zalo's code for an emoji, or undefined when Zalo has no such reaction. */
export const zaloCode = (emoji: string): string | undefined => ZALO_CODE[emoji]
/** What a Zalo code looks like. */
export const zaloEmoji = (code: string): string => ZALO_EMOJI[code] ?? '✨'

/** Every reaction Zalo can send, quick ones first: what its "more" panel offers. */
export const ZALO_ALL = [...ZALO_QUICK, ...Object.values(ZALO_EMOJI).filter((e) => !ZALO_QUICK.includes(e))]

/**
 * One reaction per person, as Zalo keeps them: who reacted with what (my own under `me`), tallied for a bubble.
 * Most used first; names (when known) say who, for the tooltip.
 */
export function tally(byPerson: Record<string, string>, me: string, nameOf: (person: string) => string | undefined = () => undefined): Reaction[] {
  const groups = new Map<string, { count: number; byMe: boolean; names: string[] }>()
  for (const [person, emoji] of Object.entries(byPerson)) {
    const g = groups.get(emoji) ?? { count: 0, byMe: false, names: [] }
    g.count++
    if (person === me) g.byMe = true
    else {
      const name = nameOf(person)
      if (name) g.names.push(name)
    }
    groups.set(emoji, g)
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([emoji, g]) => ({ emoji, count: g.count, byMe: g.byMe, ...(g.names.length ? { names: g.names } : {}) }))
}
