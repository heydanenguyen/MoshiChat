import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

// scripts/patch-deps.mjs (postinstall) must have fixed ws3-fca's retry after a 5xx from Facebook.
const req = createRequire(import.meta.url)
const { parseAndCheckLogin } = req('ws3-fca/src/utils/clients.js') as {
  parseAndCheckLogin: (ctx: object, http: object, retryCount?: number) => (data: object) => Promise<unknown>
}

describe('ws3-fca after a server error from Facebook', () => {
  it('sends the same request again instead of throwing on the header it reads', async () => {
    const post = vi.fn(async () => ({ statusCode: 200, body: { payload: 'ok' } }))
    const check = parseAndCheckLogin({ jar: { setCookie: () => undefined }, globalOptions: {} }, { post, postFormData: vi.fn() })
    const failed = {
      statusCode: 500,
      body: '',
      request: {
        uri: new URL('https://www.facebook.com/messaging/send/'),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        form: 'body=hay%20c%C3%B3%20th%E1%BB%83&thread_fbid=123'
      }
    }
    await check(failed)
    expect(post).toHaveBeenCalledOnce()
    const [url, , form] = post.mock.calls[0] as unknown as [string, unknown, Record<string, string>]
    expect(url).toBe('https://www.facebook.com/messaging/send/')
    expect(form).toEqual({ body: 'hay có thể', thread_fbid: '123' })
  }, 10_000)
})
