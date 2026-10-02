/**
 * Picture packs: sticker packs shipped as pictures (a still PNG, a copy on white, a looping animated WebP) rather than
 * drawn in code. Mito (the black cat) and Pals. Ids are `<pack>:<name>`; the name becomes a file name in the main
 * process, so only listed ones pass.
 */
import { MITO_STICKERS } from './mito'
import { PALS_STICKERS } from './pals-stickers'

export interface PackPicture {
  id: string
  name: { vi: string; en: string }
  /** Length of one loop in ms, for the animated ones. */
  loop?: number
}

export const PICTURE_PACKS: Record<'mito' | 'pals', readonly PackPicture[]> = { mito: MITO_STICKERS, pals: PALS_STICKERS }
export type PicturePack = keyof typeof PICTURE_PACKS
export type PictureStickerId = `${PicturePack}:${string}`

export const packOf = (id: PictureStickerId): PicturePack => id.slice(0, id.indexOf(':')) as PicturePack
const nameOf = (id: PictureStickerId): string => id.slice(id.indexOf(':') + 1)

/** Whitelist check: a known pack and a sticker listed in it. */
export function isPictureStickerId(value: unknown): value is PictureStickerId {
  if (typeof value !== 'string') return false
  const colon = value.indexOf(':')
  const pack = PICTURE_PACKS[value.slice(0, colon) as PicturePack] as readonly PackPicture[] | undefined
  return colon > 0 && !!pack && pack.some((s) => s.id === value.slice(colon + 1))
}

export function pictureSticker(id: PictureStickerId): PackPicture {
  return PICTURE_PACKS[packOf(id)].find((s) => s.id === nameOf(id))!
}

export const packStickerIds = (pack: PicturePack): PictureStickerId[] => PICTURE_PACKS[pack].map((s) => `${pack}:${s.id}` as PictureStickerId)

/** Where the renderer loads a sticker's pictures from (served by the main process, see registerImageProxy). */
export function pictureUrl(id: PictureStickerId, kind: 'still' | 'animated', play = 0): string {
  return kind === 'still' ? `unison-img://sticker/${packOf(id)}/${nameOf(id)}.png` : `unison-img://sticker/${packOf(id)}/${nameOf(id)}.webp?play=${play}`
}
