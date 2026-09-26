import type { Attachment, PreviewKind, StoryLabel, SystemNotice } from '@shared/types'

/**
 * Instagram web (direct_v2) item shapes, as observed on real threads in 2026.
 * Only the fields Unison reads are declared.
 */
export interface IgMedia {
  id?: string
  code?: string
  media_type?: number
  product_type?: string
  image_versions2?: {
    candidates?: Array<{ url: string; width?: number; height?: number }>
  }
  video_versions?: Array<{ url: string; width?: number; height?: number }>
  video_duration?: number
  original_width?: number
  original_height?: number
  caption?: { text?: string } | null
  user?: { username?: string; full_name?: string }
  carousel_media?: IgMedia[]
}

interface IgXma {
  target_url?: string
  title_text?: string
  header_title_text?: string
  subtitle_text?: string
  caption_body_text?: string
  preview_url_info?: { url?: string; width?: number; height?: number }
  preview_url?: string
}

export interface IgItem {
  item_id: string
  /** Shared with the newer "Slide" layer; used to resolve placeholders. */
  message_id?: string
  user_id: number | string
  timestamp: string | number
  item_type: string
  text?: string
  like?: string
  link?: {
    text?: string
    link_context?: {
      link_url?: string
      link_title?: string
      link_summary?: string
      link_image_url?: string
    }
  }
  media?: IgMedia
  visual_media?: { media?: IgMedia; view_mode?: string }
  raven_media?: IgMedia
  animated_media?: {
    is_sticker?: boolean
    images?: {
      fixed_height?: { url?: string; width?: string; height?: string }
    }
  }
  voice_media?: {
    media?: {
      audio?: {
        audio_src?: string
        duration?: number
        waveform_data?: number[]
      }
    }
  }
  media_share?: IgMedia
  direct_media_share?: { media?: IgMedia; text?: string }
  clip?: { clip?: IgMedia }
  felix_share?: { video?: IgMedia; text?: string }
  reel_share?: {
    text?: string
    type?: string
    reel_type?: string | null
    reel_owner_id?: string
    media?: IgMedia
  }
  story_share?: {
    text?: string
    message?: string
    title?: string
    media?: IgMedia
    story_share_type?: string
  }
  store_sticker?: {
    image_url?: string
    fallback_url?: string
    alt_text?: string
    emoji?: string
  }
  placeholder?: { title?: string; message?: string }
  video_call_event?: {
    action?: string
    description?: string
    call_duration?: number
    did_join?: boolean
    thread_has_audio_only_call?: boolean
  }
  action_log?: { description?: string; is_reaction_log?: boolean }
  xma_media_share?: IgXma[]
  xma_story_share?: IgXma[]
  xma_reel_share?: IgXma[]
  xma_clip?: IgXma[]
  xma_link?: IgXma[]
  generic_xma?: IgXma[]
  reactions?: { emojis?: Array<{ emoji: string; sender_id: number | string }> }
  replied_to_message?: {
    item_id?: string
    text?: string
    user_id?: number | string
  }
}

export interface MappedItem {
  text: string
  attachments: Attachment[]
  system?: SystemNotice
  /** Icon + label for the conversation list when the message is not plain text. */
  preview?: PreviewKind
  /** Bookkeeping entries Instagram itself does not show (for example "liked a message" logs). */
  hidden?: boolean
}

export interface MapContext {
  mePk: string
  /** Display name for a user id, if known. */
  nameOf(pk: string): string | undefined
}

const best = (media?: IgMedia): { url: string; width?: number; height?: number } | undefined => media?.image_versions2?.candidates?.[0]

const isVideo = (media?: IgMedia): boolean => media?.media_type === 2 || !!media?.video_versions?.length

/** Photo or video attachment(s) from a media object, including carousels. */
function visual(media: IgMedia | undefined, id: string): Attachment[] {
  if (!media) return []
  if (media.carousel_media?.length) return media.carousel_media.flatMap((m, i) => visual(m, `${id}-${i}`))
  const still = best(media)
  const width = media.original_width ?? still?.width
  const height = media.original_height ?? still?.height
  if (isVideo(media)) {
    return [
      {
        id,
        kind: 'video',
        url: media.video_versions?.[0]?.url,
        thumbnailUrl: still?.url,
        width,
        height,
        duration: media.video_duration
      }
    ]
  }
  // View-once photos that were already opened come back without any image.
  if (!still) return [{ id, kind: 'image', expired: true }]
  return [
    {
      id,
      kind: 'image',
      url: still.url,
      thumbnailUrl: still.url,
      width,
      height
    }
  ]
}

