import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import nodemailer, { type Transporter } from 'nodemailer'
import type { Account, AccountStatus, Attachment, Conversation, Message, Peer, SendOptions } from '@shared/types'
import { conversationId, externalIdOf, type AdapterContext, type FetchMessagesOptions, type PlatformAdapter } from './types'

/**
 * Gmail through its standard mail protocols: IMAP to read (with Gmail's own thread ids and search), SMTP to send.
 * Signs in with an app password (Google account > Security > App passwords; needs 2-step verification), so there is
 * no Google Cloud project or review. One Gmail thread is one conversation; replies go out in the same thread.
 */
export interface GmailSecret {
  email: string
  appPassword: string
}

/** What a message header tells us, kept per thread so a reply can address everyone and thread correctly. */
interface Header {
  uid: number
  threadId: string
  messageId?: string
  references: string[]
  subject: string
  from?: MessageAddressObject
  to: MessageAddressObject[]
  cc: MessageAddressObject[]
  date: number
  seen: boolean
}

/** Mail the inbox shows as conversations: the Primary tab and what I sent, the last three months. */
const INBOX_QUERY = 'newer_than:90d -category:promotions -category:social -category:updates -category:forums -in:chats'
const LIST_LIMIT = 400

export class GmailAdapter implements PlatformAdapter {
  readonly account: Account
  readonly selfReconnects = true as const
  private imap?: ImapFlow
  private smtp?: Transporter
  private allMail = '[Gmail]/All Mail'
  private headers = new Map<number, Header>()
  private threads = new Map<string, number[]>()
  /** Attachments of fetched messages, by `uid:index`, for Download and for opening. */
  private files = new Map<string, { mime: string; content: Buffer }>()
  /** Messages already handed to the app (what I just sent comes back through IDLE). */
  private delivered = new Set<number>()
  private closing = false
  private retry?: ReturnType<typeof setTimeout>

  constructor(
    initialId: string,
    private secret: GmailSecret,
    private ctx: AdapterContext
  ) {
    this.account = {
      id: initialId,
      platform: 'gmail',
      displayName: secret.email,
      handle: secret.email,
      status: 'disconnected',
      features: { reply: false, react: false, attachments: true, unsend: false }
    }
  }

  private get me(): string {
    return this.secret.email.toLowerCase()
  }

