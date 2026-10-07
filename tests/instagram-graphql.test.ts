import { describe, expect, it } from 'vitest'
import { convertThread, messagePageOf, slideItem, threadDetailOf, threadListOf, type GqlThread } from '../src/main/adapters/instagram-graphql'
import { mapSlideNode } from '../src/main/adapters/instagram-slide'

// Shapes as instagram.com answered in October 2026 (made-up people and words).
const ME = '111'
const thread = (n: number, extra: Partial<GqlThread> = {}): GqlThread => ({
  id: `90${n}`,
  thread_id: `3402823668417103009491${n}`,
  thread_fbid: `90${n}`,
  thread_title: null,
  is_group: false,
  folder: 'PRIMARY',
  last_activity_timestamp_ms: String(1_791_397_027_000 + n),
  marked_as_unread: false,
  is_muted: n === 2,
  viewer: { id: ME, interop_messaging_user_fbid: 'fb-me', profile_pic_url: 'https://cdn/me.jpg' },
  viewer_id: ME,
  users: [{ id: `22${n}`, username: `lan${n}`, full_name: `Lan ${n}`, profile_pic_url: 'https://cdn/lan.jpg', interop_messaging_user_fbid: `fb-lan${n}` }],
  usersWithoutViewer: [{ id: `22${n}`, username: `lan${n}`, full_name: `Lan ${n}`, interop_messaging_user_fbid: `fb-lan${n}` }],
  slide_read_receipts: [
    { participant_fbid: 'fb-me', watermark_timestamp_ms: '1791397027000' },
    { participant_fbid: `fb-lan${n}`, watermark_timestamp_ms: '1791397020000' }
  ],
  slide_messages: {
    edges: [
      { node: { id: `m${n}-2`, message_id: `mid.${n}2`, sender_fbid: `fb-lan${n}`, timestamp_ms: '1791397027000', content_type: 'TEXT', text_body: 'tối nay đi ăn không', content: { __typename: 'SlideMessageTextContent', text_body: 'tối nay đi ăn không' } } },
      { node: { id: `m${n}-1`, message_id: `mid.${n}1`, sender_fbid: 'fb-me', timestamp_ms: '1791397000000', content_type: 'TEXT', text_body: 'ok', content: { __typename: 'SlideMessageTextContent', text_body: 'ok' } } }
    ],
    page_info: { end_cursor: 'c1', has_next_page: true }
  },
  ...extra
})

const inboxAnswer = {
  data: {
    get_slide_mailbox_for_iris_subscription: {
      __typename: 'SlideMailbox',
      id: 'mailbox-1',
      threads_by_folder: { edges: [{ node: { as_ig_direct_thread: thread(1) } }, { node: { as_ig_direct_thread: thread(2) } }], page_info: { end_cursor: 'next', has_next_page: true } },
      pinned_threads_v2: { edges: [] }
    }
  }
}

describe('Instagram inbox through GraphQL', () => {
  it('lists the threads with the mailbox and the next-page cursor', () => {
    const list = threadListOf(inboxAnswer)
    expect(list.threads.map((t) => t.thread_fbid)).toEqual(['901', '902'])
    expect(list).toMatchObject({ cursor: 'next', hasMore: true, mailboxId: 'mailbox-1' })
  })

  it('turns a thread into the direct_v2 shape, people and senders included', () => {
    const { thread: t, nodes, fbids } = convertThread(thread(2), ME)
    expect(t).toMatchObject({ thread_id: '34028236684171030094912', thread_v2_id: '902', is_group: false, muted: true })
    expect(t.users).toEqual([{ pk: '222', username: 'lan2', full_name: 'Lan 2', profile_pic_url: undefined, is_verified: undefined }])
    expect(fbids.get('fb-me')).toBe(ME)
    // newest first, senders as Instagram user ids, times in microseconds
    expect(t.items.map((i) => [i.item_id, i.user_id, i.timestamp])).toEqual([
      ['mid.22', '222', '1791397027000000'],
      ['mid.21', ME, '1791397000000000']
    ])
    expect(t.last_permanent_item?.item_id).toBe('mid.22')
    expect(t.last_seen_at[ME]).toEqual({ timestamp: '1791397027000000' })
    expect(mapSlideNode(nodes.get('mid.22')!, 'mid.22').text).toBe('tối nay đi ăn không')
  })

  it('a thread marked unread loses the viewer’s read mark', () => {
    expect(convertThread(thread(3, { marked_as_unread: true }), ME).thread.last_seen_at[ME]).toBeUndefined()
  })
})

describe('Instagram chat pages through GraphQL', () => {
  it('reads the newest page from the thread query, with the cursor for older messages', () => {
    const detail = threadDetailOf({ data: { get_slide_thread_nullable: { as_ig_direct_thread: thread(4) } } })
    const page = messagePageOf(detail?.slide_messages ?? {})
    expect(page.nodes.map((n) => n.message_id)).toEqual(['mid.42', 'mid.41'])
    expect(page).toMatchObject({ cursor: 'c1', hasOlder: true })
  })

  it('reads older messages from the message list query wherever it nests them, newest first', () => {
    const answer = { data: { fetch__SlideThread: { slide_messages: { edges: [{ node: { message_id: 'a', timestamp_ms: '10' } }, { node: { message_id: 'b', timestamp_ms: '20' } }], page_info: { end_cursor: 'c2', has_next_page: false } } } } }
    const page = messagePageOf(answer)
    expect(page.nodes.map((n) => n.message_id)).toEqual(['b', 'a'])
    expect(page).toMatchObject({ cursor: 'c2', hasOlder: false })
  })

  it('a sender not seen in the thread keeps their messaging id', () => {
    expect(slideItem({ message_id: 'x', sender_fbid: 'fb-stranger', timestamp_ms: '5' }, new Map()).user_id).toBe('fb-stranger')
  })
})
