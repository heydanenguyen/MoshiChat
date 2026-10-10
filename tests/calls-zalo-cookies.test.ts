import { describe, expect, it } from 'vitest'
import { zaloSessionCookies } from '../src/main/calls/zalo-cookies'

const NOW = Date.parse('2026-10-10T00:00:00Z')

describe('Zalo cookies for the call window', () => {
  it('converts browser-style cookies', () => {
    const [cookie] = zaloSessionCookies(
      [{ name: 'zpsid', value: 'abc', domain: '.zalo.me', path: '/', secure: true, httpOnly: true, hostOnly: false, expirationDate: NOW / 1000 + 3600, sameSite: 'no_restriction' }],
      NOW
    )
    expect(cookie).toEqual({
      url: 'https://zalo.me/',
      name: 'zpsid',
      value: 'abc',
      domain: '.zalo.me',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: NOW / 1000 + 3600,
      sameSite: 'no_restriction'
    })
  })

  it('converts tough-cookie entries (key, ISO expiry, host-only)', () => {
    const list = zaloSessionCookies(
      [
        { key: 'zpw_sek', value: 'v', domain: 'chat.zalo.me', path: '/x', httpOnly: true, hostOnly: true, expires: '2027-01-01T00:00:00.000Z' },
        { key: 'sess', value: '1', domain: 'zalo.me', expires: 'Infinity' }
      ],
      NOW
    )
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ name: 'zpw_sek', url: 'https://chat.zalo.me/x', domain: undefined, expirationDate: Date.parse('2027-01-01T00:00:00Z') / 1000 })
    expect(list[1]).toMatchObject({ name: 'sess', domain: '.zalo.me', path: '/', expirationDate: undefined })
  })

  it('accepts the { url, cookies } wrapper', () => {
    expect(zaloSessionCookies({ url: 'https://chat.zalo.me', cookies: [{ name: 'a', value: 'b', domain: 'chat.zalo.me' }] }, NOW)).toHaveLength(1)
  })

  it('leaves out expired cookies, nameless ones and other sites', () => {
    const list = zaloSessionCookies(
      [
        { name: 'old', value: '1', domain: '.zalo.me', expirationDate: NOW / 1000 - 5 },
        { name: '', value: '1', domain: '.zalo.me' },
        { name: 'evil', value: '1', domain: '.zalo.me.evil.io' },
        { name: 'fb', value: '1', domain: '.facebook.com' },
        null,
        'x',
        { name: 'ok', value: '1', domain: '.zaloapp.com' }
      ],
      NOW
    )
    expect(list.map((c) => c.name)).toEqual(['ok'])
  })

  it('gives nothing for something that is not a cookie list', () => {
    expect(zaloSessionCookies(undefined)).toEqual([])
    expect(zaloSessionCookies({ cookies: 5 })).toEqual([])
  })
})