  async connect(): Promise<void> {
    this.closing = false
    this.setStatus('connecting')
    await this.imap?.logout().catch(() => undefined)
    const imap = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: this.secret.email, pass: this.secret.appPassword.replace(/\s+/g, '') },
      logger: false
    })
    try {
      await imap.connect()
    } catch (err) {
      const failed = (err as { authenticationFailed?: boolean }).authenticationFailed
      const message = failed ? 'Gmail did not accept this email and app password' : `Could not reach Gmail: ${(err as Error).message}`
      this.setStatus('error', message)
      throw new Error(message, { cause: err })
    }
    this.imap = imap
    const boxes = await imap.list()
    this.allMail = boxes.find((b) => b.specialUse === '\\All')?.path ?? this.allMail
    await imap.mailboxOpen(this.allMail, { readOnly: false })
    imap.on('exists', (info: { count: number; prevCount: number }) => void this.onExists(info.prevCount, info.count))
    imap.on('close', () => this.onClose())
    imap.on('error', (err: Error) => this.ctx.log('gmail imap error', err.message))

    this.smtp = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: this.secret.email, pass: this.secret.appPassword.replace(/\s+/g, '') }
    })

    this.account.id = `gmail:${this.me}`
    this.account.displayName = this.secret.email
    this.account.handle = this.secret.email
    await this.ctx.saveSecret(this.secret)
    this.setStatus('connected')
  }

  async disconnect(): Promise<void> {
    this.closing = true
    if (this.retry) clearTimeout(this.retry)
    await this.imap?.logout().catch(() => undefined)
    this.imap = undefined
    this.smtp?.close()
    this.setStatus('disconnected')
  }

  /** The connection dropped (sleep, network): come back on our own, a little later each time. */
  private onClose(delay = 5000): void {
    if (this.closing) return
    this.setStatus('connecting')
    this.retry = setTimeout(() => {
      this.connect().catch((err) => {
        this.ctx.log('gmail reconnect failed', (err as Error).message)
        this.onClose(Math.min(delay * 2, 5 * 60_000))
      })
    }, delay)
  }

  private client(): ImapFlow {
    if (!this.imap?.usable) throw new Error('Gmail is not connected')
    return this.imap
  }

  async listConversations(): Promise<Conversation[]> {
    const imap = this.client()
    const found = await imap.search({ gmraw: INBOX_QUERY }, { uid: true })
    const uids = (found || []).sort((a, b) => a - b).slice(-LIST_LIMIT)
    if (!uids.length) return []
    const rows = await imap.fetchAll(uids, { uid: true, envelope: true, flags: true, threadId: true, internalDate: true, headers: ['references'] }, { uid: true })
    for (const row of rows) this.remember(row)
    const conversations: Conversation[] = []
    for (const threadId of this.threads.keys()) {
      const conversation = this.toConversation(threadId)
      if (conversation) conversations.push(conversation)
    }
    return conversations
  }

  async fetchMessages(id: string, { limit, beforeId }: FetchMessagesOptions): Promise<Message[]> {
    const imap = this.client()
    const threadId = externalIdOf(id)
    const found = (await imap.search({ threadId }, { uid: true })) || []
    let uids = found.sort((a, b) => a - b)
    if (beforeId) uids = uids.filter((uid) => uid < Number(beforeId))
    uids = uids.slice(-limit)
    if (!uids.length) return []
    const rows = await imap.fetchAll(uids, { uid: true, envelope: true, flags: true, threadId: true, internalDate: true, headers: ['references'], source: true }, { uid: true })
    const messages: Message[] = []
    for (const row of rows.sort((a, b) => a.uid - b.uid)) {
      this.remember(row)
      this.delivered.add(row.uid)
      messages.push(await this.toMessage(row))
    }
    return messages
  }

  async sendMessage(id: string, text: string, options?: SendOptions): Promise<Message> {
    const smtp = this.smtp
    if (!smtp) throw new Error('Gmail is not connected')
    const threadId = externalIdOf(id)
    const thread = (this.threads.get(threadId) ?? []).map((uid) => this.headers.get(uid)!).filter(Boolean)
    const last = thread.at(-1)
    if (!last) throw new Error('This email thread is not loaded yet')
    // Reply to all: who wrote last and everyone else on it, never myself.
    const mine = (a?: MessageAddressObject): boolean => (a?.address ?? '').toLowerCase() === this.me
    const lastIsMine = mine(last.from)
    const to = (lastIsMine ? last.to : [last.from!, ...last.to]).filter((a) => a && !mine(a))
    const cc = last.cc.filter((a) => !mine(a) && !to.some((t) => t.address === a.address))
    const subject = /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`
    const references = [...last.references, ...(last.messageId ? [last.messageId] : [])]
    const info = await smtp.sendMail({
      from: { name: this.account.displayName === this.secret.email ? '' : this.account.displayName, address: this.secret.email },
      to: to.map((a) => ({ name: a.name ?? '', address: a.address ?? '' })),
      cc: cc.map((a) => ({ name: a.name ?? '', address: a.address ?? '' })),
      subject,
      text,
      inReplyTo: last.messageId,
      references,
      attachments: options?.attachments?.map((a) => ({ filename: a.name, path: a.path, contentType: a.mime }))
    })
    // Gmail files what was sent into All Mail at once: find it, so the bubble carries its real id.
    const uid = await this.findSent(info.messageId)
    const sentAt = Date.now()
    const message: Message = {
      id: uid ? String(uid) : `sent:${info.messageId}`,
      conversationId: id,
      senderId: this.me,
      senderName: this.account.displayName,
      text,
      attachments: (options?.attachments ?? []).map((a, i) => ({ id: `out:${i}`, kind: a.mime.startsWith('image/') ? 'image' : 'file', name: a.name, size: a.size, url: a.preview })),
      reactions: [],
      sentAt,
      isOutgoing: true,
      status: 'sent'
    }
    if (uid) this.delivered.add(uid)
    return message
  }

  private async findSent(messageId: string): Promise<number | undefined> {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 700))
      const found = await this.imap?.search({ header: { 'message-id': messageId } }, { uid: true }).catch(() => undefined)
      if (found && found.length) return found[found.length - 1]
    }
    return undefined
  }

  async markRead(id: string): Promise<void> {
    const imap = this.client()
    const unseen = (await imap.search({ threadId: externalIdOf(id), seen: false }, { uid: true })) || []
    if (unseen.length) await imap.messageFlagsAdd(unseen, ['\\Seen'], { uid: true })
    for (const uid of unseen) {
      const header = this.headers.get(uid)
      if (header) header.seen = true
    }
  }

  async downloadAttachment(_conversationId: string, messageId: string, attachmentId: string): Promise<string | undefined> {
    const file = this.files.get(`${messageId}:${attachmentId}`)
    return file ? `data:${file.mime};base64,${file.content.toString('base64')}` : undefined
  }

  /** New mail arrived while IDLE: hand over what belongs in the inbox. */
  private async onExists(prevCount: number, count: number): Promise<void> {
    if (count <= prevCount || !this.imap) return
    try {
      const rows = await this.imap.fetchAll(`${prevCount + 1}:${count}`, { uid: true, envelope: true, flags: true, threadId: true, internalDate: true, headers: ['references'], source: true })
      const fresh = rows.filter((r) => !this.delivered.has(r.uid))
      if (!fresh.length) return
      const wanted = new Set(
        (await this.imap.search({ uid: fresh.map((r) => r.uid).join(','), gmraw: '-category:promotions -category:social -category:updates -category:forums' }, { uid: true })) || []
      )
      for (const row of fresh) {
        if (!wanted.has(row.uid)) continue
        this.remember(row)
        this.delivered.add(row.uid)
        const message = await this.toMessage(row)
        const conversation = this.toConversation(String(row.threadId))
        if (conversation) this.ctx.emit({ type: 'conversation:upserted', conversation })
        this.ctx.emit({ type: 'message:new', message })
      }
    } catch (err) {
      this.ctx.log('gmail new mail failed', (err as Error).message)
    }
  }

  private remember(row: FetchMessageObject): void {
    if (!row.threadId) return
    const env = row.envelope
    const refs = row.headers?.toString('utf8').replace(/^references:\s*/i, '').split(/\s+/).filter((r) => r.startsWith('<')) ?? []
    this.headers.set(row.uid, {
      uid: row.uid,
      threadId: String(row.threadId),
      messageId: env?.messageId,
      references: refs,
      subject: env?.subject ?? '',
      from: env?.from?.[0],
      to: env?.to ?? [],
      cc: env?.cc ?? [],
      date: new Date(env?.date ?? row.internalDate ?? Date.now()).getTime(),
      seen: row.flags?.has('\\Seen') ?? true
    })
    const list = this.threads.get(String(row.threadId)) ?? []
    if (!list.includes(row.uid)) {
      list.push(row.uid)
      list.sort((a, b) => a - b)
      this.threads.set(String(row.threadId), list)
    }
  }

  private peerOf(a?: MessageAddressObject): Peer {
    const address = (a?.address ?? '').toLowerCase()
    return { id: address, name: a?.name || address, handle: address, isMe: address === this.me }
  }

  private toConversation(threadId: string): Conversation | undefined {
    const thread = (this.threads.get(threadId) ?? []).map((uid) => this.headers.get(uid)!).filter(Boolean)
    const last = thread.at(-1)
    if (!last) return undefined
    const people = new Map<string, Peer>()
    for (const h of thread) for (const a of [h.from, ...h.to, ...h.cc]) if (a?.address) people.set(a.address.toLowerCase(), this.peerOf(a))
    const others = [...people.values()].filter((p) => !p.isMe)
    const me: Peer = { id: this.me, name: this.account.displayName, handle: this.me, isMe: true }
    const title = others.length === 0 ? last.subject || this.me : others.length === 1 ? others[0].name : others.map((p) => p.name.split(' ')[0]).join(', ')
    const fromMe = (last.from?.address ?? '').toLowerCase() === this.me
    return {
      id: conversationId(this.account.id, threadId),
      accountId: this.account.id,
      platform: 'gmail',
      title,
      isGroup: others.length > 1,
      participants: [me, ...others],
      unreadCount: thread.filter((h) => !h.seen && (h.from?.address ?? '').toLowerCase() !== this.me).length,
      lastMessage: {
        id: String(last.uid),
        text: last.subject || '(no subject)',
        senderName: fromMe ? this.account.displayName : (last.from?.name || last.from?.address || ''),
        isOutgoing: fromMe,
        sentAt: last.date
      },
      updatedAt: last.date
    }
  }

  private async toMessage(row: FetchMessageObject): Promise<Message> {
    const header = this.headers.get(row.uid)
    const from = this.peerOf(header?.from)
    let parsed: ParsedMail | undefined
    try {
      if (row.source) parsed = await simpleParser(row.source)
    } catch (err) {
      this.ctx.log('gmail parse failed', (err as Error).message)
    }
    const thread = this.threads.get(header?.threadId ?? '') ?? []
    const first = thread[0] === row.uid
    const body = stripQuoted(parsed?.text ?? '')
    // The first mail of a thread opens with its subject, like the top of an email.
    const text = first && header?.subject ? `${header.subject}\n\n${body}`.trim() : body
    const attachments: Attachment[] = []
    parsed?.attachments.forEach((file, index) => {
      if (file.related && file.contentDisposition === 'inline') return
      const id = String(index)
      this.files.set(`${row.uid}:${id}`, { mime: file.contentType, content: file.content })
      const image = file.contentType.startsWith('image/')
      attachments.push({
        id,
        kind: image ? 'image' : 'file',
        name: file.filename ?? (image ? 'image' : 'file'),
        size: file.size,
        // Pictures small enough show in the bubble straight away; anything else opens on demand.
        url: image && file.size < 1_500_000 ? `data:${file.contentType};base64,${file.content.toString('base64')}` : undefined
      })
    })
    const isOutgoing = from.id === this.me
    return {
      id: String(row.uid),
      conversationId: conversationId(this.account.id, header?.threadId ?? String(row.threadId)),
      senderId: from.id,
      senderName: isOutgoing ? this.account.displayName : from.name,
      text,
      attachments,
      reactions: [],
      sentAt: header?.date ?? Date.now(),
      isOutgoing,
      status: isOutgoing ? 'sent' : header?.seen ? 'read' : 'delivered'
    }
  }

  private setStatus(status: AccountStatus, error?: string): void {
    this.account.status = status
    this.account.error = error
    this.ctx.emit({ type: 'account:updated', account: { ...this.account } })
  }
}

/** The new part of a reply: everything before the quoted mail ("On … wrote:", "> lines", a forwarded header). */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const cut = lines.findIndex(
    (line, i) =>
      /^On .+wrote:\s*$/i.test(line) ||
      /^Vào .+đã viết:\s*$/i.test(line) ||
      /^-{2,}\s*(Original Message|Forwarded message|Thư đã chuyển tiếp)\s*-{2,}/i.test(line) ||
      // Gmail sometimes breaks "On … <a@b.c>" and "wrote:" over two lines
      (/^On .+/i.test(line) && /wrote:\s*$/i.test(lines[i + 1] ?? '')) ||
      (/^>/.test(line) && lines.slice(i).every((l) => /^>/.test(l) || !l.trim()))
  )
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).join('\n')
  return kept.replace(/\n{3,}/g, '\n\n').trim()
}
