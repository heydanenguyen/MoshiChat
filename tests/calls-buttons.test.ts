import { Script, runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { COLLECT_SCRIPT, THREAD_UI_SCRIPT, ZALO_HEADER_SCRIPT, ZALO_SEARCH_SCRIPT, headerMatches, normalizeName, pickCallButton, pickChatHit, pointScript, threadUiPresent, zaloHitsScript } from '../src/main/calls/buttons'

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
    for (const code of [COLLECT_SCRIPT, pointScript(3), ZALO_SEARCH_SCRIPT, ZALO_HEADER_SCRIPT, THREAD_UI_SCRIPT, zaloHitsScript('Nguyễn "Văn" A')]) expect(() => new Script(code)).not.toThrow()
  })

  it('carry the chat name as data, never as code', () => {
    expect(zaloHitsScript('"; alert(1); "')).toContain(JSON.stringify('"; alert(1); "'))
  })

  it('only ever select a numeric tag', () => {
    expect(pointScript(2.9)).toContain('data-moshi-call="2"')
  })
})

const hit = (...ids: string[]) => ({ x: 1, y: 2, ids })

describe('choosing the Zalo chat', () => {
  it('compares names without caring for case, spacing or how accents are composed', () => {
    expect(normalizeName('  Nguyễn   VĂN a ')).toBe(normalizeName('nguyễn văn A'))
  })

  it('takes the only hit, or the one that carries the thread id', () => {
    expect(pickChatHit([hit('x')], '77')).toEqual(hit('x'))
    expect(pickChatHit([hit('friend-item-12'), hit('friend-item-77')], '77')).toEqual(hit('friend-item-77'))
    expect(pickChatHit([hit('a', 'conv-77'), hit('b', 'conv-77')], '77')).toEqual(hit('a', 'conv-77'))
  })

  it('takes nobody when two people share the name and nothing tells them apart', () => {
    expect(pickChatHit([hit('friend-item-12'), hit('friend-item-13')], '77')).toBeUndefined()
    expect(pickChatHit([hit(), hit()], '')).toBeUndefined()
    expect(pickChatHit([], '77')).toBeUndefined()
  })

  it('does not take an id that only contains the thread id as part of a longer number', () => {
    expect(pickChatHit([hit('friend-item-1770'), hit('friend-item-9')], '77')).toBeUndefined()
  })

  it('wants the header to read exactly the chat that was meant', () => {
    expect(headerMatches(['Nguyễn Văn A', 'online'], 'nguyễn văn a')).toBe(true)
    expect(headerMatches(['Nguyễn Văn An'], 'Nguyễn Văn A')).toBe(false)
    expect(headerMatches(['Ai đó', 'x', 'y', 'z', 'Nguyễn Văn A'], 'Nguyễn Văn A')).toBe(false)
    expect(headerMatches([], 'A')).toBe(false)
    expect(headerMatches(['A'], ' ')).toBe(false)
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

describe('the Zalo hits script in a page', () => {
  const leaf = (text: string, id?: string) => ({
    children: { length: 0 },
    textContent: text,
    getBoundingClientRect: () => ({ left: 10, top: 5, width: 100, height: 20 }),
    getAttribute: (name: string) => (name === 'id' ? (id ?? null) : null),
    parentElement: null
  })

  it('finds the leaves whose text is the name, whatever the spacing, and reports their ids', () => {
    const document = { querySelectorAll: () => [leaf('  nguyễn   văn a ', 'friend-item-77'), leaf('Someone else'), leaf('Nguyễn Văn A')] }
    const hits = runInNewContext(zaloHitsScript('Nguyễn Văn A'), { document, window: { innerWidth: 1000 } }) as Array<{ ids: string[] }>
    expect(hits.map((h) => h.ids)).toEqual([['friend-item-77'], []])
  })
})
