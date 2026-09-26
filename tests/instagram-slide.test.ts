import { describe, expect, it } from 'vitest'
import { mapSlideNode, slideNodesOf } from '../src/main/adapters/instagram-slide'

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

  it('maps shared stories and posts from XMA cards, and text', () => {
    const story = mapSlideNode({ content: { __typename: 'SlideMessageXMAContent', xma: { target_url: 'https://www.instagram.com/stories/cafe/1/', preview_image: { url: 'https://cdn/s.jpg' }, header_title_text: 'cafe' } } }, 's')
    expect(story.attachments[0]).toMatchObject({ kind: 'story', label: 'story_share', author: 'cafe' })
    const post = mapSlideNode({ content: { __typename: 'SlideMessageXMAContent', xma: { target_url: 'https://www.instagram.com/reel/X/', preview_image: { url: 'https://cdn/r.jpg' } } } }, 'p')
    expect(post.attachments[0]).toMatchObject({ kind: 'post', reel: true })
    expect(mapSlideNode({ content: { __typename: 'SlideMessageText', text_body: 'hi' } }, 't')).toMatchObject({ text: 'hi', attachments: [] })
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
