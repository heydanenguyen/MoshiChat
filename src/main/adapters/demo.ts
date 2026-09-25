import type { Account, Attachment, Conversation, Message, PeerProfile, Platform, SendOptions, SharedKind } from '@shared/types'
import { ALL_FEATURES } from '@shared/types'
import type { AdapterContext, FetchMessagesOptions, PlatformAdapter } from './types'
import { conversationId, isShared, matchesQuery } from './types'

/**
 * Sample-data adapter for the first-run experience. It behaves like a live
 * platform: typing indicators, auto replies, read receipts and the occasional
 * unprompted message so the inbox feels alive.
 */

interface SeedThread {
  key: string
  title: string
  isGroup?: boolean
  handle?: string
  participants?: string[]
  unread?: number
  pinned?: boolean
  muted?: boolean
  history: Array<[from: 'me' | string, text: string, minutesAgo: number]>
  replies: string[]
}

const ME = 'Bạn'

const SEEDS: Record<Platform, { name: string; handle: string; threads: SeedThread[] }> = {
  zalo: {
    name: 'Minh Anh',
    handle: 'minhanh',
    threads: [
      {
        key: 'khachhang',
        title: 'Chị Hạnh - Khách sỉ',
        unread: 1,
        history: [
          ['Chị Hạnh - Khách sỉ', 'Em ơi lô hàng tuần này còn size M không?', 150],
          ['me', 'Dạ còn 40 cái chị, em giữ cho chị 20 nhé', 145],
          ['Chị Hạnh - Khách sỉ', 'Ok em, chuyển khoản luôn nha', 25]
        ],
        replies: ['Cảm ơn em nhiều', 'Chị nhận được hàng rồi', 'Tuần sau chị lấy thêm 30 cái nữa']
      },
      {
        key: 'giadinh',
        title: 'Gia đình mình ❤️',
        isGroup: true,
        participants: ['Bố', 'Mẹ', 'Em Tí'],
        history: [
          ['Mẹ', 'Chủ nhật cả nhà về quê giỗ ông nhé', 400],
          ['Bố', 'Bố đặt xe 7h sáng', 390],
          ['Em Tí', 'Dạ con nhớ rồi ạ', 380],
          ['me', 'Con xin nghỉ rồi, sáng con qua', 370]
        ],
        replies: ['Mẹ nấu bánh chưng rồi nhé', 'Bố đặt xe 7h sáng, đừng dậy muộn', 'Chị ơi chở em với']
      },
      {
        key: 'shipper',
        title: 'Anh Tuấn Shipper',
        history: [
          ['Anh Tuấn Shipper', 'Đơn 3 kiện giao Q7 xong rồi nha', 700],
          ['me', 'Cảm ơn anh, mai có 5 kiện Bình Thạnh', 695]
        ],
        replies: ['Ok em, mai 9h anh qua lấy', 'Anh tới rồi nè', 'Giao xong rồi nhé']
      }
    ]
  },
  whatsapp: {
    name: 'Minh Anh',
    handle: '+84 912 345 678',
    threads: [
      {
        key: 'emma',
        title: 'Emma Watson (Client)',
        unread: 2,
        history: [
          ['Emma Watson (Client)', 'Hi Minh Anh, the campaign visuals look stunning 🙌', 200],
          ['me', 'Thank you Emma! Final files will be ready Thursday.', 190],
          ['Emma Watson (Client)', 'Perfect. Could you also send the source files?', 30],
          ['Emma Watson (Client)', 'Our team wants to localize for the EU market.', 29]
        ],
        replies: ['Amazing, thanks!', 'Received, forwarding to the team.', 'Talk tomorrow 👋']
      },
      {
        key: 'agency',
        title: 'Agency Partners',
        isGroup: true,
        participants: ['Carlos', 'Yuki', 'Emma Watson (Client)'],
        history: [
          ['Carlos', 'Kickoff call moved to 4pm CET', 800],
          ['Yuki', 'Works for me', 790],
          ['me', 'Same here, will share the deck before.', 780]
        ],
        replies: ['Deck received, looks great', 'See everyone at 4', 'Adding the notes to Notion']
      }
    ]
  },
  messenger: {
    name: 'Nguyễn Minh Anh',
    handle: 'minhanh.nguyen',
    threads: [
      {
        key: 'lan',
        title: 'Lan Phương',
        unread: 2,
        pinned: true,
        history: [
          ['Lan Phương', 'Chị ơi em gửi file thiết kế banner rồi nha', 95],
          ['me', 'Ok em, chị xem rồi phản hồi liền', 92],
          ['Lan Phương', 'Màu chủ đạo em để #0A84FF giống brand luôn', 40],
          ['Lan Phương', 'Chị duyệt giúp em trước 5h nhé 🙏', 12]
        ],
        replies: ['Dạ em cảm ơn chị!', 'Em sửa lại ngay ạ', 'Vâng để em check lại rồi báo chị', 'Ok chị 💙']
      },
      {
        key: 'team',
        title: 'Team Marketing 3HVN',
        isGroup: true,
        participants: ['Hoàng Nam', 'Thu Hà', 'Quốc Bảo', 'Lan Phương'],
        unread: 5,
        history: [
          ['Hoàng Nam', 'Số liệu tuần này tăng 18% so với tuần trước 📈', 180],
          ['Thu Hà', 'Chiến dịch Reels chạy tốt hơn dự kiến', 175],
          ['me', 'Tuyệt, tuần sau mình scale gấp đôi budget nhé', 170],
          ['Quốc Bảo', 'Em đã chuẩn bị 3 concept mới cho tháng 10', 30],
          ['Hoàng Nam', 'Họp nhanh 3h chiều nay được không mọi người?', 8],
          ['Thu Hà', 'Ok anh', 6],
          ['Quốc Bảo', 'Em ok ạ', 5]
        ],
        replies: ['Chốt 3h nhé cả nhà', 'Anh Nam share slide trước giúp em', 'Em vào phòng họp trước rồi', 'Ok mọi người']
      },
      {
        key: 'david',
        title: 'David Chen',
        history: [
          ['David Chen', 'Hey! Loved the pitch deck you sent over.', 1440],
          ['me', 'Thanks David, glad it landed well.', 1430],
          ['David Chen', "Let's set up a call next week to go over partnership terms?", 1400],
          ['me', 'Perfect, Tuesday afternoon works for me.', 1390]
        ],
        replies: ['Sounds good, sending an invite now.', 'Great, talk soon!', 'Will do 👍']
      },
      {
        key: 'mom',
        title: 'Mẹ',
        muted: true,
        history: [
          ['Mẹ', 'Con ăn cơm chưa?', 300],
          ['me', 'Con ăn rồi mẹ ơi', 295],
          ['Mẹ', 'Cuối tuần về nhà nhé, mẹ nấu bún bò', 290]
        ],
        replies: ['Ừ con nhớ về sớm nhé', 'Mẹ để phần cho con', 'Nhớ mặc ấm con nhé']
      }
    ]
  },
  instagram: {
    name: 'minhanh.creates',
    handle: 'minhanh.creates',
    threads: [
      {
        key: 'brand',
        title: 'Aurora Skincare',
        handle: 'aurora.skincare',
        unread: 1,
        history: [
          ['Aurora Skincare', 'Hi Minh Anh! We loved your latest reel ✨', 260],
          ['Aurora Skincare', 'Would you be open to a paid collab for our October launch?', 258],
          ['me', 'Hi! Thank you 🥰 Yes, could you share the brief and budget?', 240],
          ['Aurora Skincare', 'Just sent it via email. Deadline is Oct 12.', 20]
        ],
        replies: ['Amazing, excited to work together!', 'Let us know if the timeline works 🙏', 'We can be flexible on deliverables.']
      },
      {
        key: 'hieu',
        title: 'Trung Hiếu',
        handle: 'hieu.photo',
        history: [
          ['Trung Hiếu', 'Bộ ảnh hôm qua đẹp quá 🔥', 600],
          ['me', 'Ánh sáng đẹp nhờ anh set up đó', 590],
          ['Trung Hiếu', 'Tuần sau chụp bộ mới ở Đà Lạt không?', 580]
        ],
        replies: ['Đi Đà Lạt chốt nhé 🌲', 'Anh book studio trước rồi', 'Gửi em moodboard nha']
      },
      {
        key: 'fan',
        title: 'linh.ng',
        handle: 'linh.ng',
        unread: 3,
        history: [
          ['linh.ng', 'Chị ơi cái đèn ring light chị dùng tên gì vậy ạ', 45],
          ['linh.ng', 'Em tìm hoài không ra 😭', 44],
          ['linh.ng', 'Chị rep em với nha', 15]
        ],
        replies: ['Dạ em cảm ơn chị nhiều ạ 💕', 'Em mua liền đây', 'Chị dễ thương quá']
      }
    ]
  },
  telegram: {
    name: 'Minh Anh',
    handle: 'minhanh_dev',
    threads: [
      {
        key: 'dev',
        title: 'Unison Dev Team',
        isGroup: true,
        participants: ['Alex', 'Priya', 'Tuấn'],
        unread: 4,
        pinned: true,
        history: [
          ['Alex', 'Pushed the new adapter layer to main', 120],
          ['Priya', 'CI is green 🟢', 115],
          ['Tuấn', 'Em đang test Telegram login flow, 2FA ok rồi', 60],
          ['me', 'Nice. Ship a build tonight?', 55],
          ['Alex', 'Yes, tagging v0.1.0 in an hour', 10],
          ['Priya', 'Release notes drafted, review pls', 9]
        ],
        replies: ['On it', 'Merged 👍', 'LGTM', 'Deploying now']
      },
      {
        key: 'sam',
        title: 'Sam Rivera',
        handle: 'samr',
        history: [
          ['Sam Rivera', 'Are you coming to the WWDC watch party?', 2000],
          ['me', "Wouldn't miss it", 1990],
          ['Sam Rivera', 'Bring the good coffee ☕️', 1985]
        ],
        replies: ['Haha deal', 'See you there', "It starts at 10, don't be late"]
      },
      {
        key: 'news',
        title: 'Apple Design Weekly',
        isGroup: true,
        muted: true,
        history: [
          ['Apple Design Weekly', 'Issue #142: Liquid Glass, one year later. What shipped and what changed', 500],
          ['Apple Design Weekly', 'Issue #143: Designing for the Dynamic Island', 100]
        ],
        replies: ['Issue #144: Motion that respects Reduce Motion']
      },
      {
        key: 'saved',
        title: 'Saved Messages',
        history: [
          ['me', 'Idea: swipe on a conversation to pin, long-press to mute', 3000],
          ['me', 'Font: SF Pro Text 13pt for lists, 15pt for bubbles', 2990]
        ],
        replies: []
      }
    ]
  }
}

