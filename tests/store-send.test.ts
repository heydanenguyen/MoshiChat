import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, OutgoingAttachment } from '../src/shared/types'
import { DEFAULT_SETTINGS } from '../src/shared/types'

// The store is a renderer module: it reads localStorage and listens on window when it loads.
const bridgeSend = vi.fn()
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined, unison: { app: { platform: 'win32' }, messages: { send: bridgeSend } } })
const { useStore } = await import('../src/renderer/src/store')

const file: OutgoingAttachment = { path: 'C:/tmp/a.png', name: 'a.png', mime: 'image/png', size: 10 }
const quoted: Message = {
  id: 'm1',
  conversationId: 'c1',
  senderId: 'lan',
  senderName: 'Lan',
  text: 'trưa nay ăn gì?',
  attachments: [],
  reactions: [],
  sentAt: 1,
  isOutgoing: false,
  status: 'delivered'
}
const echo = (text: string): Message => ({ ...quoted, id: 'real-1', senderId: 'me', senderName: 'You', text, sentAt: Date.now(), isOutgoing: true })

const failedBubble = (): Message | undefined => useStore.getState().messages.c1?.find((m) => m.status === 'failed')

beforeEach(() => {
  bridgeSend.mockReset()
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS, sound: 'off' },
    conversations: {},
    messages: { c1: [quoted] },
    replyTos: { c1: quoted },
    pendingFiles: { c1: [file] },
    failedSends: {}
  })
})

describe('a failed send', () => {
  it('keeps what was sent with the failed bubble', async () => {
    bridgeSend.mockRejectedValueOnce(new Error('offline'))
    await useStore.getState().send('c1', ' phở nhé ')
    const failed = failedBubble()
    expect(failed).toBeDefined()
    expect(useStore.getState().pendingFiles.c1).toEqual([])
    expect(useStore.getState().replyTos.c1).toBeUndefined()
    expect(useStore.getState().failedSends[failed!.id]).toMatchObject({ text: 'phở nhé', files: [file], replyTo: { id: 'm1' } })
  })

  it('retrySend sends the same text, files and reply again and drops the failed bubble', async () => {
    bridgeSend.mockRejectedValueOnce(new Error('offline'))
    await useStore.getState().send('c1', 'phở nhé')
    const failed = failedBubble()!
    // Meanwhile the composer started replying to something else: the retry must not take or clear it.
    const other = { ...quoted, id: 'm2' }
    useStore.setState({ replyTos: { c1: other } })
    bridgeSend.mockResolvedValueOnce(echo('phở nhé'))
    await useStore.getState().retrySend('c1', failed.id)
    expect(bridgeSend).toHaveBeenCalledTimes(2)
    expect(bridgeSend.mock.calls[1]).toEqual(['c1', 'phở nhé', { replyToId: 'm1', attachments: [file] }])
    const ids = useStore.getState().messages.c1.map((m) => m.id)
    expect(ids).not.toContain(failed.id)
    expect(ids).toContain('real-1')
    expect(useStore.getState().failedSends[failed.id]).toBeUndefined()
    expect(useStore.getState().replyTos.c1).toBe(other)
  })

  it('keeps the picture preview, so the retried bubble shows it while it goes out again', async () => {
    const pasted = { ...file, preview: 'data:image/png;base64,AAAA' }
    useStore.setState({ pendingFiles: { c1: [pasted] } })
    bridgeSend.mockRejectedValueOnce(new Error('offline'))
    await useStore.getState().send('c1', '')
    const failed = failedBubble()!
    expect(useStore.getState().failedSends[failed.id].files).toEqual([pasted])
    let release: (m: Message) => void = () => undefined
    bridgeSend.mockReturnValueOnce(new Promise<Message>((resolve) => (release = resolve)))
    const retry = useStore.getState().retrySend('c1', failed.id)
    const sending = useStore.getState().messages.c1.find((m) => m.status === 'sending')
    expect(sending?.attachments[0].url).toBe(pasted.preview)
    release({ ...echo(''), attachments: [] })
    await retry
  })

  it('discardFailed removes the bubble and what was kept for it', async () => {
    bridgeSend.mockRejectedValueOnce(new Error('offline'))
    await useStore.getState().send('c1', 'phở nhé')
    const failed = failedBubble()!
    useStore.getState().discardFailed('c1', failed.id)
    expect(useStore.getState().messages.c1.map((m) => m.id)).toEqual(['m1'])
    expect(useStore.getState().failedSends).toEqual({})
    expect(bridgeSend).toHaveBeenCalledTimes(1)
  })
})
