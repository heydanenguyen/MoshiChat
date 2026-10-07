/**
 * Instagram's web client reads direct messages through GraphQL only: the direct_v2 REST endpoints (inbox, thread,
 * pending inbox) answer 404 since the end of September 2026. These are the queries instagram.com itself runs
 * (checked against the live site in October 2026), and the conversions from their answers to the shapes the rest
 * of the adapter already works with (direct_v2 threads and items, Slide message nodes).
 *
 *   inbox, first page   PolarisDirectInboxQuery            device_id_for_iris_subscription
 *   inbox, later pages  IGDThreadListOffMsysPaginationQuery id (the mailbox), cursor, count, folder INBOX | PENDING
 *   a chat, newest      IGDThreadDetailQuery                thread_fbid, min_uq_seq_id
 *   a chat, older       IGDMessageListOffMsysQuery          id (thread_fbid), after (cursor), first
 *
 * Gatekeeper values the queries also need (__relay_internal__pv__…relayprovider) are filled in by the page.
 */
import type { IgItem } from './instagram-items'
import type { SlideNode } from './instagram-slide'

export const INBOX_QUERY = 'PolarisDirectInboxQuery'
export const THREAD_LIST_PAGE_QUERY = 'IGDThreadListOffMsysPaginationQuery'
export const THREAD_DETAIL_QUERY = 'IGDThreadDetailQuery'
export const MESSAGE_PAGE_QUERY = 'IGDMessageListOffMsysQuery'

export interface GqlUser {
  id?: string
  username?: string
  full_name?: string
  profile_pic_url?: string
  is_verified?: boolean
  interop_messaging_user_fbid?: string
}

export interface GqlThread {
  id?: string
  thread_id?: string
  thread_fbid?: string
  thread_title?: string | null
  is_group?: boolean
  folder?: string
  last_activity_timestamp_ms?: string | number
  marked_as_unread?: boolean
  is_muted?: boolean
  users?: GqlUser[]
  usersWithoutViewer?: GqlUser[]
  viewer?: { id?: string; interop_messaging_user_fbid?: string; profile_pic_url?: string } | null
  viewer_id?: string
  slide_read_receipts?: Array<{ participant_fbid?: string; watermark_timestamp_ms?: string | number }> | null
  slide_messages?: GqlConnection<SlideNode> | null
}

interface GqlConnection<T> {
  edges?: Array<{ node?: T | null; cursor?: string } | null> | null
  page_info?: { end_cursor?: string | null; has_next_page?: boolean } | null
}

/** A thread in the shape the adapter keeps (direct_v2's), its messages and who is who. */
export interface ConvertedThread {
  thread: {
    thread_id: string
    thread_v2_id?: string
    thread_title?: string
    is_group?: boolean
    users: Array<{ pk: string; username: string; full_name?: string; profile_pic_url?: string; is_verified?: boolean }>
    items: IgItem[]
    last_permanent_item?: IgItem
    last_activity_at?: number
    muted?: boolean
    last_seen_at: Record<string, { timestamp: string }>
  }
  /** Message nodes by item id, to map with mapSlideNode. */
  nodes: Map<string, SlideNode>
  /** Messaging id (fbid) -> Instagram user id, for the senders. */
  fbids: Map<string, string>
}