/** Sample profile facts and shared content so the details pane has something to show. */
const PROFILES: Record<string, Partial<PeerProfile>> = {
  'messenger/lan': { bio: 'Designer @ 3HVN · Figma & motion', birthday: '1998-03-14', phone: '+84 903 111 222', gender: 'female' },
  'messenger/david': { bio: 'Partnerships, APAC', birthday: '--07-04', phone: '+1 415 555 0134', gender: 'male' },
  'messenger/mom': { bio: 'Mẹ yêu ❤️', birthday: '1968-11-02', phone: '+84 912 000 111', gender: 'female' },
  'instagram/brand': { bio: 'Clean beauty, made in Vietnam 🌿', extra: [{ label: 'Followers', value: '48.2K' }] },
  'instagram/hieu': { bio: 'Photographer · Đà Lạt', birthday: '1995-09-21', gender: 'male' },
  'instagram/fan': { bio: 'skincare enthusiast ✨', extra: [{ label: 'Followers', value: '312' }] },
  'telegram/sam': { bio: 'iOS engineer. Coffee first.', phone: '+1 650 555 0199', birthday: '1992-05-30', gender: 'male' },
  'zalo/khachhang': { bio: 'Kinh doanh sỉ lẻ thời trang', phone: '+84 933 444 555', birthday: '1985-12-08', gender: 'female' },
  'zalo/shipper': { phone: '+84 977 888 999', gender: 'male' },
  'whatsapp/emma': { bio: 'Brand manager · London', phone: '+44 7700 900123', birthday: '--02-17', gender: 'female' }
}

