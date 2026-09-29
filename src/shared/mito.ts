/**
 * Mito: a sticker pack of Mèo Bơ, a black cat with amber eyes and white paws, drawn as pictures rather than built
 * from the logo characters. Each sticker is a 384 px PNG with the Moshi sticker edge, a copy on white, and for the animated ones a
 * looping animated WebP (resources/stickers/mito, made by design/mito/build-pack.mjs).
 */
export interface MitoSticker {
  /** File name in resources/stickers/mito (lowercase letters only). */
  id: string
  name: { vi: string; en: string }
  /** Length of one loop in ms, for the animated ones. */
  loop?: number
}

export const MITO_STICKERS: readonly MitoSticker[] = [
  { id: 'chao', name: { vi: 'Chào', en: 'Hi' }, loop: 2400 },
  { id: 'tim', name: { vi: 'Tặng tim', en: 'For you' }, loop: 2800 },
  { id: 'coc', name: { vi: 'Đẩy cốc', en: 'Oops' }, loop: 4000 },
  { id: 'quay', name: { vi: 'Quẩy', en: 'Party' }, loop: 3200 },
  { id: 'gian', name: { vi: 'Tức giận', en: 'Angry' } },
  { id: 'tuchoi', name: { vi: 'Từ chối tình cảm', en: 'No thanks' } },
  { id: 'toasang', name: { vi: 'Tỏa sáng', en: 'Shine' } },
  { id: 'ngu', name: { vi: 'Ngủ', en: 'Sleepy' } },
  { id: 'dienthoai', name: { vi: 'Lướt điện thoại', en: 'Scrolling' } },
  { id: 'khohieu', name: { vi: 'Khó hiểu', en: 'Suspicious' } },
  { id: 'nghilai', name: { vi: 'Nghĩ lại đi', en: 'Think again' } },
  { id: 'nhayday', name: { vi: 'Nhảy dây', en: 'Jump rope' } }
]

export type MitoId = `mito:${string}`

/** Whitelist check; the id becomes a file name in the main process, so nothing else may pass. */
export function isMitoId(value: unknown): value is MitoId {
  return typeof value === 'string' && value.startsWith('mito:') && MITO_STICKERS.some((s) => `mito:${s.id}` === value)
}

export function mitoSticker(id: MitoId): MitoSticker {
  return MITO_STICKERS.find((s) => `mito:${s.id}` === id)!
}

/** Where the renderer loads a sticker's pictures from (served by the main process, see registerImageProxy). */
export function mitoUrl(id: MitoId, kind: 'still' | 'animated', play = 0): string {
  const name = id.slice('mito:'.length)
  return kind === 'still' ? `unison-img://sticker/mito/${name}.png` : `unison-img://sticker/mito/${name}.webp?play=${play}`
}
