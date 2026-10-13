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
  /** Videos and voice notes come in their own lists (SlideMessageVideosContent / AudiosContent). */
  videos?: SlideAttachment[] | null
  audios?: SlideAttachment[] | null
  images?: SlideAttachment[] | null
  /** Newer payloads name the lists by kind (seen: audio_attachments on SlideMessageAudiosContent). */
  audio_attachments?: SlideAttachment[] | null
  video_attachments?: SlideAttachment[] | null
  image_attachments?: SlideAttachment[] | null
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

/** Media items of a Slide message, whichever list Instagram put them in. */
function mediaList(content: SlideContent): SlideAttachment[] {
  const lists = [content.attachments, content.videos, content.audios, content.images, content.audio_attachments, content.video_attachments, content.image_attachments]
  return (lists.find((list) => Array.isArray(list) && list.length) as SlideAttachment[] | undefined) ?? []
}

function mediaAttachments(content: SlideContent, id: string): Attachment[] {
  const type = content.__typename ?? ''
  return mediaList(content).map((a, i): Attachment => {
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

const IMAGE_URL = /^https:\/\/\S+(fbcdn|cdninstagram|giphy|\.(png|webp|gif|jpe?g)(\?|$))/i
/** Keys that hold a link to somewhere else or a person's picture, never the message's own image. */
const NOT_THE_IMAGE = /target|profile|avatar|sender|owner|author|link_url|action/i

interface FoundImage {
  url: string
  width?: number
  height?: number
  animated: boolean
}

/**
 * The best image anywhere inside a content object whose shape is not known yet (new sticker kinds keep arriving
 * with their own field names): moving images first, then full size over previews.
 */
export function findImage(content: unknown): FoundImage | undefined {
  let best: (FoundImage & { score: number }) | undefined
  const visit = (value: unknown, path: string, parent: Record<string, unknown> | undefined, depth: number): void => {
    if (depth > 6 || value == null) return
    if (typeof value === 'string') {
      if (!IMAGE_URL.test(value) || NOT_THE_IMAGE.test(path)) return
      const animated = /animated|\.webp|\.gif|gif/i.test(path) || /\.(webp|gif)(\?|$)/i.test(value)
      const score = (animated ? 4 : 0) + (/preview|thumb|fallback|small/i.test(path) ? 0 : 1)
      if (best && best.score >= score) return
      const num = (key: RegExp): number | undefined => {
        const hit = parent && Object.entries(parent).find(([k, v]) => key.test(k) && typeof v === 'number' && v > 0)
        return hit ? (hit[1] as number) : undefined
      }
      best = { url: value, width: num(/width/i), height: num(/height/i), animated, score }
      return
    }
    if (Array.isArray(value)) value.forEach((v) => visit(v, path, parent, depth + 1))
    else if (typeof value === 'object') {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) visit(v, `${path}.${key}`, value as Record<string, unknown>, depth + 1)
    }
  }
  visit(content, '', undefined, 0)
  if (!best) return undefined
  const { score: _score, ...found } = best
  return found
}

/** Field names and value types of a content object (no urls or text), to learn the shape of a new kind from a log. */
export function shapeOf(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value === null ? null : typeof value
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1)] : []
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shapeOf(v, depth + 1)]))
  // Type names (SlideMessage…Content) are kept; any other string could be someone's words.
  if (typeof value === 'string') return /^https?:/.test(value) ? 'url' : /^[A-Z][A-Za-z]{2,60}$/.test(value) ? value : 'string'
  return typeof value
}

/**
 * A GIPHY picture behind Facebook's image proxy (external…fbcdn.net/emg1/…?url=<giphy>) as the GIPHY file itself.
 * The proxied copy goes through Moshi's photo previews (a still on white); GIPHY's own file keeps its motion and,
 * for a sticker, its see-through background. Whether it is a sticker or a GIF is in the link (ct=s or ct=g).
 */
