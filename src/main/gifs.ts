import { app } from 'electron'
import { createHash } from 'crypto'
import { join } from 'path'
import { mkdir, stat, writeFile } from 'fs/promises'
import type { GifItem, GifMedia, GifPage, GifProvider, OutgoingAttachment } from '@shared/types'

/**
 * GIF search through the user's own KLIPY or GIPHY key (Tenor's API closed in June 2026), and
 * downloading a picked GIF as a file the adapters can send. The key never leaves the main process.
 */

const PER_PAGE = 24
/** Only these CDNs are ever downloaded from, whatever the renderer passes. */
const GIF_HOSTS = /(^|\.)(klipy\.com|giphy\.com)$/i
const MAX_BYTES = 15 * 1024 * 1024

export class GifKeyError extends Error {
  constructor() {
    super('GIF_KEY')
  }
}

type KlipyFormat = { url?: string; width?: number; height?: number; size?: number }
type KlipyItem = {
  id: number | string
  slug?: string
  title?: string
  type?: string
  file?: Record<string, Record<string, KlipyFormat | undefined> | undefined>
}
type KlipyEnvelope = { result?: boolean; data?: { data?: KlipyItem[]; has_next?: boolean }; errors?: { message?: string[] } }

const media = (f: KlipyFormat | undefined): GifMedia | undefined =>
  f?.url ? { url: f.url, width: Number(f.width) || 0, height: Number(f.height) || 0, size: Number(f.size) || undefined } : undefined

function firstOf(item: KlipyItem, qualities: string[], format: string): GifMedia | undefined {
  for (const q of qualities) {
    const found = media(item.file?.[q]?.[format])
    if (found) return found
  }
  return undefined
}

/** KLIPY list -> GIFs (sponsored "ad" items are skipped). */
export function fromKlipy(body: KlipyEnvelope): { items: GifItem[]; hasNext: boolean } {
  const items: GifItem[] = []
  for (const item of body.data?.data ?? []) {
    if (item.type && item.type !== 'gif') continue
    const gif = firstOf(item, ['md', 'sm', 'hd', 'xs'], 'gif')
    const preview = firstOf(item, ['sm', 'xs', 'md'], 'webp') ?? firstOf(item, ['sm', 'xs', 'md'], 'gif')
    if (!gif || !preview) continue
    items.push({ id: `klipy:${item.slug || item.id}`, title: item.title ?? '', provider: 'klipy', preview, gif, mp4: firstOf(item, ['md', 'sm', 'hd'], 'mp4') })
  }
  return { items, hasNext: !!body.data?.has_next }
}

type GiphyImage = { url?: string; width?: string; height?: string; size?: string; webp?: string; mp4?: string; mp4_size?: string }
type GiphyItem = { id: string; title?: string; images?: Record<string, GiphyImage | undefined> }
type GiphyEnvelope = { data?: GiphyItem[]; pagination?: { total_count?: number; count?: number; offset?: number }; meta?: { status?: number; msg?: string } }

/** GIPHY list -> GIFs. */
export function fromGiphy(body: GiphyEnvelope): { items: GifItem[]; hasNext: boolean } {
  const items: GifItem[] = []
  for (const item of body.data ?? []) {
    const images = item.images ?? {}
    const small = images.fixed_width ?? images.fixed_width_downsampled
    const full = images.downsized_medium ?? images.downsized ?? images.original
    if (!small?.url || !full?.url) continue
    const dims = (i: GiphyImage): { width: number; height: number } => ({ width: Number(i.width) || 0, height: Number(i.height) || 0 })
    const mp4Source = images.original?.mp4 ? images.original : images.fixed_width
    items.push({
      id: `giphy:${item.id}`,
      title: item.title ?? '',
      provider: 'giphy',
      preview: { url: small.webp ?? small.url, ...dims(small) },
      gif: { url: full.url, ...dims(full), size: Number(full.size) || undefined },
      mp4: mp4Source?.mp4 ? { url: mp4Source.mp4, ...dims(mp4Source), size: Number(mp4Source.mp4_size) || undefined } : undefined
    })
  }
  const p = body.pagination
  return { items, hasNext: !!p && (p.offset ?? 0) + (p.count ?? 0) < (p.total_count ?? 0) }
}

export async function searchGifs(provider: GifProvider, key: string, query: string, page: number, language: string): Promise<GifPage> {
  if (!key.trim()) throw new GifKeyError()
  const q = query.trim()
  let url: URL
  if (provider === 'giphy') {
    url = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`)
    url.searchParams.set('api_key', key.trim())
    url.searchParams.set('limit', String(PER_PAGE))
    url.searchParams.set('offset', String((page - 1) * PER_PAGE))
    url.searchParams.set('rating', 'pg-13')
    if (q) {
      url.searchParams.set('q', q)
      url.searchParams.set('lang', language)
    }
  } else {
    url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key.trim())}/gifs/${q ? 'search' : 'trending'}`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', String(PER_PAGE))
    url.searchParams.set('content_filter', 'medium')
    if (q) url.searchParams.set('q', q)
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  const body = (await res.json().catch(() => undefined)) as (KlipyEnvelope & GiphyEnvelope) | undefined
  // KLIPY answers a bad key with 404/401 + result:false; GIPHY with 401/403.
  if (res.status === 401 || res.status === 403 || (provider === 'klipy' && (res.status === 404 || body?.result === false))) throw new GifKeyError()
  if (res.status === 429) throw new Error('GIF_RATE')
  if (!res.ok || !body) throw new Error(`GIF search failed (${res.status})`)
  const { items, hasNext } = provider === 'giphy' ? fromGiphy(body) : fromKlipy(body)
  return { items, hasNext, page }
}

async function download(url: string, ext: string): Promise<{ path: string; size: number }> {
  const target = new URL(url)
  if (target.protocol !== 'https:' || !GIF_HOSTS.test(target.hostname)) throw new Error('This GIF host is not allowed')
  const dir = join(app.getPath('temp'), 'unison-gifs')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${createHash('sha1').update(url).digest('hex').slice(0, 20)}.${ext}`)
  const cached = await stat(path).catch(() => undefined)
  if (cached?.size) return { path, size: cached.size }
  const res = await fetch(target, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Could not download the GIF (${res.status})`)
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > MAX_BYTES) throw new Error('This GIF is too large to send')
  await writeFile(path, data)
  return { path, size: data.length }
}

/**
 * A picked GIF as an outgoing file: the .gif itself, plus an MP4 copy for platforms that only take
 * video (WhatsApp plays it as a looping GIF, Instagram as a short video).
 */
export async function gifFile(item: GifItem): Promise<OutgoingAttachment> {
  const [gif, mp4] = await Promise.all([download(item.gif.url, 'gif'), item.mp4 ? download(item.mp4.url, 'mp4').catch(() => undefined) : undefined])
  return {
    path: gif.path,
    name: `${
      (item.title || 'gif')
        .replace(/[^\p{L}\p{N} _-]+/gu, '')
        .trim()
        .slice(0, 40) || 'gif'
    }.gif`,
    mime: 'image/gif',
    size: gif.size,
    preview: item.gif.url,
    gif: true,
    width: item.gif.width || item.mp4?.width,
    height: item.gif.height || item.mp4?.height,
    alternates: mp4 ? [{ path: mp4.path, mime: 'video/mp4', size: mp4.size }] : undefined
  }
}
