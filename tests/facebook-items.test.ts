import { describe, expect, it } from 'vitest'
import { mapFcaAttachment, mapFcaEvent } from '../src/main/adapters/facebook-items'

describe('mapFcaAttachment', () => {
  it('keeps sizes and durations', () => {
    expect(mapFcaAttachment({ type: 'photo', url: 'https://f/l.jpg', previewUrl: 'https://f/p.jpg', width: 1200, height: 900 }, 'a')).toMatchObject({ kind: 'image', width: 1200, height: 900 })
    expect(mapFcaAttachment({ type: 'video', url: 'https://f/v.mp4', previewUrl: 'https://f/p.jpg', duration: 15000 }, 'v')).toMatchObject({ kind: 'video', duration: 15 })
    expect(mapFcaAttachment({ type: 'audio', url: 'https://f/a.mp4', filename: 'audioclip-1.mp4', duration: 4200 }, 'x')).toMatchObject({ kind: 'audio', name: 'Voice message', duration: 4.2 })
  })

  it('turns shares into link previews, and Instagram/Facebook reels into post cards', () => {
    expect(mapFcaAttachment({ type: 'share', url: 'https://news.io/a', title: 'T', description: 'D', image: 'https://news.io/i.jpg' }, 's')).toMatchObject({ kind: 'link', name: 'T', caption: 'D', thumbnailUrl: 'https://news.io/i.jpg' })
    expect(mapFcaAttachment({ type: 'share', url: 'https://www.instagram.com/reel/abc/', image: 'https://i/r.jpg', source: 'cafe', playable: true }, 'r')).toMatchObject({ kind: 'post', reel: true, author: 'cafe' })
  })
})

describe('mapFcaEvent', () => {
  it('maps call logs to call notices', () => {
    expect(mapFcaEvent({ logMessageType: 'log:thread-call', logMessageData: { event: 'one_on_one_call_ended', call_duration: 125, is_video_call: true }, snippet: 'Video call' })).toEqual({ text: 'Video call', system: { kind: 'call', seconds: 125, audio: false } })
    expect(mapFcaEvent({ logMessageType: 'log:thread-call', logMessageData: { event: 'missed_call' }, snippet: 'Missed call' }).system.kind).toBe('missed_call')
  })

  it('shows other admin rows with Facebook’s own text', () => {
    expect(mapFcaEvent({ logMessageType: 'log:thread-color', snippet: 'Linh changed the theme' })).toEqual({ text: 'Linh changed the theme', system: { kind: 'event' } })
  })
})
