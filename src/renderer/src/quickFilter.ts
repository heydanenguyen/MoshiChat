import type { Conversation, PreviewKind } from '@shared/types'

/**
 * Quick filters: the chips above the chat list. They narrow whatever the sidebar already picked (all inboxes,
 * one platform, one account or one tag), so "Zalo + Unread" is two clicks.
 */
export type QuickFilter = 'all' | 'unread' | 'awaiting' | 'groups' | 'drafts'

export const QUICK_FILTERS: readonly QuickFilter[] = ['all', 'unread', 'awaiting', 'groups', 'drafts']

/** How far back an unanswered message still counts as waiting for you. Older ones are history, not a to-do. */
export const AWAITING_WINDOW = 30 * 24 * 60 * 60 * 1000

export interface QuickFilterContext {
  now: number
  /** Unsent text per chat. */
  drafts: Record<string, string>
  /** Chats the person marked unread in Moshi: conversation id -> when. */
  markedUnread?: Record<string, number>
  /** Muted in Moshi or on the platform. */
  isMuted: (conversation: Conversation) => boolean
}

/** New messages, or marked unread by hand. */
export function isUnread(conversation: Conversation, markedUnread?: Record<string, number>): boolean {
  return conversation.unreadCount > 0 || !!markedUnread?.[conversation.id]
}

/** Last messages that ask nothing of you: recalled, unavailable, a call (answered or not, it is not a message), a reaction to your story. */
const NOTHING_TO_ANSWER: ReadonlySet<PreviewKind> = new Set(['unsent', 'unavailable', 'call', 'story_reaction'])

/**
 * Someone is waiting on you: a one-to-one chat whose last message came from them, recently. Groups are left out
 * (a message there is rarely addressed to you), and so are muted chats (bots, shops, official accounts).
 */
export function isAwaitingReply(conversation: Conversation, now: number, muted: boolean): boolean {
  const last = conversation.lastMessage
  if (!last || last.isOutgoing || conversation.isGroup || muted) return false
  if (last.kind && NOTHING_TO_ANSWER.has(last.kind)) return false
  return now - last.sentAt <= AWAITING_WINDOW
}

export function matchesQuickFilter(conversation: Conversation, filter: QuickFilter, ctx: QuickFilterContext): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'unread':
      return isUnread(conversation, ctx.markedUnread)
    case 'awaiting':
      return isAwaitingReply(conversation, ctx.now, ctx.isMuted(conversation))
    case 'groups':
      return conversation.isGroup
    case 'drafts':
      return !!ctx.drafts[conversation.id]?.trim()
  }
}

/** How many chats match each chip, in one pass. */
export function countQuickFilters(conversations: readonly Conversation[], ctx: QuickFilterContext): Record<QuickFilter, number> {
  const counts: Record<QuickFilter, number> = { all: conversations.length, unread: 0, awaiting: 0, groups: 0, drafts: 0 }
  for (const c of conversations) {
    for (const filter of QUICK_FILTERS) if (filter !== 'all' && matchesQuickFilter(c, filter, ctx)) counts[filter]++
  }
  return counts
}

/**
 * The chats a chip shows. `keep` holds open chats that were already listed: they stay put once they stop
 * matching, so opening an unread chat (which reads it) or answering someone does not pull the row out from
 * under the pointer; they leave when you move on.
 */
export function applyQuickFilter(conversations: readonly Conversation[], filter: QuickFilter, ctx: QuickFilterContext, keep: ReadonlySet<string> = new Set()): Conversation[] {
  if (filter === 'all') return [...conversations]
  return conversations.filter((c) => keep.has(c.id) || matchesQuickFilter(c, filter, ctx))
}

/** A badge number that stays short. */
export const formatBadge = (n: number): string => (n > 99 ? '99+' : String(n))