function walk<T>(value: unknown, found: (v: Record<string, unknown>) => T | undefined, depth = 0): T | undefined {
  if (!value || typeof value !== 'object' || depth > 14) return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = walk(item, found, depth + 1)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  const own = found(value as Record<string, unknown>)
  if (own !== undefined) return own
  for (const child of Object.values(value)) {
    const hit = walk(child, found, depth + 1)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** The thread list in an inbox or pagination answer, its next-page cursor and the mailbox id. */
export function threadListOf(response: unknown): { threads: GqlThread[]; cursor?: string; hasMore: boolean; mailboxId?: string } {
  const data = (response as { data?: unknown })?.data ?? response
  const mailboxId = walk(data, (v) => (typeof v.id === 'string' && 'threads_by_folder' in v ? v.id : undefined))
  const list = walk(data, (v) => {
    const edges = v.edges as GqlConnection<{ as_ig_direct_thread?: GqlThread }>['edges']
    return Array.isArray(edges) && edges.some((e) => e?.node?.as_ig_direct_thread) ? (v as GqlConnection<{ as_ig_direct_thread?: GqlThread }>) : undefined
  })
  const threads = (list?.edges ?? []).map((e) => e?.node?.as_ig_direct_thread).filter((t): t is GqlThread => !!t?.thread_id)
  return { threads, cursor: list?.page_info?.end_cursor ?? undefined, hasMore: !!list?.page_info?.has_next_page, mailboxId }
}

/** The thread and its message list in a thread-detail answer. */
export function threadDetailOf(response: unknown): GqlThread | undefined {
  return (response as { data?: { get_slide_thread_nullable?: { as_ig_direct_thread?: GqlThread } } })?.data?.get_slide_thread_nullable?.as_ig_direct_thread
}

/** Message nodes (newest first) and the cursor for older ones, wherever the answer keeps them. */
export function messagePageOf(response: unknown): { nodes: SlideNode[]; cursor?: string; hasOlder: boolean } {
  const data = (response as { data?: unknown })?.data ?? response
  const conn = walk(data, (v) => {
    const edges = v.edges as GqlConnection<SlideNode>['edges']
    return Array.isArray(edges) && edges.some((e) => e?.node?.timestamp_ms) ? (v as GqlConnection<SlideNode>) : undefined
  })
  const nodes = (conn?.edges ?? []).map((e) => e?.node).filter((n): n is SlideNode => !!n && !!(n.message_id ?? n.id))
  nodes.sort((a, b) => Number(b.timestamp_ms ?? 0) - Number(a.timestamp_ms ?? 0))
  return { nodes, cursor: conn?.page_info?.end_cursor ?? undefined, hasOlder: !!conn?.page_info?.has_next_page }
}

/** Who a messaging id (fbid) belongs to, from a thread's people and its viewer. */
export function fbidsOf(thread: GqlThread, mePk: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const u of [...(thread.users ?? []), ...(thread.usersWithoutViewer ?? [])]) if (u.interop_messaging_user_fbid && u.id) map.set(u.interop_messaging_user_fbid, u.id)
  if (thread.viewer?.interop_messaging_user_fbid) map.set(thread.viewer.interop_messaging_user_fbid, thread.viewer.id ?? mePk)
  return map
}

/** A Slide message as a direct_v2 item: its id, sender and time (the content is mapped from the node itself). */
export function slideItem(node: SlideNode, fbids: Map<string, string>): IgItem {
  const id = String(node.message_id ?? node.id)
  const sender = node.sender_fbid ?? node.sender?.id ?? ''
  return {
    item_id: id,
    message_id: id,
    user_id: fbids.get(sender) ?? node.sender?.igid ?? sender,
    // direct_v2 counts in microseconds
    timestamp: String(Number(node.timestamp_ms ?? 0) * 1000),
    item_type: 'placeholder'
  }
}

/** A GraphQL thread in the adapter's direct_v2 shape. */
export function convertThread(t: GqlThread, mePk: string): ConvertedThread {
  const fbids = fbidsOf(t, mePk)
  const others = (t.usersWithoutViewer?.length ? t.usersWithoutViewer : t.users ?? []).filter((u) => u.id && u.id !== mePk)
  const nodes = new Map<string, SlideNode>()
  const items = messagePageOf(t.slide_messages ?? {}).nodes.map((node) => {
    const item = slideItem(node, fbids)
    nodes.set(item.item_id, node)
    return item
  })
  // Read receipts: how far each person has read, by user id (the viewer's own, unless marked unread)
  const lastSeen: Record<string, { timestamp: string }> = {}
  for (const r of t.slide_read_receipts ?? []) {
    const pk = r.participant_fbid ? fbids.get(r.participant_fbid) : undefined
    if (pk && r.watermark_timestamp_ms) lastSeen[pk] = { timestamp: String(Number(r.watermark_timestamp_ms) * 1000) }
  }
  if (t.marked_as_unread) delete lastSeen[mePk]
  return {
    thread: {
      thread_id: String(t.thread_id),
      thread_v2_id: t.thread_fbid ?? t.id,
      thread_title: t.thread_title ?? undefined,
      is_group: !!t.is_group,
      users: others.map((u) => ({ pk: String(u.id), username: u.username ?? '', full_name: u.full_name, profile_pic_url: u.profile_pic_url, is_verified: u.is_verified })),
      items,
      last_permanent_item: items[0],
      last_activity_at: Number(t.last_activity_timestamp_ms ?? 0) * 1000,
      muted: !!t.is_muted,
      last_seen_at: lastSeen
    },
    nodes,
    fbids
  }
}
