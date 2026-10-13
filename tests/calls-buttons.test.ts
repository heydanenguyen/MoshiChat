import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { COLLECT_SCRIPT, THREAD_UI_SCRIPT, pickCallButton, pointScript, threadUiPresent } from '../src/main/calls/buttons'

const labels = (...list: string[]) => list.map((label, id) => ({ id, label }))

describe('call button selection', () => {
  it('picks the video button for video and the voice one for audio', () => {
    const list = labels('Start a voice call', 'Start a video call')
    expect(pickCallButton(list, 'video')).toBe(1)
    expect(pickCallButton(list, 'audio')).toBe(0)
  })

  it('reads Instagram labels and Vietnamese ones', () => {
    expect(pickCallButton(labels('Audio call', 'Video call'), 'audio')).toBe(0)
    expect(pickCallButton(labels('Gọi thoại', 'Gọi video'), 'audio')).toBe(0)
    expect(pickCallButton(labels('Bắt đầu gọi thoại', 'Bắt đầu gọi video'), 'video')).toBe(1)
    expect(pickCallButton(labels('STR_CALL_VOICE', 'STR_CALL_VIDEO'), 'video')).toBe(1)
    expect(pickCallButton(labels('STR_CALL_VOICE', 'STR_CALL_VIDEO'), 'audio')).toBe(0)
  })

  it('never presses hang up, answer, call history or settings', () => {
    expect(pickCallButton(labels('End call', 'Call history', 'Join call', 'Answer call'), 'audio')).toBeUndefined()
    expect(pickCallButton(labels('Kết thúc cuộc gọi', 'Trả lời cuộc gọi', 'STR_CALL_END'), 'audio')).toBeUndefined()
    expect(pickCallButton(labels('End video call', 'Start a video call'), 'video')).toBe(1)
  })

  it('falls back to a lone plain "call" button for audio only', () => {
    expect(pickCallButton(labels('Call', 'Video call'), 'audio')).toBe(0)
    expect(pickCallButton(labels('Call', 'Phone call'), 'audio')).toBe(1)
    expect(pickCallButton(labels('Call', 'Call back'), 'audio')).toBeUndefined()
    expect(pickCallButton(labels('Call'), 'video')).toBeUndefined()
  })

  it('finds nothing when there are no call controls', () => {
    expect(pickCallButton([], 'audio')).toBeUndefined()
    expect(pickCallButton(labels('Send a like', 'Choose a file'), 'video')).toBeUndefined()
  })
})

describe('page scripts', () => {
  it('are valid JavaScript', () => {
    for (const code of [COLLECT_SCRIPT, pointScript(3), THREAD_UI_SCRIPT]) expect(() => new Script(code)).not.toThrow()
  })

  it('only ever select a numeric tag', () => {
    expect(pointScript(2.9)).toContain('data-moshi-call="2"')
  })
})

describe('what counts as an Instagram miss', () => {
  const url = 'https://www.instagram.com/direct/t/340/'
  it('counts only a thread page with its composer up', () => {
    expect(threadUiPresent(url, { composer: true }, '/direct/t/')).toBe(true)
  })

  it('does not count a slow page, an interstitial or a login page', () => {
    expect(threadUiPresent(url, { composer: false }, '/direct/t/')).toBe(false)
    expect(threadUiPresent(url, undefined, '/direct/t/')).toBe(false)
    expect(threadUiPresent('https://www.instagram.com/accounts/login/?next=/direct/t/340/', { composer: true }, '/direct/t/')).toBe(false)
    expect(threadUiPresent('https://www.instagram.com/direct/inbox/', { composer: true }, '/direct/t/')).toBe(false)
    expect(threadUiPresent('not a url', { composer: true }, '/direct/t/')).toBe(false)
  })
})