function postCard(media: IgMedia | undefined, id: string, reel = false): Attachment {
  const still = best(media)
  const isReel = reel || media?.product_type === 'clips'
  const url = media?.code ? `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${media.code}/` : undefined
  return {
    id,
    kind: 'post',
    url,
    thumbnailUrl: still?.url,
    width: media?.original_width ?? still?.width,
    height: media?.original_height ?? still?.height,
    caption: media?.caption?.text?.slice(0, 280) || undefined,
    author: media?.user?.username,
    reel: isReel,
    duration: media?.video_duration,
    expired: !media || !still
  }
}

function storyCard(media: IgMedia | undefined, id: string, label: StoryLabel, author?: string): Attachment {
  const still = best(media)
  return {
    id,
    kind: 'story',
    label,
    url: media?.video_versions?.[0]?.url ?? still?.url,
    thumbnailUrl: still?.url,
    width: media?.original_width ?? still?.width,
    height: media?.original_height ?? still?.height,
    author,
    expired: !still
  }
}

function xmaCard(xma: IgXma | undefined, id: string, story: boolean): Attachment | undefined {
  if (!xma) return undefined
  const thumb = xma.preview_url_info?.url ?? xma.preview_url
  if (story)
    return {
      id,
      kind: 'story',
      label: 'story_share',
      url: xma.target_url,
      thumbnailUrl: thumb,
      author: xma.header_title_text,
      expired: !thumb
    }
  return {
    id,
    kind: 'post',
    url: xma.target_url,
    thumbnailUrl: thumb,
    width: xma.preview_url_info?.width,
    height: xma.preview_url_info?.height,
    caption: (xma.caption_body_text ?? xma.title_text ?? xma.subtitle_text)?.slice(0, 280),
    author: xma.header_title_text,
    reel: /\/reels?\//.test(xma.target_url ?? ''),
    expired: !thumb
  }
}

/** Normalise Instagram's waveform (floats, sometimes 0..1, sometimes larger) to 0..1. */
export function normaliseWaveform(data?: number[]): number[] | undefined {
  if (!data?.length) return undefined
  const max = Math.max(...data.map((v) => Math.abs(v)), 0)
  if (!max) return undefined
  return data.map((v) => Math.round((Math.abs(v) / max) * 100) / 100)
}

const REACTION_LOG = /liked a message|reacted .* to (your|a) message|đã thích một tin nhắn|đã bày tỏ cảm xúc/i

