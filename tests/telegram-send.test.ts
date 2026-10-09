import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { OutgoingAttachment } from '../src/shared/types'
import type { AdapterContext } from '../src/main/adapters/types'

const dir = mkdtempSync(join(tmpdir(), 'moshi-tg-send-'))
const still = join(dir, 'still.webp')
const moving = join(dir, 'moving.webp')
const stillPng = join(dir, 'moving.png')
const movingStill = join(dir, 'moving-still.webp')
const { stickerFiles, stillOf } = vi.hoisted(() => ({ stickerFiles: vi.fn(), stillOf: vi.fn() }))
vi.mock('../src/main/adapters/zalo-photo-sticker', () => ({ photoStickerFiles: stickerFiles, stillWebp: stillOf }))

// Each TL class keeps what it was made with, so the test can read the attributes back.
vi.mock('telegram', () => {
  const tl = (name: string) =>
    class {
      className = name
      constructor(public args?: Record<string, unknown>) {}
    }
  const names = ['DocumentAttributeSticker', 'InputStickerSetEmpty', 'DocumentAttributeImageSize', 'DocumentAttributeVideo', 'DocumentAttributeAnimated', 'Message']
  return { Api: Object.fromEntries(names.map((n) => [n, tl(n)])), TelegramClient: class {} }
})
vi.mock('telegram/sessions', () => ({ StringSession: class {} }))
vi.mock('telegram/events', () => ({ NewMessage: class {}, NewMessageEvent: class {} }))
vi.mock('telegram/extensions/Logger', () => ({ LogLevel: { ERROR: 'error' } }))

const { TelegramAdapter } = await import('../src/main/adapters/telegram')

beforeAll(async () => {
  const dot = (colour: string): Promise<Buffer> =>
    sharp({ create: { width: 16, height: 16, channels: 4, background: colour } })
      .png()
      .toBuffer()
  await sharp(await dot('red')).webp().toFile(still)
  await sharp(await dot('red')).toFile(stillPng)
  await sharp(await dot('red')).webp().toFile(movingStill)
  await sharp([await dot('red'), await dot('blue')], { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] })
    .toFile(moving)
})

type Attr = { className: string; args?: Record<string, unknown> }

function setup(): { sendFile: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn>; adapter: InstanceType<typeof TelegramAdapter> } {
  stickerFiles.mockReset()
  stillOf.mockReset()
  stillOf.mockResolvedValue(movingStill)
  const log = vi.fn()
  const adapter = new TelegramAdapter('telegram:1', { apiId: 1, apiHash: 'h' }, { emit: () => undefined, log } as unknown as AdapterContext)
  const sendFile = vi.fn(async () => ({ id: 1 }))
  const sendText = vi.fn(async () => ({ id: 2 }))
  const internals = adapter as unknown as { client: unknown; entityFor: () => Promise<unknown>; toMessage: () => Promise<unknown> }
  internals.client = { sendFile, sendMessage: sendText }
  internals.entityFor = async () => ({ id: 'peer' })
  internals.toMessage = async () => ({ id: 'm' })
  return { sendFile, sendText, log, adapter }
}

const file = (over: Partial<OutgoingAttachment>): OutgoingAttachment => ({ path: join(dir, 'x.png'), name: 'x.png', mime: 'image/png', size: 1, ...over })
const attrs = (call: unknown[]): Attr[] => ((call[1] as { attributes?: Attr[] }).attributes ?? []) as Attr[]

