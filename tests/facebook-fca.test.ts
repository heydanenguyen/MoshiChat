import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { withOwnFca } = await import('../src/main/adapters/facebook-personal')
const { browserUserAgent } = await import('../src/main/user-agent')

const req = createRequire(import.meta.url)
const root = join(dirname(req.resolve('ws3-fca')), '..')
// The copy of ws3-fca's helpers that the sign-in just loaded (each sign-in gets a fresh one).
const helpers = (): { jar: object; userAgent: string } => {
  const axios = req(join(root, 'src/utils/axios.js')) as { getJar(): object }
  const headers = req(join(root, 'src/utils/headers.js')) as { getHeaders(url: string, options: object, ctx: object, custom: object): Record<string, string> }
  return { jar: axios.getJar(), userAgent: headers.getHeaders('https://www.facebook.com', {}, {}, {})['User-Agent'] }
}

describe('a ws3-fca copy per Facebook account', () => {
  it('gives every sign-in its own cookie jar, and the pinned browser identity', async () => {
    const first = await withOwnFca(async () => helpers())
    const second = await withOwnFca(async () => helpers())
    // Shared jars mixed two accounts' cookies: each would read the other's chats.
    expect(first.jar).not.toBe(second.jar)
    // A random user agent per request makes Facebook sign the session out.
    expect(first.userAgent).toBe(browserUserAgent())
    expect(second.userAgent).toBe(browserUserAgent())
  })
})

describe('ws3-fca sendMessage, as the adapter calls it', () => {
  // The adapter awaits sendMessage(message, threadID, replyToMessageID). A callback in the third place is taken
  // for the replied-to message and refused, outside any promise of ours ("reply was never sent" in the app).
  const make = req(join(root, 'src/deltas/apis/messaging/sendMessage.js')) as (f: object, api: object, ctx: object) => (m: unknown, t: unknown, r?: unknown) => Promise<{ messageID?: string }>
  const sent: Array<Record<string, unknown>> = []
  const defaultFuncs = {
    post: async (_url: string, _jar: unknown, form: Record<string, unknown>) => {
      sent.push(form)
      return { body: JSON.stringify({ payload: { actions: [{ thread_fbid: '42', message_id: 'mid.1', timestamp: 1 }] } }) }
    }
  }
  const send = make(defaultFuncs, {}, { userID: '7', jar: {}, globalOptions: {} })

  it('refuses a callback where the replied-to message goes', async () => {
    await expect(send({ body: 'hi' }, '42', () => undefined)).rejects.toThrow(/MessageID/)
  })
  it('takes the replied-to message id as a string', async () => {
    await send({ body: 'hi' }, '42', 'mid.0').catch(() => undefined)
    expect(sent.at(-1)?.replied_to_message_id).toBe('mid.0')
  })
})