const svgImage = (a: string, b: string, label: string): string =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><circle cx="480" cy="140" r="70" fill="rgba(255,255,255,.35)"/><text x="40" y="430" font-family="Segoe UI, Helvetica, Arial" font-size="40" font-weight="700" fill="rgba(255,255,255,.9)">${label}</text></svg>`
  )

interface SeedExtra {
  thread: string
  from: 'me' | string
  minutesAgo: number
  text: string
  attachment: Attachment
}

const EXTRAS: SeedExtra[] = [
  { thread: 'messenger/lan', from: 'Lan Phương', minutesAgo: 94, text: 'Banner bản 1 nè chị', attachment: { id: 'x1', kind: 'image', url: svgImage('#5AC8FA', '#007AFF', 'Banner v1'), width: 640, height: 480 } },
  { thread: 'messenger/lan', from: 'Lan Phương', minutesAgo: 93, text: '', attachment: { id: 'x2', kind: 'image', url: svgImage('#FF9F0A', '#FF375F', 'Banner v2'), width: 640, height: 480 } },
  { thread: 'messenger/lan', from: 'Lan Phương', minutesAgo: 90, text: 'File gốc đây ạ', attachment: { id: 'x3', kind: 'file', name: 'banner-thang10.fig', size: 18_400_000 } },
  { thread: 'messenger/lan', from: 'me', minutesAgo: 60, text: 'Tham khảo thêm kiểu này nhé https://www.apple.com/newsroom/', attachment: { id: 'x4', kind: 'link', url: 'https://www.apple.com/newsroom/', name: 'Apple Newsroom' } },
  { thread: 'messenger/team', from: 'Hoàng Nam', minutesAgo: 178, text: 'Báo cáo tuần', attachment: { id: 'x5', kind: 'file', name: 'weekly-report-w39.xlsx', size: 512_000 } },
  { thread: 'messenger/team', from: 'Thu Hà', minutesAgo: 176, text: 'Reels đang chạy', attachment: { id: 'x6', kind: 'link', url: 'https://www.instagram.com/reels/', name: 'Instagram Reels' } },
  { thread: 'messenger/team', from: 'Quốc Bảo', minutesAgo: 29, text: 'Concept 1', attachment: { id: 'x7', kind: 'image', url: svgImage('#30D158', '#0A84FF', 'Concept 1'), width: 640, height: 480 } },
  { thread: 'messenger/team', from: 'Quốc Bảo', minutesAgo: 28, text: 'Concept 2', attachment: { id: 'x8', kind: 'image', url: svgImage('#BF5AF2', '#FF375F', 'Concept 2'), width: 640, height: 480 } },
  { thread: 'instagram/brand', from: 'Aurora Skincare', minutesAgo: 257, text: 'Moodboard', attachment: { id: 'x9', kind: 'image', url: svgImage('#F9CE34', '#EE2A7B', 'Aurora'), width: 640, height: 480 } },
  { thread: 'instagram/brand', from: 'Aurora Skincare', minutesAgo: 19, text: 'Brief chi tiết', attachment: { id: 'x10', kind: 'file', name: 'aurora-october-brief.pdf', size: 2_300_000 } },
  { thread: 'telegram/dev', from: 'Priya', minutesAgo: 8, text: 'Release notes draft https://github.com/3hvn/unison/releases', attachment: { id: 'x11', kind: 'link', url: 'https://github.com/3hvn/unison/releases', name: 'Releases · 3hvn/unison' } },
  { thread: 'telegram/dev', from: 'Alex', minutesAgo: 118, text: 'Screenshot build', attachment: { id: 'x12', kind: 'image', url: svgImage('#37AEE2', '#1E96C8', 'Build 0.1.0'), width: 640, height: 480 } },
  { thread: 'zalo/khachhang', from: 'Chị Hạnh - Khách sỉ', minutesAgo: 24, text: 'Chuyển khoản rồi nha em', attachment: { id: 'x13', kind: 'image', url: svgImage('#2F8CFF', '#0057D8', 'Biên lai'), width: 640, height: 480 } },
  { thread: 'whatsapp/emma', from: 'Emma Watson (Client)', minutesAgo: 199, text: 'Campaign visuals', attachment: { id: 'x14', kind: 'image', url: svgImage('#5DE68C', '#1FAF54', 'Campaign'), width: 640, height: 480 } },
  { thread: 'whatsapp/emma', from: 'me', minutesAgo: 189, text: 'Final files', attachment: { id: 'x15', kind: 'file', name: 'campaign-final.zip', size: 96_000_000 } }
]

let counter = 0
const nextId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`

