import { describe, expect, it, vi } from 'vitest'
import type { OutgoingAttachment } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

const { ZaloAdapter } = await import('../src/main/adapters/zalo')

const CDN = 'https://voice-aac.zdn.vn/abc/voice.m4a'

/** The adapter with a fake signed-in Zalo api (connect is skipped, as in zalo-missed.test.ts). */
function setup(over: Partial<Record<'uploadAttachment' | 'sendVoice' | 'sendMessage', (...args: unknown[]) => Promise<unknown>>> = {}) {
  const logs: string[] = []
  const ctx = { emit: () => undefined, log: (...args: unknown[]) => logs.push(args.join(' ')), dataDir: () => '', saveSecret: async () => undefined }
  const adapter = new ZaloAdapter({ id: 'zalo:me', platform: 'zalo', displayName: 'Me', status: 'connected' } as never, {}, ctx as never)
  const api = {
    uploadAttachment: vi.fn(over.uploadAttachment ?? (async () => [{ fileType: 'others', fileUrl: CDN, fileId: '9', fileName: 'voice.m4a' }])),
    sendVoice: vi.fn(over.sendVoice ?? (async () => ({ msgId: 'v1' }))),
    sendMessage: vi.fn(over.sendMessage ?? (async () => ({ message: null, attachment: [{ msgId: 'm1' }] })))
  }
  const internals = adapter as unknown as { api: unknown; meId: string; threadTypes: Map<string, number> }
  internals.api = api
  internals.meId = 'me-uid'
  internals.threadTypes.set('lan', 0)
  internals.threadTypes.set('team', 1)
  return { adapter, api, logs }
}

const voiceNote = (aac = true): OutgoingAttachment => ({
  path: 'C:/tmp/unison-voice-1.ogg',
  name: 'voice-1.ogg',
  mime: 'audio/ogg',
  size: 1200,
  voice: true,
  duration: 4,
  preview: 'data:audio/ogg;base64,AA==',
  alternates: aac ? [{ path: 'C:/tmp/unison-voice-1.m4a', mime: 'audio/mp4', size: 900 }] : undefined
})

describe('Zalo voice notes', () => {
  it('go out as a Zalo voice message: the AAC copy is uploaded, then sent by its CDN url', async () => {
    const { adapter, api } = setup()
    const message = await adapter.sendMessage('zalo:me/lan', '', { attachments: [voiceNote()] })
    expect(api.uploadAttachment).toHaveBeenCalledWith(['C:/tmp/unison-voice-1.m4a'], 'lan', 0)
    expect(api.sendVoice).toHaveBeenCalledWith({ voiceUrl: CDN }, 'lan', 0)
    expect(api.sendMessage).not.toHaveBeenCalled()
    expect(message.id).toBe('v1')
    expect(message.attachments).toEqual([{ id: 'v1-0', kind: 'audio', name: 'Voice message', size: 1200, url: 'data:audio/ogg;base64,AA==', duration: 4 }])
  })

  it('use the Opus file when there is no AAC copy, in groups too', async () => {
    const { adapter, api } = setup()
    await adapter.sendMessage('zalo:me/team', '', { attachments: [voiceNote(false)] })
    expect(api.uploadAttachment).toHaveBeenCalledWith(['C:/tmp/unison-voice-1.ogg'], 'team', 1)
    expect(api.sendVoice).toHaveBeenCalledWith({ voiceUrl: CDN }, 'team', 1)
  })

  it('fall back to sending the file (and say why) when Zalo refuses the voice message', async () => {
    const { adapter, api, logs } = setup({
      sendVoice: async () => {
        throw new Error('voice refused')
      }
    })
    const message = await adapter.sendMessage('zalo:me/lan', '', { attachments: [voiceNote()] })
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    expect((api.sendMessage.mock.calls[0][0] as { attachments: string[] }).attachments).toEqual(['C:/tmp/unison-voice-1.ogg'])
    expect(logs.some((l) => l.includes('zalo voice') && l.includes('voice refused'))).toBe(true)
    expect(message.id).toBe('m1')
    expect(message.attachments?.[0].kind).toBe('file')
  })

  it('fall back too when the upload gives no url', async () => {
    const { adapter, api } = setup({ uploadAttachment: async () => [] })
    await adapter.sendMessage('zalo:me/lan', '', { attachments: [voiceNote()] })
    expect(api.sendVoice).not.toHaveBeenCalled()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('Zalo GIFs and photos', () => {
  it('a picked GIF keeps the .gif, which zca-js sends as a native Zalo GIF (not a file, not the MP4 copy)', async () => {
    const { adapter, api } = setup()
    const gif: OutgoingAttachment = {
      path: 'C:/tmp/unison-gifs/abc.gif',
      name: 'party.gif',
      mime: 'image/gif',
      size: 50_000,
      preview: 'https://media.giphy.com/abc.gif',
      gif: true,
      alternates: [{ path: 'C:/tmp/unison-gifs/abc.mp4', mime: 'video/mp4', size: 20_000 }]
    }
    const message = await adapter.sendMessage('zalo:me/lan', '', { attachments: [gif] })
    expect(api.sendVoice).not.toHaveBeenCalled()
    expect(api.uploadAttachment).not.toHaveBeenCalled()
    expect((api.sendMessage.mock.calls[0][0] as { attachments: string[] }).attachments).toEqual(['C:/tmp/unison-gifs/abc.gif'])
    expect(message.attachments?.[0]).toMatchObject({ kind: 'image', url: 'https://media.giphy.com/abc.gif' })
  })

  it('a plain photo goes out unchanged', async () => {
    const { adapter, api } = setup()
    const photo: OutgoingAttachment = { path: 'C:/tmp/cat.jpg', name: 'cat.jpg', mime: 'image/jpeg', size: 3000, preview: 'data:image/jpeg;base64,AA==' }
    const message = await adapter.sendMessage('zalo:me/lan', 'look', { attachments: [photo] })
    expect(api.sendVoice).not.toHaveBeenCalled()
    expect(api.uploadAttachment).not.toHaveBeenCalled()
    expect(api.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ msg: 'look', attachments: ['C:/tmp/cat.jpg'] }), 'lan', 0)
    expect(message.attachments).toEqual([{ id: 'm1-0', kind: 'image', name: 'cat.jpg', size: 3000, url: 'data:image/jpeg;base64,AA==' }])
  })
})
