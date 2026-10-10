import { describe, expect, it } from 'vitest'
import { CALL_ORIGINS, PROBE_VERDICT_MS, callFeatureOf, isLoginPage, callPlatformOf, callUrl, onDomain, recordProbe, threadIdOf } from '../src/main/calls/target'

const account = (id: string, platform: 'messenger' | 'instagram' | 'zalo' | 'telegram', demo?: boolean, call?: 'none') =>
  ({ id, platform, demo, features: { reply: true, react: true, attachments: true, call } })

describe('call targets', () => {
  it('names the platform only for accounts that have a web session to call with', () => {
    expect(callPlatformOf(account('messenger:fb-1', 'messenger'))).toBe('messenger')
    expect(callPlatformOf(account('instagram:ig-9', 'instagram'))).toBe('instagram')
    expect(callPlatformOf(account('zalo:77', 'zalo'))).toBe('zalo')
    expect(callPlatformOf(account('zalo:relay-77', 'zalo'))).toBeUndefined()
    expect(callPlatformOf(account('messenger:12345', 'messenger'))).toBeUndefined()
    expect(callPlatformOf(account('demo-messenger', 'messenger', true))).toBeUndefined()
    expect(callPlatformOf(account('telegram:1', 'telegram'))).toBeUndefined()
  })

  it('takes the platform thread id from the conversation id', () => {
    expect(threadIdOf('messenger:fb-1/100023')).toBe('100023')
    expect(threadIdOf('instagram:ig-9/340282366841710300949128')).toBe('340282366841710300949128')
    expect(threadIdOf('zalo:77/g/5')).toBe('g/5')
  })

  it('builds the page that holds the chat', () => {
    expect(callUrl('messenger', '100023')).toBe('https://www.facebook.com/messages/t/100023')
    expect(callUrl('messenger', 'a b')).toBe('https://www.facebook.com/messages/t/a%20b')
    expect(callUrl('instagram', '340')).toBe('https://www.instagram.com/direct/t/340/')
    expect(callUrl('zalo', 'whatever')).toBe('https://chat.zalo.me/')
  })

  it('matches only https pages on a domain or its subdomains', () => {
    expect(onDomain('https://www.facebook.com/messages', ['facebook.com'])).toBe(true)
    expect(onDomain('https://facebook.com/', ['facebook.com'])).toBe(true)
    expect(onDomain('http://www.facebook.com/', ['facebook.com'])).toBe(false)
    expect(onDomain('https://evilfacebook.com/', ['facebook.com'])).toBe(false)
    expect(onDomain('https://facebook.com.evil.io/', ['facebook.com'])).toBe(false)
    expect(onDomain('not a url', ['facebook.com'])).toBe(false)
    expect(onDomain('https://chat.zalo.me/', CALL_ORIGINS)).toBe(true)
    expect(onDomain('https://id.zalo.me/', CALL_ORIGINS)).toBe(false)
  })
})

it('knows the pages shown to a signed-out session', () => {
  expect(isLoginPage('https://www.facebook.com/login/?next=%2Fmessages')).toBe(true)
  expect(isLoginPage('https://www.facebook.com/login.php')).toBe(true)
  expect(isLoginPage('https://www.facebook.com/checkpoint/1501092823525282/')).toBe(true)
  expect(isLoginPage('https://www.instagram.com/accounts/login/?next=/direct/')).toBe(true)
  expect(isLoginPage('https://www.facebook.com/messages/t/100023')).toBe(false)
  expect(isLoginPage('https://www.instagram.com/direct/t/340/')).toBe(false)
  expect(isLoginPage('about:blank')).toBe(false)
})

describe('Instagram call probe', () => {
  it('counts misses and resets on a hit', () => {
    const one = recordProbe(undefined, false, 1)
    const two = recordProbe(one, false, 2)
    expect(two).toEqual({ misses: 2, at: 2 })
    expect(recordProbe(two, true, 3)).toEqual({ misses: 0, at: 3 })
  })

  it('hides the buttons after three misses, shows them again after a hit', () => {
    const ig = account('instagram:ig-9', 'instagram')
    expect(callFeatureOf(ig, undefined)).toBe('both')
    expect(callFeatureOf(ig, { misses: 2, at: 1 }, 2)).toBe('both')
    expect(callFeatureOf(ig, { misses: 3, at: 1 }, 2)).toBe('none')
    expect(callFeatureOf(ig, { misses: 0, at: 2 }, 3)).toBe('both')
  })

  it('forgets the verdict after a week, so the buttons come back and the web app is asked again', () => {
    const ig = account('instagram:ig-9', 'instagram')
    const none = { misses: 3, at: 1000 }
    expect(callFeatureOf(ig, none, 1000 + PROBE_VERDICT_MS - 1)).toBe('none')
    expect(callFeatureOf(ig, none, 1000 + PROBE_VERDICT_MS)).toBe('both')
  })

  it('starts counting again from one after the verdict expired', () => {
    expect(recordProbe({ misses: 3, at: 1000 }, false, 1000 + PROBE_VERDICT_MS)).toEqual({ misses: 1, at: 1000 + PROBE_VERDICT_MS })
    expect(recordProbe({ misses: 2, at: 1000 }, false, 2000).misses).toBe(3)
  })

  it('offers calls on Messenger and Zalo, and leaves other accounts as their adapter set them', () => {
    expect(callFeatureOf(account('messenger:fb-1', 'messenger'), undefined)).toBe('both')
    expect(callFeatureOf(account('zalo:77', 'zalo'), undefined)).toBe('both')
    expect(callFeatureOf(account('demo-zalo', 'zalo', true, 'none'), undefined)).toBe('none')
    expect(callFeatureOf(account('telegram:1', 'telegram'), undefined)).toBeUndefined()
  })
})