export class DemoAdapter implements PlatformAdapter {
  readonly account: Account
  private conversations = new Map<string, Conversation>()
  private messages = new Map<string, Message[]>()
  private replies = new Map<string, string[]>()
  private timers = new Set<NodeJS.Timeout>()
  private ambient?: NodeJS.Timeout

  constructor(
    private readonly platform: Platform,
    private readonly ctx: AdapterContext
  ) {
    const seed = SEEDS[platform]
    this.account = {
      id: `demo-${platform}`,
      platform,
      displayName: seed.name,
      handle: seed.handle,
      status: 'disconnected',
      features: ALL_FEATURES,
      demo: true
    }
    this.buildSeed()
  }

  private buildSeed(): void {
    const seed = SEEDS[this.platform]
    const now = Date.now()
    for (const thread of seed.threads) {
      const id = conversationId(this.account.id, thread.key)
      const history: Message[] = thread.history.map(([from, text, minutesAgo], index) => ({
        id: `${id}#${index}`,
        conversationId: id,
        senderId: from === 'me' ? 'me' : from,
        senderName: from === 'me' ? ME : from,
        text,
        attachments: [],
        reactions: index === 0 && !thread.isGroup ? [{ emoji: '❤️', count: 1, byMe: from !== 'me' }] : [],
        sentAt: now - minutesAgo * 60_000,
        isOutgoing: from === 'me',
        status: from === 'me' ? 'read' : 'delivered'
      }))
      for (const extra of EXTRAS.filter((e) => e.thread === `${this.platform}/${thread.key}`)) {
        history.push({
          id: `${id}#${extra.attachment.id}`,
          conversationId: id,
          senderId: extra.from === 'me' ? 'me' : extra.from,
          senderName: extra.from === 'me' ? ME : extra.from,
          text: extra.text,
          attachments: [extra.attachment],
          reactions: [],
          sentAt: now - extra.minutesAgo * 60_000,
          isOutgoing: extra.from === 'me',
          status: extra.from === 'me' ? 'read' : 'delivered'
        })
      }
      history.sort((a, b) => a.sentAt - b.sentAt)
      const last = history[history.length - 1]
      const participants = [
        { id: 'me', name: ME, isMe: true },
        ...(thread.participants ?? [thread.title]).map((name) => ({ id: name, name }))
      ]
      this.conversations.set(id, {
        id,
        accountId: this.account.id,
        platform: this.platform,
        title: thread.title,
        isGroup: !!thread.isGroup,
        participants,
        unreadCount: thread.unread ?? 0,
        pinned: thread.pinned,
        muted: thread.muted,
        lastMessage: last && preview(last),
        updatedAt: last?.sentAt ?? now
      })
      this.messages.set(id, history)
      this.replies.set(id, thread.replies)
    }
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    await delay(600 + Math.random() * 600)
    this.setStatus('connected')
    this.ambient = setInterval(() => this.ambientMessage(), 50_000 + Math.random() * 40_000)
  }

