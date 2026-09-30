import { foldName } from './inbox'
import type { Conversation, Message, Peer } from './types'

/**
 * One person across apps: their chats on Zalo, Messenger, Instagram… shown and answered as one. The first member
 * is the anchor: the merged chat lives under its id (so pins, tags, drafts, the archive and the split layout keep
 * working unchanged), and the others fold into it.
 */
export interface Person {
  /** Name shown for the merged chat; the anchor's name when empty. */
  name?: string
  /** Chat ids, anchor first. */
  members: string[]
  /** Where to write when they have never written to you (chosen when merging). */
  via?: string
}

/** member chat id -> person id */
export function memberIndex(people: Record<string, Person> | undefined): Map<string, string> {
  const index = new Map<string, string>()
  for (const [personId, person] of Object.entries(people ?? {})) for (const id of person.members) index.set(id, personId)
  return index
}

/**
 * The merged chat as the list and the thread show it: the anchor's identity under the person's name, every
 * member's unread messages, and the newest message of any of them.
 */
export function mergeConversation(person: Person, members: readonly Conversation[]): Conversation {
  const anchor = members[0]
  const newest = members.reduce<Conversation['lastMessage']>((best, c) => (c.lastMessage && (!best || c.lastMessage.sentAt > best.sentAt) ? c.lastMessage : best), undefined)
  return {
    ...anchor,
    title: person.name?.trim() || anchor.title,
    avatarUrl: anchor.avatarUrl ?? members.find((c) => c.avatarUrl)?.avatarUrl,
    isGroup: false,
    unreadCount: members.reduce((sum, c) => sum + c.unreadCount, 0),
    lastMessage: newest,
    updatedAt: Math.max(...members.map((c) => c.updatedAt)),
    // Still a request only if every app it came in on still treats it as one.
    request: members.every((c) => c.request) || undefined,
    members: members.map((c) => c.id)
  }
}

export interface TimelinePart {
  messages?: readonly Message[]
  hasMore: boolean
}

/**
 * One timeline from several chats, oldest first. Each chat pages back on its own, so only what is newer than
 * every chat's loaded edge is complete: a chat with more history cuts the merged view at its oldest loaded
 * message, otherwise its older messages would be missing between the others' (a hole, not the end).
 */
export function mergeTimeline(parts: readonly TimelinePart[]): { messages: Message[]; hasMore: boolean; cut: number } {
  const cut = Math.max(0, ...parts.filter((p) => p.hasMore && p.messages?.length).map((p) => p.messages![0].sentAt))
  const messages = parts
    .flatMap((p) => p.messages ?? [])
    .filter((m) => m.sentAt >= cut)
    .sort((a, b) => a.sentAt - b.sentAt)
  return { messages, hasMore: parts.some((p) => p.hasMore), cut }
}

export interface SendChoice {
  members: readonly string[]
  /** When each member chat last heard from them (their newest incoming message). */
  lastIncoming: Readonly<Record<string, number | undefined>>
  /** A chat picked by hand in the composer, and when. */
  picked?: { id: string; at: number }
  /** Replying to a message: it can only be quoted in its own app. */
  replyTo?: string
  /** The person's chosen app, for when they have never written. */
  via?: string
}

/**
 * Where a reply goes: "the app they last wrote to you on". A quoted message pins its own app; an app picked by
 * hand holds until they write from another one; with nothing from them yet, the chosen app or the anchor.
 */
export function pickSendVia(choice: SendChoice): string {
  const { members } = choice
  if (choice.replyTo && members.includes(choice.replyTo)) return choice.replyTo
  let latest: string | undefined
  for (const id of members) {
    const at = choice.lastIncoming[id]
    if (at !== undefined && (latest === undefined || at > (choice.lastIncoming[latest] ?? 0))) latest = id
  }
  const picked = choice.picked && members.includes(choice.picked.id) ? choice.picked : undefined
  if (picked && (!latest || latest === picked.id || (choice.lastIncoming[latest] ?? 0) <= picked.at)) return picked.id
  return latest ?? (choice.via && members.includes(choice.via) ? choice.via : members[0])
}

// ---------------------------------------------------------------- suggestions

/** The other side of a one-to-one chat. */
export function peerOf(conversation: Conversation): Peer | undefined {
  return conversation.participants.find((p) => !p.isMe)
}

/**
 * A phone number reduced to what identifies it: the last 9 digits, which is the subscriber number in Vietnam
 * whether written 0912 345 678, +84 912 345 678 or 84912345678.
 */
export function phoneKey(phone: string | undefined): string | undefined {
  const digits = phone?.replace(/\D/g, '') ?? ''
  return digits.length >= 9 ? digits.slice(-9) : undefined
}

/**
 * How alike two names are, 0 to 1, marks and case ignored: the same name 1; one name inside the other
 * ("Lan Phương" in "Nguyễn Lan Phương") 0.8; the same given name of two or more words ("… Minh Anh") 0.6.
 */
export function nameScore(a: string, b: string): number {
  const x = foldName(a)
  const y = foldName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const xs = x.split(' ')
  const ys = y.split(' ')
  const [short, long] = xs.length <= ys.length ? [xs, ys] : [ys, xs]
  if (short.length >= 2 && short.every((w, i) => long[long.length - short.length + i] === w)) return 0.8
  if (short.length >= 2 && long.length >= 2 && short.slice(-2).join(' ') === long.slice(-2).join(' ')) return 0.6
  return 0
}

export interface MergeCandidate {
  conversation: Conversation
  reason: 'phone' | 'name'
  score: number
}

/** A pair shown once and turned down ("not the same person") is not suggested again. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Chats that can join a merge: one-to-one, not already folded into someone else. */
function mergeable(c: Conversation, index: Map<string, string>): boolean {
  return !c.isGroup && !!peerOf(c) && !index.has(c.id)
}

/**
 * Who else a chat might be, best first: the same phone number (sure), then a similar name (a hint to confirm;
 * common names repeat). Chats on the same account are left out: one account never has two chats with one person.
 */
export function candidatesFor(target: Conversation, all: readonly Conversation[], index: Map<string, string>, dismissed?: Record<string, number>, minScore = 0.6): MergeCandidate[] {
  const phone = phoneKey(peerOf(target)?.phone)
  const out: MergeCandidate[] = []
  for (const c of all) {
    if (c.id === target.id || c.accountId === target.accountId || !mergeable(c, index) || dismissed?.[pairKey(target.id, c.id)]) continue
    const theirs = phoneKey(peerOf(c)?.phone)
    if (phone && theirs === phone) {
      out.push({ conversation: c, reason: 'phone', score: 2 })
      continue
    }
    const score = nameScore(target.originalTitle ?? target.title, c.originalTitle ?? c.title)
    if (score >= minScore) out.push({ conversation: c, reason: 'name', score })
  }
  return out.sort((a, b) => b.score - a.score || b.conversation.updatedAt - a.conversation.updatedAt)
}
