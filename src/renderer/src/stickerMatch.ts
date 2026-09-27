/**
 * Recognise which Unison sticker a platform photo is. Stickers sent before Unison remembered them come back from
 * Instagram / Telegram flattened on white; comparing a tiny thumbnail against the pack tells us which one it was,
 * so the chat can draw the transparent original instead of a white square.
 */
import { stickerIds, stickerSvg, type StickerId } from '@shared/stickers'

const SIDE = 32
/** Average difference per colour channel (0..255): a real match scores ~1.5–2.5 even after JPEG, the next
 * closest sticker ~5, an ordinary photo 50+. Both a low score and a clear lead are required. */
const MATCH_LIMIT = 4
const MATCH_LEAD = 1.5

let prints: Promise<Array<{ id: StickerId; data: Uint8ClampedArray }>> | undefined

function load(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed'))
    img.src = src
  })
}

/** A 32×32 RGB thumbnail on white, the way the platforms flatten it. */
function thumbnail(img: HTMLImageElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIDE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, SIDE, SIDE)
  ctx.drawImage(img, 0, 0, SIDE, SIDE)
  return ctx.getImageData(0, 0, SIDE, SIDE).data
}

function fingerprints(): Promise<Array<{ id: StickerId; data: Uint8ClampedArray }>> {
  prints ??= Promise.all(
    stickerIds().map(async (id) => ({ id, data: thumbnail(await load(`data:image/svg+xml;utf8,${encodeURIComponent(stickerSvg(id).replace('<svg ', '<svg width="384" height="384" '))}`)) }))
  )
  return prints
}

function distance(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  return sum / ((a.length / 4) * 3)
}

const results = new Map<string, Promise<StickerId | undefined>>()

/** Which Unison sticker this image shows, if any (cached per URL). */
export function matchSticker(url: string): Promise<StickerId | undefined> {
  let result = results.get(url)
  if (!result) {
    result = (async () => {
      try {
        const [img, pack] = await Promise.all([load(url, !url.startsWith('data:')), fingerprints()])
        const probe = thumbnail(img)
        const [best, next] = pack.map((p) => ({ id: p.id, score: distance(probe, p.data) })).sort((a, b) => a.score - b.score)
        return best && best.score < MATCH_LIMIT && (!next || next.score - best.score >= MATCH_LEAD) ? best.id : undefined
      } catch {
        return undefined
      }
    })()
    results.set(url, result)
  }
  return result
}

/** For checks: the best score of an image against the pack. */
export async function stickerScores(url: string): Promise<Array<{ id: StickerId; score: number }>> {
  const [img, pack] = await Promise.all([load(url, !url.startsWith('data:')), fingerprints()])
  const probe = thumbnail(img)
  return pack.map((p) => ({ id: p.id, score: distance(probe, p.data) })).sort((a, b) => a.score - b.score)
}