  async disconnect(): Promise<void> {
    if (this.ambient) clearInterval(this.ambient)
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    this.setStatus('disconnected')
  }

  async listConversations(): Promise<Conversation[]> {
    return [...this.conversations.values()]
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const all = this.messages.get(id) ?? []
    const end = beforeId ? all.findIndex((m) => m.id === beforeId) : all.length
    if (end < 0) return []
    return all.slice(Math.max(0, end - limit), end)
  }

  async sendMessage(id: string, text: string, options: SendOptions = {}): Promise<Message> {
    const original = options.replyToId ? (this.messages.get(id) ?? []).find((m) => m.id === options.replyToId) : undefined
    const attachments: Attachment[] = (options.attachments ?? []).map((file, index) => ({
      id: nextId('a' + index),
      kind: file.mime.startsWith('image/') ? 'image' : file.mime.startsWith('video/') ? 'video' : file.mime.startsWith('audio/') ? 'audio' : 'file',
      url: file.preview,
      name: file.voice ? 'Voice message' : file.name,
      size: file.size,
      duration: file.duration
    }))
    const message: Message = {
      id: nextId('m'),
      conversationId: id,
      senderId: 'me',
      senderName: ME,
      text,
      attachments,
      reactions: [],
      replyTo: original ? { id: original.id, senderName: original.senderName, text: original.text } : undefined,
      sentAt: Date.now(),
      isOutgoing: true,
      status: 'sent'
    }
    this.append(message)
    this.schedule(400, () => this.ctx.emit({ type: 'message:updated', message: this.setStatusOf(message, 'delivered') }))
    const replies = this.replies.get(id) ?? []
    if (replies.length) {
      const conversation = this.conversations.get(id)!
      const others = conversation.participants.filter((p) => !p.isMe)
      const author = others[Math.floor(Math.random() * others.length)]
      this.schedule(1200, () => {
        this.ctx.emit({ type: 'message:updated', message: this.setStatusOf(message, 'read') })
        this.ctx.emit({ type: 'typing', typing: { conversationId: id, peerName: author.name, isTyping: true } })
      })
      this.schedule(2600 + Math.random() * 1800, () => {
        this.ctx.emit({ type: 'typing', typing: { conversationId: id, peerName: author.name, isTyping: false } })
        this.incoming(id, author.id, author.name, replies[Math.floor(Math.random() * replies.length)])
      })
    }
    return message
  }

