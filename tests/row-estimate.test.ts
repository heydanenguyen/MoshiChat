import { describe, expect, it } from 'vitest'
import type { Message } from '../src/shared/types'
import { estimateRun } from '../src/renderer/src/rowEstimate'

const msg = (over: Partial<Message>): Message =>
  ({ id: String(Math.random()), conversationId: 'c', senderId: 'x', senderName: 'Lan', text: '', attachments: [], reactions: [], sentAt: 0, isOutgoing: false, status: 'sent', ...over }) as Message

// Heights measured in the app at a 1200 × 800 window (rows of four messages from one sender, and single ones).
describe('row height estimates', () => {
  it('lands within a few pixels of the drawn rows', () => {
    const short = msg({ text: 'Ok anh nhé' })
    const sticker = msg({ attachments: [{ id: 'a', kind: 'sticker' }] })
    const photo = msg({ attachments: [{ id: 'b', kind: 'image', width: 400, height: 300 }] })
    const tall = msg({ attachments: [{ id: 'c', kind: 'image', width: 300, height: 500 }] })
    const reply = msg({ text: 'Ok anh nhé', replyTo: { id: 'x', senderName: 'Lan', text: 'Chiều nay gặp nhé' } })
    const near = (estimate: number, drawn: number): void => expect(Math.abs(estimate - drawn)).toBeLessThanOrEqual(12)
    near(estimateRun([short]), 47)
    near(estimateRun([short, short, short, short]), 164)
    near(estimateRun([sticker]), 130)
    near(estimateRun([sticker, sticker, sticker, sticker]), 496)
    near(estimateRun([photo]), 226)
    near(estimateRun([tall]), 356)
    near(estimateRun([photo, photo, photo, photo]), 310)
    near(estimateRun([reply]), 91)
  })
})