export function giphyOf(url: string | undefined): { url: string; sticker: boolean } | undefined {
  if (!url) return undefined
  let target: URL
  try {
    target = new URL(url)
    if (/(^|\.)fbcdn\.net$/.test(target.hostname) && target.searchParams.get('url')) target = new URL(target.searchParams.get('url')!)
  } catch {
    return undefined
  }
  if (target.protocol !== 'https:' || !/(^|\.)giphy\.com$/.test(target.hostname)) return undefined
  const token = /\/media\/v1\.([^/]+)\//.exec(target.pathname)?.[1]
  let kind = ''
  try {
    kind = token ? (new URLSearchParams(Buffer.from(token, 'base64').toString('utf8')).get('ct') ?? '') : ''
  } catch {
    /* an older link without the token */
  }
  return { url: target.href, sticker: kind === 's' }
}

/** GIPHY pictures in a mapped message, as GIPHY's own files (stickers as stickers). */
export function withGiphy(mapped: MappedItem): MappedItem {
  let sticker = false
  const attachments = mapped.attachments.map((a) => {
    if (a.kind !== 'image' && a.kind !== 'sticker') return a
    const giphy = giphyOf(a.url)
    if (!giphy) return a
    sticker ||= giphy.sticker || a.kind === 'sticker'
    return { ...a, kind: giphy.sticker || a.kind === 'sticker' ? ('sticker' as const) : a.kind, url: giphy.url, thumbnailUrl: giphy.url, name: giphy.sticker ? undefined : a.name }
  })
  if (attachments.every((a, i) => a === mapped.attachments[i])) return mapped
  return { ...mapped, attachments, preview: sticker ? 'sticker' : mapped.preview }
}

/** What a bubble shows for one Slide message. */
export function mapSlideNode(node: SlideNode, id: string): MappedItem {
  return withGiphy(mapSlideContent(node, id))
}

function mapSlideContent(node: SlideNode, id: string): MappedItem {
  const content = node.content ?? {}
  const type = content.__typename ?? ''
  const text = content.text_body ?? node.text_body ?? ''
  if (/Sticker/i.test(type) || Object.keys(content).some((k) => /sticker/i.test(k))) {
    const first = mediaList(content)[0]
    const known = first?.attachment_cdn_url ?? first?.preview_cdn_url ?? content.xma?.preview_image?.url ?? undefined
    const found = known ? { url: known, width: first?.preview_width, height: first?.preview_height } : findImage(content)
    if (found) return { text: '', attachments: [{ id: `${id}-k`, kind: 'sticker', url: found.url, width: found.width, height: found.height }], preview: 'sticker' }
  }
  if (mediaList(content).length) {
    const attachments = mediaAttachments(content, id)
    const kind = attachments[0].kind
    return { text, attachments, preview: kind === 'audio' ? 'voice' : kind === 'video' ? 'video' : attachments[0].name === 'GIF' ? 'gif' : 'photo' }
  }
  if (content.xma) {
    const card = xmaCard(content.xma, `${id}-x`)
    return { text: content.xma_text_body ?? text, attachments: [card], preview: card.kind === 'story' ? 'story_share' : card.reel ? 'reel' : 'post' }
  }
  if (text) return { text, attachments: [] }
  // A kind not known yet that still carries a picture: show the picture rather than "unavailable".
  const found = findImage(content)
  if (found) return { text: '', attachments: [{ id: `${id}-i`, kind: 'image', url: found.url, width: found.width, height: found.height, name: found.animated ? 'GIF' : undefined }], preview: found.animated ? 'gif' : 'photo' }
  return { text: '', attachments: [], system: { kind: 'unavailable' }, preview: 'unavailable' }
}

/** The message list inside an IGDThreadDetailQuery response. */
export function slideNodesOf(response: unknown): SlideNode[] {
  const thread = (response as { data?: { get_slide_thread_nullable?: { as_ig_direct_thread?: { slide_messages?: { edges?: Array<{ node?: SlideNode }> } } } } })
    ?.data?.get_slide_thread_nullable?.as_ig_direct_thread
  return (thread?.slide_messages?.edges ?? []).map((e) => e.node).filter((n): n is SlideNode => !!n)
}
