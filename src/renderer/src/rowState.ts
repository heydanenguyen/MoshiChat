import type { MessageStatus } from '@shared/types'

/** Tags whose people count as close friends: the row shows a heart for them. */
export const CLOSE_TAGS: readonly string[] = ['love', 'family', 'friend']

/** My last message in the row: one grey check once sent, two accent checks once read. */
export type Receipt = 'sent' | 'read'

export interface RowInput {
  unread: boolean
  muted: boolean
  isTyping: boolean
  /** Unsent text for the chat; only shown while the chat is not the open one. */
  draft: string | undefined
  selected: boolean
  /** The chat's last message is mine. */
  lastOutgoing: boolean
  /** The state of that message when it is known (chats not opened yet only know it was sent). */
  status: MessageStatus | undefined
  tagIds: readonly string[]
}

export interface RowState {
  /** The accent dot at the row's left edge: unread, and not muted (a muted chat counts quietly, in the pill only). */
  dot: boolean
  /** The second line: what the chat is doing wins over what was last said. */
  line: 'typing' | 'draft' | 'message'
  receipt: Receipt | undefined
  close: boolean
  /** At most one tag chip inline; the rest are in Details. */
  chip: string | undefined
  hiddenTags: number
}

/** What a row shows besides its text, from plain values (a row is a memoised component: it gets primitives only). */
export function rowState(input: RowInput): RowState {
  const line = input.isTyping ? 'typing' : input.draft && !input.selected ? 'draft' : 'message'
  let receipt: Receipt | undefined
  if (line === 'message' && input.lastOutgoing && input.status !== 'sending' && input.status !== 'failed') receipt = input.status === 'read' ? 'read' : 'sent'
  return {
    dot: input.unread && !input.muted,
    line,
    receipt,
    close: input.tagIds.some((id) => CLOSE_TAGS.includes(id)),
    chip: input.tagIds[0],
    hiddenTags: Math.max(0, input.tagIds.length - 1)
  }
}

/** The Moshi look is the one with no style picked or "moshi"; Liquid, Mono and Pals keep their own rows. */
export const isQuietStyle = (style: string | undefined): boolean => style === undefined || style === 'moshi'
