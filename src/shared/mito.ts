/**
 * Mito: a sticker pack of the black cat Mito with amber eyes and white paws, drawn as pictures rather than built
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
  { id: 'gian', name: { vi: 'Tức giận', en: 'Angry' }, loop: 2200 },
  { id: 'ngu', name: { vi: 'Ngủ', en: 'Sleepy' }, loop: 3600 },
  { id: 'toasang', name: { vi: 'Tỏa sáng', en: 'Shine' }, loop: 2400 },
  { id: 'tuchoi', name: { vi: 'Từ chối tình cảm', en: 'No thanks' }, loop: 2400 },
  { id: 'dienthoai', name: { vi: 'Lướt điện thoại', en: 'Scrolling' }, loop: 3200 },
  { id: 'khohieu', name: { vi: 'Khó hiểu', en: 'Suspicious' }, loop: 2800 },
  { id: 'nghilai', name: { vi: 'Nghĩ lại đi', en: 'Think again' }, loop: 2400 },
  { id: 'nhayday', name: { vi: 'Nhảy dây', en: 'Jump rope' }, loop: 2400 }
]

export type MitoId = `mito:${string}`

/**
 * Mito stickers that are also on GIPHY (the GIFs from design/mito/export-giphy.mjs, uploaded to Moshi's channel):
 * Instagram gets these as real, moving stickers picked from its own tray, found by searching "mito <name>" (their tags).
 * Until GIPHY approves the channel they are not searchable, so the tray misses them and the still on white goes instead.
 */
export const MITO_GIPHY: Partial<Record<MitoId, string>> = {
  // giphy.com/channel/danenguyenco/mito-cat, each tagged 'mito <english name>'
  'mito:chao': 'KZtYrGLD2sODXDozgm',
  'mito:tim': 'pi0qEm8LBDZfsoVRyD',
  'mito:coc': 'EkqKxaI34vWBEtlhrb',
  'mito:quay': 'lgPmGKYhqOlAT8xH5N',
  'mito:gian': 'DCsyARP2o9QPlDiDh1',
  'mito:ngu': 'R4tSEA7giogzyKYlLN',
  'mito:toasang': 'jEL5Y0dxR2R6UmdvMY',
  'mito:tuchoi': 'rxp39KPnYHG0VognVH',
  'mito:dienthoai': 'm9QHeNAw0BCzKbEVHV',
  'mito:khohieu': 'KYenMNZPJ4jttGuqMI',
  'mito:nghilai': 'vk4YaVkXyhCV4rsgZM',
  'mito:nhayday': 'nogGNM5EvnePoPavNW'
}

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
