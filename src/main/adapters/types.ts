import type { Account, AuthPromptKind, BridgeEvent, Conversation, Message, SendOptions } from '@shared/types'

/** Services the manager hands to every adapter. */
export interface AdapterContext {
  emit(event: BridgeEvent): void
  /** Ask the user for a phone number / code / password. Resolves with their answer. */
  requestAuth(kind: AuthPromptKind, message?: string): Promise<string>
  /**
   * Show (or refresh) a QR code for the user to scan. Returns the prompt id;
   * pass it again to replace the code in place. `onCancel` fires if the user
   * dismisses the sheet.
   */
  presentQr(dataUrl: string, note?: string, requestId?: string, onCancel?: () => void): string
  /** Update the note under a QR prompt without changing the code. */
  noteAuth(requestId: string, note: string): void
  dismissAuth(requestId: string): void
  /** Persist the adapter's secret material (session string, tokens, cookies). */
  saveSecret(secret: unknown): Promise<void>
  /** Directory for adapter-private files (WhatsApp signal keys). Created on demand. */
  dataDir(): string
  log(...args: unknown[]): void
}

export interface FetchMessagesOptions {
  limit: number
  beforeId?: string
}

/**
 * Every platform plugs into Unison through this interface. Adapters own the
 * network connection and translate platform objects into the shared model.
 */
export interface PlatformAdapter {
  readonly account: Account
  connect(): Promise<void>
  disconnect(): Promise<void>
  listConversations(): Promise<Conversation[]>
  fetchMessages(conversationId: string, options: FetchMessagesOptions): Promise<Message[]>
  sendMessage(conversationId: string, text: string, options?: SendOptions): Promise<Message>
  markRead(conversationId: string): Promise<void>
  setTyping?(conversationId: string): Promise<void>
  react?(conversationId: string, messageId: string, emoji: string): Promise<void>
}

export const conversationId = (accountId: string, externalId: string | number): string =>
  `${accountId}/${externalId}`

export const externalIdOf = (conversationId: string): string =>
  conversationId.slice(conversationId.indexOf('/') + 1)

export const mimeOf = (name: string): string => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    pdf: 'application/pdf',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    json: 'application/json'
  }
  return table[ext] ?? 'application/octet-stream'
}

export const describeAttachments = (attachments: Message['attachments']): string => {
  const first = attachments[0]
  if (!first) return ''
  switch (first.kind) {
    case 'image':
      return 'Photo'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Voice message'
    case 'sticker':
      return `${first.name ?? ''} Sticker`.trim()
    case 'link':
      return first.name ?? first.url ?? 'Link'
    default:
      return first.name ?? 'File'
  }
}

export const previewOf = (message: Message): Conversation['lastMessage'] => ({
  id: message.id,
  text: message.text || describeAttachments(message.attachments),
  senderName: message.senderName,
  isOutgoing: message.isOutgoing,
  sentAt: message.sentAt
})
