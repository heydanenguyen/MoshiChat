import { describe, expect, it } from 'vitest'
import { mapIgItem, normaliseWaveform, type IgItem } from '../src/main/adapters/instagram-items'

const ctx = { mePk: '1', nameOf: (pk: string) => ({ '2': 'Linh' })[pk] }
const base = { item_id: 'i1', user_id: '2', timestamp: '1700000000000000' }
const still = { image_versions2: { candidates: [{ url: 'https://cdn/x.jpg', width: 720, height: 1280 }] } }

describe('mapIgItem', () => {
  it('turns a story reply into a story card plus the reply text', () => {
    const item: IgItem = { ...base, item_type: 'reel_share', reel_share: { type: 'reply', text: 'haha', reel_owner_id: '1', media: { ...still, media_type: 1 } } }
    const out = mapIgItem(item, ctx)
    expect(out.text).toBe('haha')
    expect(out.preview).toBe('story_reply')
    expect(out.attachments[0]).toMatchObject({ kind: 'story', label: 'story_reply', thumbnailUrl: 'https://cdn/x.jpg', expired: false })
    expect(out.attachments[0].author).toBeUndefined()
  })

  it('names the owner when the user replied to someone else’s story', () => {
    const item: IgItem = { ...base, user_id: '1', item_type: 'reel_share', reel_share: { type: 'reaction', text: '😍', reel_owner_id: '2', media: still } }
    const out = mapIgItem(item, ctx)
    expect(out.attachments[0]).toMatchObject({ label: 'story_reaction', author: 'Linh' })
    expect(out.text).toBe('😍')
  })

  it('marks stories that are gone', () => {
    const out = mapIgItem({ ...base, item_type: 'reel_share', reel_share: { type: 'mention' } }, ctx)
    expect(out.attachments[0]).toMatchObject({ kind: 'story', label: 'story_mention', expired: true })
  })

  it('reads shared posts from direct_media_share (the current field)', () => {
    const item: IgItem = { ...base, item_type: 'media_share', direct_media_share: { media: { ...still, code: 'ABC', product_type: 'clips', user: { username: 'cafe' } } } }
    const out = mapIgItem(item, ctx)
    expect(out.attachments[0]).toMatchObject({ kind: 'post', url: 'https://www.instagram.com/reel/ABC/', reel: true, author: 'cafe' })
    expect(out.preview).toBe('reel')
  })

  it('keeps voice waveforms and durations', () => {
    const item: IgItem = { ...base, item_type: 'voice_media', voice_media: { media: { audio: { audio_src: 'https://cdn/a.m4a', duration: 4200, waveform_data: [0.1, 0.5, 0.25] } } } }
    const out = mapIgItem(item, ctx)
    expect(out.attachments[0]).toMatchObject({ kind: 'audio', duration: 4.2, waveform: [0.2, 1, 0.5] })
  })

  it('maps videos with their duration and view-once photos that were opened', () => {
    const video = mapIgItem({ ...base, item_type: 'media', media: { ...still, media_type: 2, video_versions: [{ url: 'https://cdn/v.mp4' }], video_duration: 7 } }, ctx)
    expect(video.attachments[0]).toMatchObject({ kind: 'video', url: 'https://cdn/v.mp4', duration: 7 })
    const opened = mapIgItem({ ...base, item_type: 'raven_media', raven_media: { media_type: 1 } }, ctx)
    expect(opened.attachments[0]).toMatchObject({ kind: 'image', expired: true })
  })

  it('shows stickers, links with previews, calls and unsupported items', () => {
    expect(mapIgItem({ ...base, item_type: 'store_sticker', store_sticker: { image_url: 'https://cdn/s.webp', alt_text: 'cat' } }, ctx).attachments[0]).toMatchObject({ kind: 'sticker', name: 'cat' })
    const link = mapIgItem({ ...base, item_type: 'link', link: { text: 'see https://a.io', link_context: { link_url: 'https://a.io', link_title: 'A', link_summary: 'S', link_image_url: 'https://a.io/i.png' } } }, ctx)
    expect(link.attachments[0]).toMatchObject({ kind: 'link', name: 'A', caption: 'S', thumbnailUrl: 'https://a.io/i.png' })
    const call = mapIgItem({ ...base, item_type: 'video_call_event', video_call_event: { action: 'video_call_ended', call_duration: 95, did_join: true } }, ctx)
    expect(call.system).toEqual({ kind: 'call', seconds: 95, audio: false })
    expect(mapIgItem({ ...base, item_type: 'video_call_event', video_call_event: { action: 'video_call_started' } }, ctx).hidden).toBe(true)
    expect(mapIgItem({ ...base, item_type: 'placeholder', placeholder: { title: 'Use Latest App' } }, ctx).system).toEqual({ kind: 'unavailable' })
  })

  it('hides reaction logs but keeps real events', () => {
    expect(mapIgItem({ ...base, item_type: 'action_log', action_log: { description: 'Linh liked a message' } }, ctx).hidden).toBe(true)
    const event = mapIgItem({ ...base, item_type: 'action_log', action_log: { description: 'Linh changed the theme' } }, ctx)
    expect(event).toMatchObject({ text: 'Linh changed the theme', system: { kind: 'event' } })
  })

  it('falls back to XMA cards for newer share formats', () => {
    const out = mapIgItem({ ...base, item_type: 'xma_media_share', xma_media_share: [{ target_url: 'https://www.instagram.com/p/Z/', preview_url_info: { url: 'https://cdn/p.jpg' }, header_title_text: 'cafe' }] }, ctx)
    expect(out.attachments[0]).toMatchObject({ kind: 'post', author: 'cafe', thumbnailUrl: 'https://cdn/p.jpg' })
  })
})

describe('normaliseWaveform', () => {
  it('scales to 0..1 and ignores empty data', () => {
    expect(normaliseWaveform([2, 4])).toEqual([0.5, 1])
    expect(normaliseWaveform([])).toBeUndefined()
    expect(normaliseWaveform([0, 0])).toBeUndefined()
  })
})