  async markRead(id: string): Promise<void> {
    const conversation = this.conversations.get(id)
    if (conversation && conversation.unreadCount) {
      conversation.unreadCount = 0
      this.ctx.emit({ type: 'conversation:upserted', conversation: { ...conversation } })
    }
  }

  async setTyping(): Promise<void> {}

  async getPeerProfile(id: string): Promise<PeerProfile | undefined> {
    const conversation = this.conversations.get(id)
    if (!conversation) return undefined
    const key = id.slice(id.indexOf('/') + 1)
    const facts = PROFILES[`${this.platform}/${key}`] ?? {}
    const peer = conversation.participants.find((p) => !p.isMe)
    return {
      id: peer?.id ?? id,
      name: conversation.title,
      handle: SEEDS[this.platform].threads.find((t) => t.key === key)?.handle,
      avatarUrl: conversation.avatarUrl,
      ...facts,
      extra: conversation.isGroup ? [{ label: 'Members', value: String(conversation.participants.length) }, ...(facts.extra ?? [])] : facts.extra
    }
  }

  async listShared(id: string, kind: SharedKind, limit: number): Promise<Message[]> {
    return (this.messages.get(id) ?? []).filter((m) => isShared(m, kind)).sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  async searchInConversation(id: string, query: string, limit: number): Promise<Message[]> {
    const needle = query.toLowerCase()
    return (this.messages.get(id) ?? []).filter((m) => matchesQuery(m, needle)).sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }

  async forward(fromId: string, messageId: string, toId: string): Promise<Message> {
    const original = (this.messages.get(fromId) ?? []).find((m) => m.id === messageId)
    if (!original) throw new Error('Message not found')
    const message: Message = {
      ...original,
      id: nextId('m'),
      conversationId: toId,
      senderId: 'me',
      senderName: ME,
      reactions: [],
      replyTo: undefined,
      sentAt: Date.now(),
      isOutgoing: true,
      status: 'sent'
    }
    this.append(message)
    return message
  }

  async searchMessages(query: string, limit: number): Promise<Message[]> {
    const needle = query.toLowerCase()
    return [...this.messages.values()]
      .flat()
      .filter((m) => matchesQuery(m, needle))
      .sort((a, b) => b.sentAt - a.sentAt)
      .slice(0, limit)
  }

  async react(id: string, messageId: string, emoji: string): Promise<void> {
    const message = (this.messages.get(id) ?? []).find((m) => m.id === messageId)
    if (!message) throw new Error('Message not found')
    const mine = message.reactions.find((r) => r.byMe)
    let reactions = message.reactions.filter((r) => !(r.byMe && r.count === 1))
    if (mine && mine.count > 1) reactions = reactions.map((r) => (r === mine ? { ...r, count: r.count - 1, byMe: false } : r))
    if (!mine || mine.emoji !== emoji) {
      const existing = reactions.find((r) => r.emoji === emoji)
      if (existing) {
        existing.count += 1
        existing.byMe = true
      } else reactions.push({ emoji, count: 1, byMe: true })
    }
    message.reactions = reactions
    this.ctx.emit({ type: 'message:updated', message: { ...message } })
  }

  private ambientMessage(): void {
    const candidates = [...this.conversations.values()].filter((c) => (this.replies.get(c.id) ?? []).length > 0)
    if (!candidates.length) return
    const conversation = candidates[Math.floor(Math.random() * candidates.length)]
    const author = conversation.participants.filter((p) => !p.isMe)[0]
    const replies = this.replies.get(conversation.id)!
    this.ctx.emit({ type: 'typing', typing: { conversationId: conversation.id, peerName: author.name, isTyping: true } })
    this.schedule(2500, () => {
      this.ctx.emit({ type: 'typing', typing: { conversationId: conversation.id, peerName: author.name, isTyping: false } })
      this.incoming(conversation.id, author.id, author.name, replies[Math.floor(Math.random() * replies.length)])
    })
  }

  private incoming(id: string, senderId: string, senderName: string, text: string): void {
    const message: Message = {
      id: nextId('m'),
      conversationId: id,
      senderId,
      senderName,
      text,
      attachments: [],
      reactions: [],
      sentAt: Date.now(),
      isOutgoing: false,
      status: 'delivered'
    }
    const conversation = this.conversations.get(id)!
    conversation.unreadCount += 1
    this.append(message)
  }

  private append(message: Message): void {
    const list = this.messages.get(message.conversationId) ?? []
    list.push(message)
    this.messages.set(message.conversationId, list)
    const conversation = this.conversations.get(message.conversationId)!
    conversation.lastMessage = preview(message)
    conversation.updatedAt = message.sentAt
    this.ctx.emit({ type: 'message:new', message })
    this.ctx.emit({ type: 'conversation:upserted', conversation: { ...conversation } })
  }

  private setStatusOf(message: Message, status: Message['status']): Message {
    message.status = status
    return { ...message }
  }

  private setStatus(status: Account['status']): void {
    this.account.status = status
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }

  private schedule(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }
}

function preview(message: Message): Conversation['lastMessage'] {
  return {
    id: message.id,
    text: message.text,
    senderName: message.senderName,
    isOutgoing: message.isOutgoing,
    sentAt: message.sentAt
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
