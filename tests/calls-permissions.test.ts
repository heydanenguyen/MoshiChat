import { describe, expect, it } from 'vitest'
import { permissionAllowed } from '../src/main/calls/permissions'

const ask = (permission: string, over: Partial<Parameters<typeof permissionAllowed>[0]> = {}) =>
  permissionAllowed({ permission, url: 'https://www.facebook.com/messages/t/1', ownCall: true, isAppPage: false, ...over })

describe('permission decisions', () => {
  it('lets a call origin use the camera and microphone only in the own pages of a call', () => {
    for (const url of ['https://www.facebook.com/messages/t/1', 'https://www.messenger.com/call', 'https://www.instagram.com/direct/t/2/', 'https://chat.zalo.me/']) {
      expect(ask('media', { url })).toBe(true)
      expect(ask('media', { url, ownCall: false })).toBe(false)
    }
  })

  it('refuses media to a page that is not part of the call, even on a call site', () => {
    expect(ask('media', { ownCall: false })).toBe(false)
  })

  it('refuses media to any other site, even during a call', () => {
    expect(ask('media', { url: 'https://evil.example/' })).toBe(false)
    expect(ask('media', { url: 'https://facebook.com.evil.example/' })).toBe(false)
    expect(ask('media', { url: 'http://www.facebook.com/' })).toBe(false)
    expect(ask('media', { url: 'https://id.zalo.me/' })).toBe(false)
  })

  it('also lets a call page pick its speakers', () => {
    expect(ask('speaker-selection')).toBe(true)
    expect(ask('speaker-selection', { ownCall: false })).toBe(false)
  })

  it('never shares the screen, and denies the rest to web pages', () => {
    expect(ask('display-capture')).toBe(false)
    expect(ask('display-capture', { isAppPage: true })).toBe(false)
    for (const permission of ['geolocation', 'notifications', 'midi', 'hid', 'usb', 'serial', 'clipboard-read', 'unknown']) expect(ask(permission)).toBe(false)
    expect(ask('fullscreen')).toBe(true)
    expect(ask('clipboard-sanitized-write', { ownCall: false })).toBe(true)
  })

  it('leaves Moshi\'s own page as free as it was (voice messages, paste, full screen)', () => {
    for (const permission of ['media', 'clipboard-read', 'fullscreen', 'notifications']) expect(ask(permission, { isAppPage: true, ownCall: false, url: 'file:///app/index.html' })).toBe(true)
  })
})
