/**
 * Keeps sending at a human pace. The platforms restrict accounts that send in bursts or push the same
 * message to many people; a person typing never gets near these limits, so they only stop misuse.
 */
export const SEND_LIMIT = { count: 20, windowMs: 60_000 }
export const FORWARD_LIMIT = { targets: 5, windowMs: 10 * 60_000 }

/** Error codes the renderer translates; the message after the colon is the plain-English fallback. */
export const RATE_LIMIT_SEND = 'RATE_LIMIT_SEND'
export const RATE_LIMIT_FORWARD = 'RATE_LIMIT_FORWARD'

export class SendLimiter {
  private sends = new Map<string, number[]>()
  private forwards = new Map<string, Array<{ to: string; at: number }>>()

  constructor(private now: () => number = Date.now) {}

  /** Throws when this account has sent too many messages in the last minute; otherwise records the send. */
  take(accountId: string): void {
    const t = this.now()
    const recent = (this.sends.get(accountId) ?? []).filter((at) => t - at < SEND_LIMIT.windowMs)
    if (recent.length >= SEND_LIMIT.count) throw new Error(`${RATE_LIMIT_SEND}: Sending too fast, wait a minute before sending more`)
    recent.push(t)
    this.sends.set(accountId, recent)
  }

  /** Throws when the same message is being forwarded to too many different chats; otherwise records it. */
  takeForward(accountId: string, messageId: string, toConversationId: string): void {
    const t = this.now()
    const key = `${accountId}\n${messageId}`
    const recent = (this.forwards.get(key) ?? []).filter((f) => t - f.at < FORWARD_LIMIT.windowMs)
    const targets = new Set(recent.map((f) => f.to))
    if (!targets.has(toConversationId) && targets.size >= FORWARD_LIMIT.targets) {
      throw new Error(`${RATE_LIMIT_FORWARD}: This message was already forwarded to ${FORWARD_LIMIT.targets} chats, wait a while before forwarding it again`)
    }
    recent.push({ to: toConversationId, at: t })
    this.forwards.set(key, recent)
    this.take(accountId)
  }
}
