import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { OutgoingAttachment } from '../src/shared/types'
import type { AdapterContext } from '../src/main/adapters/types'

const dir = mkdtempSync(join(tmpdir(), 'moshi-wa-send-'))
const still = join(dir, 'still.webp')
const moving = join(dir, 'moving.webp')
const { stickerFiles } = vi.hoisted(() => ({ stickerFiles: vi.fn() }))
vi.mock('../src/main/adapters/zalo-photo-sticker', () => ({ photoStickerFiles: stickerFiles }))

const { WhatsAppAdapter } = await import('../src/main/adapters/whatsapp')

beforeAll(async () => {
  const dot = (colour: string): Promise<Buffer> =>
    sharp({ create: { width: 16, height: 16, channels: 4, background: colour } })
      .png()
      .toBuffer()
  await sharp(await dot('red')).webp().toFile(still)
  await sharp([await dot('red'), await dot('blue')], { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] })
    .toFile(moving)
})

function setup(): { send: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn>; adapter: InstanceType<typeof WhatsAppAdapter> } {
  stickerFiles.mockReset()
  const log = vi.fn()
  const ctx = { emit: () => undefined, log } as unknown as AdapterContext
  const adapter = new WhatsAppAdapter('whatsapp:1', { authDir: 'x' }, ctx)
  const send = vi.fn(async (jid: string) => ({ key: { remoteJid: jid, id: String(send.mock.calls.length), fromMe: true }, message: {} }))
  const internals = adapter as unknown as { sock: unknown; toMessage: (raw: { key: { id: string } }) => Promise<unknown> }
  internals.sock = { sendMessage: send }
  // The id says which platform message it was made from: 'm1' is the first send.
  internals.toMessage = async (raw) => ({ id: 'm' + raw.key.id, text: '' })
  return { send, log, adapter }
}

const file = (over: Partial<OutgoingAttachment>): OutgoingAttachment => ({ path: join(dir, 'x.png'), name: 'x.png', mime: 'image/png', size: 1, ...over })

describe('WhatsApp sending', () => {
  it('sends a sticker as a real WhatsApp sticker, the text after it', async () => {
    const { send, adapter } = setup()
    stickerFiles.mockResolvedValueOnce({ id: 'k', webp: still, png: join(dir, 'k.png'), width: 512, height: 512 })
    const sticker = file({ sticker: 'custom:abc' })
    await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', 'hello', { attachments: [sticker] })
    // exactly 512 x 512, drawn from the source, a moving one kept under WhatsApp's ~500 KB
    expect(stickerFiles).toHaveBeenCalledWith(sticker, { size: 512, fit: 'contain', maxBytes: 500_000 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][1]).toMatchObject({ sticker: { url: still }, isAnimated: false, width: 512, height: 512 })
    expect(send.mock.calls[0][1]).not.toHaveProperty('caption')
    expect(send.mock.calls[1][1]).toEqual({ text: 'hello' })
  })

  it('returns the sticker message carrying the caption, not the text message', async () => {
    const { adapter } = setup()
    stickerFiles.mockResolvedValueOnce({ id: 'k', webp: still, png: join(dir, 'k.png'), width: 512, height: 512 })
    const message = await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', 'hello', { attachments: [file({ sticker: 'custom:abc' })] })
    expect(message).toMatchObject({ id: 'm1', text: 'hello' })
  })

  it('a caption that fails after the sticker went out is logged, not thrown', async () => {
    const { send, log, adapter } = setup()
    stickerFiles.mockResolvedValueOnce({ id: 'k', webp: still, png: join(dir, 'k.png'), width: 512, height: 512 })
    const ok = send.getMockImplementation()!
    send.mockImplementationOnce(ok).mockRejectedValueOnce(new Error('offline'))
    const message = await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', 'hello', { attachments: [file({ sticker: 'custom:abc' })] })
    expect(message).toMatchObject({ id: 'm1', text: 'hello' })
    expect(send).toHaveBeenCalledTimes(2)
    expect(log.mock.calls.some((c) => /caption/.test(c.join(' ')) && /offline/.test(c.join(' ')))).toBe(true)
  })

  it('marks a moving sticker (a GIPHY one too) as animated, with no text message when there is no text', async () => {
    const { send, adapter } = setup()
    stickerFiles.mockResolvedValueOnce({ id: 'k', webp: moving, png: join(dir, 'k.png'), width: 180, height: 180 })
    await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', '', { attachments: [file({ sticker: 'giphy:g1', mime: 'image/gif', path: join(dir, 'g.gif') })] })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1]).toMatchObject({ sticker: { url: moving }, isAnimated: true })
  })

  it('says so in the log when a moving sticker had to go as a still', async () => {
    const { send, log, adapter } = setup()
    stickerFiles.mockResolvedValueOnce({ id: 'k', webp: still, png: join(dir, 'k.png'), width: 512, height: 512, still: true })
    await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', '', { attachments: [file({ sticker: 'giphy:heavy', mime: 'image/gif' })] })
    expect(send.mock.calls[0][1]).toMatchObject({ sticker: { url: still }, isAnimated: false })
    expect(log.mock.calls.some((c) => /still/.test(c.join(' ')) && /giphy:heavy/.test(c.join(' ')))).toBe(true)
  })

  it('sends the sticker on white as a photo, with the text as its caption, when it cannot be made', async () => {
    const { send, log, adapter } = setup()
    stickerFiles.mockRejectedValueOnce(new Error('sharp blew up'))
    const white = join(dir, 'x-white.png')
    await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', 'hello', { attachments: [file({ sticker: 'custom:abc', alternates: [{ path: white, mime: 'image/png', size: 1, role: 'opaque' }] })] })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1]).toEqual({ image: { url: white }, caption: 'hello' })
    expect(log.mock.calls.some((c) => /sharp blew up/.test(c.join(' ')))).toBe(true)
  })

  it('keeps a GIF with an MP4 copy as a looping video', async () => {
    const { send, adapter } = setup()
    const mp4 = join(dir, 'g.mp4')
    await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', 'lol', { attachments: [file({ gif: true, mime: 'image/gif', alternates: [{ path: mp4, mime: 'video/mp4', size: 1 }] })] })
    expect(send.mock.calls[0][1]).toMatchObject({ video: { url: mp4 }, gifPlayback: true, caption: 'lol' })
  })

  it('sends a plain picture as a photo with its caption', async () => {
    const { send, adapter } = setup()
    const photo = file({})
    await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', 'look', { attachments: [photo] })
    expect(send.mock.calls[0][1]).toMatchObject({ image: { url: photo.path }, caption: 'look' })
    expect(stickerFiles).not.toHaveBeenCalled()
  })

  it('sends a voice note with the type of the file it actually is', async () => {
    const { send, adapter } = setup()
    await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', '', { attachments: [file({ voice: true, mime: 'audio/ogg', path: join(dir, 'v.ogg'), duration: 3 })] })
    await adapter.sendMessage('whatsapp:1/a@s.whatsapp.net', '', { attachments: [file({ voice: true, mime: 'audio/mp4', path: join(dir, 'v.m4a'), duration: 3 })] })
    expect(send.mock.calls[0][1]).toMatchObject({ ptt: true, mimetype: 'audio/ogg; codecs=opus', seconds: 3 })
    expect(send.mock.calls[1][1]).toMatchObject({ ptt: true, mimetype: 'audio/mp4' })
  })
})