describe('Telegram sending', () => {
  it('sends a sticker as a WebP document with the sticker attribute, the text after it', async () => {
    const { sendFile, sendText, adapter } = setup()
    stickerFiles.mockResolvedValueOnce({ id: 'k', webp: still, png: join(dir, 'k.png'), width: 512, height: 341 })
    const sticker = file({ sticker: 'custom:abc' })
    await adapter.sendMessage('telegram:1/5', 'hello', { attachments: [sticker], replyToId: '9' })
    // 512 on the longest side, from the source: the Zalo-sized copy is never stretched
    expect(stickerFiles).toHaveBeenCalledWith(sticker, { size: 512, fit: 'inside' })
    expect(sendFile).toHaveBeenCalledTimes(1)
    const options = sendFile.mock.calls[0][1] as Record<string, unknown>
    expect(options).toMatchObject({ file: still, replyTo: 9 })
    expect(options.caption).toBeUndefined()
    // forceDocument would set force_file (gramjs: .webp is not an "image" to it), asking for a plain file instead.
    expect(options.forceDocument).toBeFalsy()
    expect(attrs(sendFile.mock.calls[0]).map((a) => a.className)).toContain('DocumentAttributeSticker')
    expect(attrs(sendFile.mock.calls[0]).find((a) => a.className === 'DocumentAttributeSticker')?.args?.stickerset).toMatchObject({ className: 'InputStickerSetEmpty' })
    expect(sendText).toHaveBeenCalledWith({ id: 'peer' }, { message: 'hello' })
  })

  it('tells Telegram the sticker size', async () => {
    const { sendFile, adapter } = setup()
    stickerFiles.mockResolvedValueOnce({ id: 'k', webp: still, png: join(dir, 'k.png'), width: 512, height: 341 })
    await adapter.sendMessage('telegram:1/5', '', { attachments: [file({ sticker: 'custom:abc' })] })
    expect(attrs(sendFile.mock.calls[0]).find((a) => a.className === 'DocumentAttributeImageSize')?.args).toEqual({ w: 512, h: 341 })
  })

  it('sends the sticker on white as a photo, with the text as its caption, when it cannot be made', async () => {
    const { sendFile, sendText, log, adapter } = setup()
    stickerFiles.mockRejectedValueOnce(new Error('sharp blew up'))
    const white = join(dir, 'x-white.png')
    await adapter.sendMessage('telegram:1/5', 'hello', { attachments: [file({ sticker: 'custom:abc', alternates: [{ path: white, mime: 'image/png', size: 1, role: 'opaque' }] })], replyToId: '9' })
    expect(sendFile).toHaveBeenCalledTimes(1)
    expect(sendFile.mock.calls[0][1]).toMatchObject({ file: white, caption: 'hello', replyTo: 9 })
    expect(attrs(sendFile.mock.calls[0])).toEqual([])
    expect(sendText).not.toHaveBeenCalled()
    expect(log.mock.calls.some((c) => /sharp blew up/.test(c.join(' ')))).toBe(true)
  })

  it('sends a moving sticker as a still WebP of its first frame, saying so once', async () => {
    const { sendFile, sendText, log, adapter } = setup()
    stickerFiles.mockResolvedValue({ id: 'k', webp: moving, png: stillPng, width: 512, height: 512 })
    await adapter.sendMessage('telegram:1/5', '', { attachments: [file({ sticker: 'giphy:g1', mime: 'image/gif' })] })
    await adapter.sendMessage('telegram:1/5', '', { attachments: [file({ sticker: 'giphy:g1', mime: 'image/gif' })] })
    const sent = (sendFile.mock.calls[0][1] as { file: string }).file
    expect(stillOf).toHaveBeenCalledWith(stillPng)
    expect(sent).toBe(movingStill)
    expect((await sharp(sent).metadata()).pages ?? 1).toBe(1)
    expect(attrs(sendFile.mock.calls[0]).map((a) => a.className)).toContain('DocumentAttributeSticker')
    expect(sendText).not.toHaveBeenCalled()
    expect(log.mock.calls.filter((c) => /still/i.test(String(c[0])))).toHaveLength(1)
  })

  it('keeps a GIF with an MP4 copy as an animation', async () => {
    const { sendFile, adapter } = setup()
    const mp4 = join(dir, 'g.mp4')
    await adapter.sendMessage('telegram:1/5', 'lol', { attachments: [file({ gif: true, mime: 'image/gif', alternates: [{ path: mp4, mime: 'video/mp4', size: 1 }] })] })
    expect(sendFile.mock.calls[0][1]).toMatchObject({ file: mp4, caption: 'lol' })
    expect(attrs(sendFile.mock.calls[0]).map((a) => a.className)).toContain('DocumentAttributeAnimated')
    expect(stickerFiles).not.toHaveBeenCalled()
  })

  it('sends a voice note as one', async () => {
    const { sendFile, adapter } = setup()
    const voice = file({ voice: true, mime: 'audio/ogg', path: join(dir, 'v.ogg') })
    await adapter.sendMessage('telegram:1/5', '', { attachments: [voice] })
    expect(sendFile.mock.calls[0][1]).toMatchObject({ file: voice.path, voiceNote: true, forceDocument: false })
  })
})
