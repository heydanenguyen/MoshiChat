import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

import { scanFrame } from '../src/main/instagram-realtime'

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

describe('scanFrame', () => {
  it('finds Slide mutations inside base64 blobs with JSON-escaped slashes', () => {
    const inner = JSON.stringify({ data: [{ __isSlideUQPPMutationWithThreadKey: 'SlideUQPPNewMessage', thread_fbid: '1' }], pad: 'x'.repeat(80) })
    const escaped = b64(inner).replace(/\//g, '\\/')
    const envelope = Buffer.concat([Buffer.from([0x30, 0x7f]), Buffer.from(`{"payload":"${escaped}"}`, 'latin1')])
    const scan = scanFrame({ opcode: 2, payloadData: envelope.toString('base64') })
    expect([...scan.kinds]).toEqual(['NewMessage'])
  })

  it('finds read receipts in plain text frames', () => {
    const scan = scanFrame({ opcode: 1, payloadData: '{"x":"SlideUQPPReadReceipt"}' })
    expect(scan.kinds.has('ReadReceipt')).toBe(true)
    expect(scan.kinds.has('NewMessage')).toBe(false)
  })

  it('parses typing patches with the REST thread id', () => {
    const value = JSON.stringify({ timestamp: 1, sender_id: '42', ttl: 12000, activity_status: 1 })
    const patch = JSON.stringify({ event: 'patch', data: [{ op: 'add', path: '/direct_v2/threads/340282366841710300949128/activity_indicator_id/abc', value }] })
    const scan = scanFrame({ opcode: 1, payloadData: patch })
    expect(scan.typing).toEqual([{ threadId: '340282366841710300949128', senderId: '42', typing: true }])
  })

  it('ignores unrelated frames', () => {
    const scan = scanFrame({ opcode: 1, payloadData: '{"hello":"world"}' })
    expect(scan.kinds.size).toBe(0)
    expect(scan.typing).toEqual([])
  })
})