/** Turn one Instagram item into what a bubble (or a centered notice) shows. */
export function mapIgItem(item: IgItem, ctx: MapContext): MappedItem {
  const id = item.item_id
  const text = item.text ?? item.link?.text ?? ''
  switch (item.item_type) {
    case 'text':
      return { text, attachments: [] }
    case 'like':
      return { text: item.like || '❤️', attachments: [] }
    case 'link': {
      const c = item.link?.link_context
      const card: Attachment[] = c?.link_url
        ? [
            {
              id: `${id}-l`,
              kind: 'link',
              url: c.link_url,
              name: c.link_title || undefined,
              caption: c.link_summary || undefined,
              thumbnailUrl: c.link_image_url || undefined
            }
          ]
        : []
      return { text, attachments: card, preview: text ? undefined : 'link' }
    }
    case 'media':
    case 'raven_media':
    case 'visual_media': {
      const media = item.media ?? item.visual_media?.media ?? item.raven_media
      const attachments = visual(media, `${id}-m`)
      return {
        text,
        attachments,
        preview: attachments[0]?.kind === 'video' ? 'video' : 'photo'
      }
    }
    case 'animated_media': {
      const gif = item.animated_media?.images?.fixed_height
      if (!gif?.url) return { text, attachments: [], preview: 'gif' }
      const kind = item.animated_media?.is_sticker ? 'sticker' : 'image'
      return {
        text,
        attachments: [
          {
            id: `${id}-g`,
            kind,
            url: gif.url,
            thumbnailUrl: gif.url,
            name: 'GIF',
            width: Number(gif.width) || undefined,
            height: Number(gif.height) || undefined
          }
        ],
        preview: kind === 'sticker' ? 'sticker' : 'gif'
      }
    }
    case 'voice_media': {
      const audio = item.voice_media?.media?.audio
      return {
        text,
        attachments: audio?.audio_src
          ? [
              {
                id: `${id}-v`,
                kind: 'audio',
                url: audio.audio_src,
                name: 'Voice message',
                duration: audio.duration ? audio.duration / 1000 : undefined,
                waveform: normaliseWaveform(audio.waveform_data)
              }
            ]
          : [],
        preview: 'voice'
      }
    }
    case 'media_share':
    case 'direct_media_share': {
      const media = item.direct_media_share?.media ?? item.media_share
      const card = postCard(media, `${id}-s`)
      return {
        text: item.direct_media_share?.text ?? text,
        attachments: [card],
        preview: card.reel ? 'reel' : 'post'
      }
    }
    case 'clip':
      return {
        text,
        attachments: [postCard(item.clip?.clip, `${id}-s`, true)],
        preview: 'reel'
      }
    case 'felix_share':
      return {
        text: item.felix_share?.text ?? text,
        attachments: [postCard(item.felix_share?.video, `${id}-s`, true)],
        preview: 'reel'
      }
    case 'reel_share': {
      const share = item.reel_share
      const label: StoryLabel = share?.type === 'reaction' ? 'story_reaction' : share?.type === 'mention' ? 'story_mention' : 'story_reply'
      const owner = share?.reel_owner_id && share.reel_owner_id !== ctx.mePk ? ctx.nameOf(share.reel_owner_id) : undefined
      return {
        text: share?.text ?? text,
        attachments: [storyCard(share?.media, `${id}-r`, label, owner)],
        preview: label
      }
    }
    case 'story_share': {
      const share = item.story_share
      const card = storyCard(share?.media, `${id}-r`, 'story_share', share?.media?.user?.username)
      return {
        text: share?.text ?? text,
        attachments: [card],
        preview: 'story_share'
      }
    }
    case 'store_sticker': {
      const sticker = item.store_sticker
      const url = sticker?.image_url ?? sticker?.fallback_url
      return {
        text: url ? '' : (sticker?.emoji ?? ''),
        attachments: url
          ? [
              {
                id: `${id}-k`,
                kind: 'sticker',
                url,
                name: sticker?.alt_text || sticker?.emoji || undefined
              }
            ]
          : [],
        preview: 'sticker'
      }
    }
    case 'placeholder':
      return {
        text: '',
        attachments: [],
        system: { kind: 'unavailable' },
        preview: 'unavailable'
      }
    case 'video_call_event': {
      const call = item.video_call_event
      const action = call?.action ?? ''
      const missed = /missed/i.test(action) || call?.did_join === false
      const audio = !!call?.thread_has_audio_only_call || /audio/i.test(action)
      const ended = /ended|missed/i.test(action)
      // "call started" rows duplicate the "ended" row that carries the duration.
      if (!ended && !missed) return { text: '', attachments: [], hidden: true }
      return {
        text: '',
        attachments: [],
        system: {
          kind: missed ? 'missed_call' : 'call',
          seconds: call?.call_duration || undefined,
          audio
        },
        preview: 'call'
      }
    }
    case 'action_log': {
      const log = item.action_log
      if (!log?.description || log.is_reaction_log || REACTION_LOG.test(log.description)) return { text: '', attachments: [], hidden: true }
      return {
        text: log.description,
        attachments: [],
        system: { kind: 'event' }
      }
    }
    default: {
      // Newer "XMA" containers (shared posts, stories, reels, links rendered by Meta's common card).
      const story = item.xma_story_share?.[0]
      const post = item.xma_media_share?.[0] ?? item.xma_reel_share?.[0] ?? item.xma_clip?.[0] ?? item.xma_link?.[0] ?? item.generic_xma?.[0]
      const card = story ? xmaCard(story, `${id}-x`, true) : xmaCard(post, `${id}-x`, false)
      if (card)
        return {
          text,
          attachments: [card],
          preview: card.kind === 'story' ? 'story_share' : card.reel ? 'reel' : 'post'
        }
      const fallback = visual(item.media, `${id}-m`)
      if (fallback.length)
        return {
          text,
          attachments: fallback,
          preview: fallback[0].kind === 'video' ? 'video' : 'photo'
        }
      if (text) return { text, attachments: [] }
      return {
        text: '',
        attachments: [],
        system: { kind: 'unavailable' },
        preview: 'unavailable'
      }
    }
  }
}
