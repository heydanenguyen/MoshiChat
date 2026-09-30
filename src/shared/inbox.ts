import { isMutedBy, type Account, type Conversation, type Message, type Settings } from './types'

/** Muted in Moshi (the chat, its tag, account or platform) or on the platform itself. */
export function isChatMuted(settings: Pick<Settings, 'muted' | 'tags'>, conversation: Pick<Conversation, 'id' | 'accountId' | 'platform' | 'muted'>): boolean {
  return !!conversation.muted || isMutedBy(settings, conversation)
}

/**
 * The archive mark for a chat: the time of its last message when it was archived. It is the platform's clock,
 * not this computer's, so a message that arrives late or a clock running fast cannot hide a new message.
 */
export function archiveMark(conversation: Pick<Conversation, 'lastMessage'>): number {
  return conversation.lastMessage?.sentAt ?? 0
}

/** The other side wrote after the chat was archived. */
export function hasReturned(conversation: Pick<Conversation, 'lastMessage'>, mark: number): boolean {
  const last = conversation.lastMessage
  return !!last && !last.isOutgoing && last.sentAt > mark
}

/**
 * Archive is "done": the chat leaves the inbox and comes back by itself when the other side writes again, so
 * nothing is lost by clearing it away. A muted chat stays archived whatever arrives (Telegram's rule), which
 * makes "archive + mute" the way to put a noisy chat away for good.
 */
export function isArchived(conversation: Pick<Conversation, 'lastMessage'>, mark: number | undefined, muted: boolean): boolean {
  if (mark === undefined) return false
  return muted || !hasReturned(conversation, mark)
}

/**
 * The names people use to @mention you on an account: display name, username (stored as "@name" by some
 * adapters) and, for a phone number (WhatsApp), its digits, which is how WhatsApp writes the mention.
 */
export function accountNames(account: Pick<Account, 'displayName' | 'handle'> | undefined): string[] {
  if (!account) return []
  const handle = account.handle?.trim() ?? ''
  const names = [account.displayName, handle.replace(/^@/, '')]
  const digits = handle.replace(/[^\d]/g, '')
  if (/^\+?[\d\s().-]+$/.test(handle) && digits.length >= 6) names.push(digits)
  return names
}

/** A message request still waiting: not accepted in Moshi (replying accepts it too; the adapter then drops the flag). */
export function isPendingRequest(conversation: Pick<Conversation, 'id' | 'request'>, accepted: Record<string, number> | undefined): boolean {
  return !!conversation.request && !accepted?.[conversation.id]
}

/**
 * For platforms with no request folder (Zalo): a one-to-one chat is a request when the other person is not a
 * friend (or contact), you did not start it, and you have never written in it. Unknown until the friend list
 * has loaded, so nothing flickers into Requests at start-up.
 */
export function isStrangerChat(chat: { isGroup: boolean; friendsKnown: boolean; isFriend: boolean; startedByMe: boolean; youWrote: boolean }): boolean {
  return !chat.isGroup && chat.friendsKnown && !chat.isFriend && !chat.startedByMe && !chat.youWrote
}

/**
 * A one-time code (OTP, verification, login code): it gets through even from a message request, the way
 * time-sensitive messages get past Apple's unknown-senders filter. A 4-8 digit number next to words that
 * name a verification code, in Vietnamese or English.
 */
export function looksLikeCode(text: string): boolean {
  // 4-8 digits standing alone: not part of a longer number, a price (150.000) or a decimal.
  if (!/(?<!\d|\d[.,])\d{4,8}(?!\d|[.,]\d)/.test(text)) return false
  // Words that name a code you are meant to type somewhere; not "mã giảm giá" (a discount) or "pin" (a battery).
  return /\b(otp|passcode|one[- ]time|verification|verify|security code|login code|confirmation code|auth(entication)? code)\b|mã (otp|pin|xác|bảo mật|đăng nhập|kích hoạt)|xác (thực|minh|nhận)/iu.test(text)
}

/** Lower case, no Vietnamese marks, single spaces: "Nguyễn  Minh Anh" and "nguyen minh anh" compare equal. */
export function foldName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Group-wide call-outs: Zalo's @All, Telegram/Discord style @everyone, and the Vietnamese spelling. */
const EVERYONE = ['all', 'everyone', 'tat ca', 'moi nguoi']

/**
 * Whether a message in a group is for you: it @mentions one of your names (display name or handle, marks and case
 * ignored), calls out everyone, or replies to something you sent. Platforms put mentions in the text as "@Name",
 * so this is read from the text; `ownIds` (your messages in the chat, when known) makes replies exact.
 */
export function isForMe(message: Pick<Message, 'text' | 'replyTo'>, myNames: readonly string[], ownIds?: ReadonlySet<string>): boolean {
  const names = myNames.map((n) => foldName(n).replace(/^@/, '')).filter((n) => n.length > 1)
  if (message.replyTo) {
    if (ownIds?.has(message.replyTo.id)) return true
    if (names.includes(foldName(message.replyTo.senderName))) return true
  }
  if (!message.text.includes('@')) return false
  const text = ` ${foldName(message.text)} `
  // A name counts when it follows "@" and ends at a word boundary ("@Minh Anh," yes; "@Minh Anhh" no).
  return [...names, ...EVERYONE].some((name) => {
    let at = text.indexOf(`@${name}`)
    while (at >= 0) {
      const after = text[at + name.length + 1]
      if (!after || !/[\p{L}\p{N}_]/u.test(after)) return true
      at = text.indexOf(`@${name}`, at + 1)
    }
    return false
  })
}
