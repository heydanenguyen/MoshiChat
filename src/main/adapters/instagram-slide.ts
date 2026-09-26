import type { Attachment } from '@shared/types'
import { normaliseWaveform, type MappedItem } from './instagram-items'

/**
 * Instagram's newer message layer ("Slide"), as returned by the web client's own GraphQL
 * thread query. The legacy direct_v2 REST API returns these messages as
 * "Message unavailable / update to the latest version" placeholders.
 */
export interface SlideAttachment {
  attachment_fbid?: string | null
  attachment_type?: number
  attachment_cdn_url?: string | null
  preview_cdn_url?: string | null
  preview_cdn_fallback_url?: string | null
  preview_width?: number
  preview_height?: number
  [key: string]: unknown
}

export interface SlideXma {
  target_url?: string | null
  header_title_text?: string | null
  preview_image?: { url?: string | null; fallback_url?: string | null; width?: number; height?: number } | null
  xmaPreviewImage?: { url?: string | null } | null
  [key: string]: unknown
}

export interface SlideContent {
  __typename?: string
  text_body?: string | null
  xma_text_body?: string | null
  attachments?: SlideAttachment[] | null
  xma?: SlideXma | null
  [key: string]: unknown
}

export interface SlideNode {
  id?: string
  message_id?: string
  sender_fbid?: string
  sender?: { id?: string; igid?: string; name?: string } | null
  timestamp_ms?: string
  content_type?: string
  text_body?: string | null
  content?: SlideContent | null
}

/** Messenger-style attachment type codes seen in Slide payloads. */
const TYPE_VIDEO = 4
const TYPE_AUDIO = 5

/** First numeric field whose name mentions duration, in seconds. */
function durationOf(a: SlideAttachment): number | undefined {
  for (const [key, value] of Object.entries(a)) {
    if (!/duration/i.test(key) || typeof value !== 'number' || !value) continue
    return /ms|milli/i.test(key) || value > 10_000 ? value / 1000 : value
  }
  return undefined
}

/** First numeric array whose name looks like a waveform. */
function waveformOf(a: SlideAttachment): number[] | undefined {
  for (const [key, value] of Object.entries(a)) {
    if (/wave|amplitude/i.test(key) && Array.isArray(value) && value.every((v) => typeof v === 'number')) return normaliseWaveform(value as number[])
  }
  return undefined
}

function mediaAttachments(content: SlideContent, id: string): Attachment[] {
  const type = content.__typename ?? ''
  return (content.attachments ?? []).map((a, i): Attachment => {
    const aid = `${id}-s${i}`
    const url = a.attachment_cdn_url ?? undefined
    const still = a.preview_cdn_url ?? a.preview_cdn_fallback_url ?? undefined
    const size = { width: a.preview_width, height: a.preview_height }
    if (/Audio/.test(type) || a.attachment_type === TYPE_AUDIO) {
      return { id: aid, kind: 'audio', url, name: 'Voice message', duration: durationOf(a), waveform: waveformOf(a) }
    }
    if (/Video/.test(type) || a.attachment_type === TYPE_VIDEO) {
      return { id: aid, kind: 'video', url, thumbnailUrl: still, duration: durationOf(a), ...size }
    }
    if (!url && !still) return { id: aid, kind: 'image', expired: true }
    return { id: aid, kind: 'image', url: url ?? still, thumbnailUrl: still ?? url, name: /Animated/.test(type) ? 'GIF' : undefined, ...size }
  })
}

function xmaCard(xma: SlideXma, id: string): Attachment {
  const thumb = xma.preview_image?.url ?? xma.preview_image?.fallback_url ?? xma.xmaPreviewImage?.url ?? undefined
  const url = xma.target_url ?? undefined
  if (url && /\/stories\//.test(url)) {
    return { id, kind: 'story', label: 'story_share', url: thumb, thumbnailUrl: thumb, author: xma.header_title_text ?? undefined, expired: !thumb }
  }
  return {
    id,
    kind: 'post',
    url,
    thumbnailUrl: thumb,
    width: xma.preview_image?.width,
    height: xma.preview_image?.height,
    author: xma.header_title_text ?? undefined,
    reel: /\/reels?\//.test(url ?? ''),
    expired: !thumb
  }
}

/** What a bubble shows for one Slide message. */
export function mapSlideNode(node: SlideNode, id: string): MappedItem {
  const content = node.content ?? {}
  const type = content.__typename ?? ''
  const text = content.text_body ?? node.text_body ?? ''
  if (/Sticker/.test(type)) {
    const first = content.attachments?.[0]
    const url = first?.attachment_cdn_url ?? first?.preview_cdn_url ?? content.xma?.preview_image?.url ?? undefined
    if (url) return { text: '', attachments: [{ id: `${id}-k`, kind: 'sticker', url }], preview: 'sticker' }
  }
  if (content.attachments?.length) {
    const attachments = mediaAttachments(content, id)
    const kind = attachments[0].kind
    return { text, attachments, preview: kind === 'audio' ? 'voice' : kind === 'video' ? 'video' : attachments[0].name === 'GIF' ? 'gif' : 'photo' }
  }
  if (content.xma) {
    const card = xmaCard(content.xma, `${id}-x`)
    return { text: content.xma_text_body ?? text, attachments: [card], preview: card.kind === 'story' ? 'story_share' : card.reel ? 'reel' : 'post' }
  }
  if (text) return { text, attachments: [] }
  return { text: '', attachments: [], system: { kind: 'unavailable' }, preview: 'unavailable' }
}

/** The message list inside an IGDThreadDetailQuery response. */
export function slideNodesOf(response: unknown): SlideNode[] {
  const thread = (response as { data?: { get_slide_thread_nullable?: { as_ig_direct_thread?: { slide_messages?: { edges?: Array<{ node?: SlideNode }> } } } } })
    ?.data?.get_slide_thread_nullable?.as_ig_direct_thread
  return (thread?.slide_messages?.edges ?? []).map((e) => e.node).filter((n): n is SlideNode => !!n)
}
