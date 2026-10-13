import { describe, expect, it } from 'vitest'
import { findImage, giphyOf, mapSlideNode, shapeOf, slideNodesOf } from '../src/main/adapters/instagram-slide'

describe('mapSlideNode', () => {
  it('maps photos with their CDN urls and size', () => {
    const out = mapSlideNode(
      {
        message_id: 'mid.1',
        content: {
          __typename: 'SlideMessageImageContent',
          attachments: [{ attachment_type: 2, attachment_cdn_url: 'https://cdn/full.jpg', preview_cdn_url: 'https://cdn/small.jpg', preview_width: 1080, preview_height: 1350 }]
        }
      },
      'i1'
    )
    expect(out.preview).toBe('photo')
    expect(out.attachments[0]).toMatchObject({ kind: 'image', url: 'https://cdn/full.jpg', thumbnailUrl: 'https://cdn/small.jpg', width: 1080, height: 1350 })
  })

  it('maps videos and voice notes, reading duration and waveform fields', () => {
    const video = mapSlideNode({ content: { __typename: 'SlideMessageVideosContent', attachments: [{ attachment_cdn_url: 'https://cdn/v.mp4', preview_cdn_url: 'https://cdn/p.jpg', playable_duration_ms: 12000 }] } }, 'v')
    expect(video.attachments[0]).toMatchObject({ kind: 'video', url: 'https://cdn/v.mp4', thumbnailUrl: 'https://cdn/p.jpg', duration: 12 })
    const voice = mapSlideNode({ content: { __typename: 'SlideMessageAudiosContent', attachments: [{ attachment_cdn_url: 'https://cdn/a.m4a', audio_waveform: [1, 2, 4] }] } }, 'a')
    expect(voice.preview).toBe('voice')
    expect(voice.attachments[0]).toMatchObject({ kind: 'audio', url: 'https://cdn/a.m4a', waveform: [0.25, 0.5, 1] })
  })

  it('reads videos from the videos list (SlideMessageVideosContent)', () => {
    const out = mapSlideNode({ content: { __typename: 'SlideMessageVideosContent', videos: [{ attachment_cdn_url: 'https://cdn/v.mp4', preview_cdn_url: 'https://cdn/p.jpg', preview_width: 720, preview_height: 1280 }] } }, 'v2')
    expect(out.preview).toBe('video')
    expect(out.attachments[0]).toMatchObject({ kind: 'video', url: 'https://cdn/v.mp4', thumbnailUrl: 'https://cdn/p.jpg', width: 720, height: 1280 })
  })

  it('maps shared stories and posts from XMA cards, and text', () => {
    const story = mapSlideNode({ content: { __typename: 'SlideMessageXMAContent', xma: { target_url: 'https://www.instagram.com/stories/cafe/1/', preview_image: { url: 'https://cdn/s.jpg' }, header_title_text: 'cafe' } } }, 's')
    expect(story.attachments[0]).toMatchObject({ kind: 'story', label: 'story_share', author: 'cafe' })
    const post = mapSlideNode({ content: { __typename: 'SlideMessageXMAContent', xma: { target_url: 'https://www.instagram.com/reel/X/', preview_image: { url: 'https://cdn/r.jpg' } } } }, 'p')
    expect(post.attachments[0]).toMatchObject({ kind: 'post', reel: true })
    expect(mapSlideNode({ content: { __typename: 'SlideMessageText', text_body: 'hi' } }, 't')).toMatchObject({ text: 'hi', attachments: [] })
  })

  it('finds a sticker image under field names it has not seen, moving copy first', () => {
    const out = mapSlideNode(
      {
        content: {
          __typename: 'SlideMessageStickerContent',
          sticker: {
            sender: { profile_pic_url: 'https://scontent.cdninstagram.com/me.jpg' },
            image: { uri: 'https://scontent.fbcdn.net/still.png', width: 240, height: 240 },
            animated_image: { uri: 'https://scontent.fbcdn.net/moving.webp', width: 240, height: 240 }
          }
        }
      },
      'k'
    )
    expect(out.preview).toBe('sticker')
    expect(out.attachments[0]).toMatchObject({ kind: 'sticker', url: 'https://scontent.fbcdn.net/moving.webp', width: 240, height: 240 })
  })

  it('shows the picture of an unknown kind instead of "unavailable", never a profile picture', () => {
    const out = mapSlideNode({ content: { __typename: 'SlideMessageSomethingNew', thing: { image_url: 'https://scontent.fbcdn.net/x.jpg' } } }, 'n')
    expect(out.attachments[0]).toMatchObject({ kind: 'image', url: 'https://scontent.fbcdn.net/x.jpg' })
    expect(findImage({ owner: { profile_pic_url: 'https://scontent.fbcdn.net/p.jpg' } })).toBeUndefined()
  })

  it('turns a proxied GIPHY sticker into the see-through GIPHY file, and keeps a GIPHY GIF a GIF', () => {
    const giphy = (token: string, id: string): string => `https://media3.giphy.com/media/v1.${token}/${id}/200.webp`
    const sticker = giphy('Y2lkPTIwMmUwMjFmMGhwaGMyNHNlajE4ZGlocjZsODhuZ3RodWJxcmdocmd4N2o1MHVyciZlcD12MV9naWZzX2dpZklkJmN0PXM', 'Kw7LjEwVbzyrAegzF2')
    const proxied = `https://external.fhan17-1.fna.fbcdn.net/emg1/v/t13/5435526709572216046?_nc_oc=x&url=${encodeURIComponent(sticker)}&fb_obo=1&utld=giphy.com&stp=dst-src`
    const out = mapSlideNode({ content: { __typename: 'SlideMessageAnimatedMediaContent', thing: { url: proxied, width: 200, height: 200 } } }, 'g')
    expect(out.preview).toBe('sticker')
    expect(out.attachments[0]).toMatchObject({ kind: 'sticker', url: sticker, width: 200, height: 200 })
    const gif = giphy('Y2lkPTIwMmUwMjFmejlzY2QwZDNkamM2d25zOG56Z3h5dG1rdnVkdW92aHA5ZnNxd3BhcSZlcD12MV9naWZzX2dpZklkJmN0PWc', 'BFYLNwlsSNtcc')
    expect(giphyOf(`https://external.fbcdn.net/emg1/x?url=${encodeURIComponent(gif)}`)).toEqual({ url: gif, sticker: false })
    expect(giphyOf('https://scontent.fbcdn.net/photo.jpg')).toBeUndefined()
  })

  it('reads voice notes from audio_attachments', () => {
    const out = mapSlideNode({ content: { __typename: 'SlideMessageAudiosContent', audio_attachments: [{ attachment_cdn_url: 'https://cdn/a.mp4', playable_duration_ms: 4000, waveform_data: [1, 2] }] } }, 'au')
    expect(out.preview).toBe('voice')
    expect(out.attachments[0]).toMatchObject({ kind: 'audio', url: 'https://cdn/a.mp4', duration: 4 })
  })

  it('describes a content shape without urls or words', () => {
    expect(shapeOf({ __typename: 'SlideMessageStickerContent', label: 'xin chào bạn', image: { uri: 'https://cdn/x.png', width: 3 } })).toEqual({
      __typename: 'SlideMessageStickerContent',
      label: 'string',
      image: { uri: 'url', width: 'number' }
    })
  })

  it('falls back to a notice for unknown empty content', () => {
    expect(mapSlideNode({ content: { __typename: 'SlideMessageSomethingNew' } }, 'x').system).toEqual({ kind: 'unavailable' })
  })

  it('reads the message list from a thread detail response', () => {
    const res = { data: { get_slide_thread_nullable: { as_ig_direct_thread: { slide_messages: { edges: [{ node: { message_id: 'a' } }, { node: { message_id: 'b' } }] } } } } }
    expect(slideNodesOf(res).map((n) => n.message_id)).toEqual(['a', 'b'])
    expect(slideNodesOf({})).toEqual([])
  })
})
