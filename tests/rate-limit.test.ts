import { describe, expect, it } from 'vitest'
import { FORWARD_LIMIT, SEND_LIMIT, SendLimiter } from '../src/main/rate-limit'

describe('SendLimiter', () => {
  it('lets a person send normally and stops bursts for a minute', () => {
    let now = 0
    const limiter = new SendLimiter(() => now)
    for (let i = 0; i < SEND_LIMIT.count; i++) {
      limiter.take('a')
      now += 1000
    }
    expect(() => limiter.take('a')).toThrow(/RATE_LIMIT_SEND/)
    expect(() => limiter.take('b')).not.toThrow()
    now += SEND_LIMIT.windowMs
    expect(() => limiter.take('a')).not.toThrow()
  })

  it('stops the same message going to many chats, but allows re-sends to the same chat', () => {
    let now = 0
    const limiter = new SendLimiter(() => now)
    for (let i = 0; i < FORWARD_LIMIT.targets; i++) {
      limiter.takeForward('a', 'm1', `chat-${i}`)
      now += 2000
    }
    expect(() => limiter.takeForward('a', 'm1', 'chat-0')).not.toThrow()
    expect(() => limiter.takeForward('a', 'm1', 'chat-new')).toThrow(/RATE_LIMIT_FORWARD/)
    expect(() => limiter.takeForward('a', 'm2', 'chat-new')).not.toThrow()
    now += FORWARD_LIMIT.windowMs
    expect(() => limiter.takeForward('a', 'm1', 'chat-new')).not.toThrow()
  })
})

describe('SendLimiter.release', () => {
  it('gives the slot back when the send did not happen', () => {
    const limiter = new SendLimiter(() => 0)
    for (let i = 0; i < SEND_LIMIT.count; i++) limiter.take('a')
    expect(() => limiter.take('a')).toThrow(/RATE_LIMIT_SEND/)
    limiter.release('a')
    expect(() => limiter.take('a')).not.toThrow()
    expect(() => limiter.take('a')).toThrow(/RATE_LIMIT_SEND/)
    // nothing taken: nothing to give back
    expect(() => limiter.release('never-sent')).not.toThrow()
  })
})
