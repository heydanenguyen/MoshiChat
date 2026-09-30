import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))

import type { Account, BridgeEvent, Conversation, Message } from '../src/shared/types'
import { ALL_FEATURES } from '../src/shared/types'
import { previewKindOf } from '../src/shared/preview'
import { toggleReaction, withoutMine } from '../src/shared/reactions'
import { AccountManager } from '../src/main/adapters/manager'
import type { AdapterContext, PlatformAdapter } from '../src/main/adapters/types'
import { unsentCopy } from '../src/main/adapters/types'
import type { Storage } from '../src/main/storage'

/** Just enough of the encrypted store for the manager. */
const storage = (): Storage =>
  ({
    accounts: [],
    settings: { theme: 'system', language: 'vi', notifications: true, sendOnEnter: true },
    load: async () => undefined,
    setSettings: async () => ({ theme: 'system', language: 'vi', notifications: true, sendOnEnter: true }),
    upsertAccount: async () => undefined,
    removeAccount: async () => undefined,
    readSecret: () => undefined
  }) as unknown as Storage

const msg = (id: string, isOutgoing = true): Message => ({
  id,
  conversationId: 'fake:a/c1',
  senderId: isOutgoing ? 'me' : 'them',
  senderName: isOutgoing ? 'Me' : 'Them',
  text: `text ${id}`,
  attachments: [{ id: 'p', kind: 'image', url: 'x' }],
  reactions: [{ emoji: '❤️', count: 1, byMe: false }],
  replyTo: { id: 'r', senderName: 'Them', text: 'earlier' },
  sentAt: 5,
  isOutgoing,
  status: 'read'
})

/** Unsends by emitting the message as unsent, like the real adapters do. */
class Unsender implements PlatformAdapter {
  account: Account = { id: 'fake:a', platform: 'telegram', displayName: 'Fake', status: 'connected', features: ALL_FEATURES }
  constructor(private readonly ctx: AdapterContext) {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async listConversations(): Promise<Conversation[]> {
    return [{ id: 'fake:a/c1', accountId: 'fake:a', platform: 'telegram', title: 'c1', isGroup: false, participants: [], unreadCount: 0, updatedAt: 5, lastMessage: { id: 'm1', text: 'text m1', senderName: 'Me', isOutgoing: true, sentAt: 5 } }]
  }
  async fetchMessages(): Promise<Message[]> {
    return [msg('m1')]
  }
  async sendMessage(): Promise<Message> {
    return msg('m2')
  }
  async markRead(): Promise<void> {}
  async unsend(_id: string, messageId: string): Promise<void> {
    this.ctx.emit({ type: 'message:updated', message: unsentCopy(msg(messageId)) })
  }
}

describe('unsend', () => {
  it('keeps the message as unsent, with its words, media, reply and reactions gone', () => {
    const gone = unsentCopy(msg('m1'))
    expect(gone).toMatchObject({ id: 'm1', unsent: true, text: '', attachments: [], reactions: [], replyTo: undefined, sentAt: 5, isOutgoing: true })
    expect(previewKindOf(gone)).toBe('unsent')
  })

  it('goes through the adapter and turns the chat list preview into "message unsent"', async () => {
    const events: BridgeEvent[] = []
    const manager = new AccountManager(storage(), (e) => events.push(e), () => undefined)
    const adapter = new Unsender(manager['contextFor']('fake:a'))
    await manager.adoptPending('fake:a', adapter)
    await manager.fetchMessages('fake:a/c1')
    await manager.unsend('fake:a/c1', 'm1')
    const upserted = events.filter((e) => e.type === 'conversation:upserted').at(-1)
    expect(upserted?.type === 'conversation:upserted' && upserted.conversation.lastMessage).toMatchObject({ id: 'm1', text: '', kind: 'unsent' })
  })

  it('refuses where the platform cannot unsend', async () => {
    const manager = new AccountManager(storage(), () => undefined, () => undefined)
    const adapter = new Unsender(manager['contextFor']('fake:a'))
    adapter.account.features = { reply: true, react: true, attachments: true }
    await manager.adoptPending('fake:a', adapter)
    await expect(manager.unsend('fake:a/c1', 'm1')).rejects.toThrow('does not let you unsend')
  })
})

describe('reactions', () => {
  it('clicking my own reaction again takes it off; another person’s stays', () => {
    const start = [{ emoji: '❤️', count: 2, byMe: true }]
    expect(toggleReaction(start, '❤️')).toEqual([{ emoji: '❤️', count: 1, byMe: false }])
    expect(withoutMine(start)).toEqual([{ emoji: '❤️', count: 1, byMe: false }])
    expect(withoutMine([{ emoji: '👍', count: 1, byMe: true }])).toEqual([])
  })
})
