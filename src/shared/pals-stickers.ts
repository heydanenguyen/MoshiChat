/**
 * Pals: a sticker pack of the Pals characters (src/shared/pals-art.ts), twelve of them, each a pal with one of its
 * expressions, moving. Each sticker is a 384 px PNG with the Moshi sticker edge, a copy on white, and a looping
 * 60 fps animated WebP (resources/stickers/pals, made by design/pals/build-pack.mjs from design/pals/motion.mjs).
 */
import type { PalFace } from './pals-art'

export interface PalsSticker {
  /** File name in resources/stickers/pals (lowercase letters only). */
  id: string
  /** Which pal (a CAST id) with which expression. */
  pal: string
  face: PalFace
  name: { vi: string; en: string }
  /** Length of one loop in ms. */
  loop: number
}

export const PALS_STICKERS: readonly PalsSticker[] = [
  { id: 'chao', pal: 'hoa', face: 'smile', name: { vi: 'Chào nha', en: 'Hello' }, loop: 2400 },
  { id: 'vui', pal: 'trung', face: 'joy', name: { vi: 'Vui quá', en: 'So happy' }, loop: 2000 },
  { id: 'cuoi', pal: 'nang', face: 'laugh', name: { vi: 'Cười xỉu', en: 'LOL' }, loop: 1600 },
  { id: 'nhay', pal: 'co', face: 'wink', name: { vi: 'Nháy mắt', en: 'Wink' }, loop: 2400 },
  { id: 'le', pal: 'ma', face: 'cheeky', name: { vi: 'Lêu lêu', en: 'Neener' }, loop: 2400 },
  { id: 'yeu', pal: 'may', face: 'love', name: { vi: 'Yêu nhiều', en: 'Love you' }, loop: 2000 },
  { id: 'hon', pal: 'may', face: 'kiss', name: { vi: 'Thơm cái', en: 'Mwah' }, loop: 2400 },
  { id: 'ngac', pal: 'bong', face: 'wow', name: { vi: 'Hả!?', en: 'Whoa!' }, loop: 2000 },
  { id: 'luoi', pal: 'giot', face: 'meh', name: { vi: 'Lười ghê', en: 'Meh' }, loop: 3200 },
  { id: 'ngu', pal: 'hoa', face: 'sleepy', name: { vi: 'Buồn ngủ', en: 'Sleepy' }, loop: 3200 },
  { id: 'gian', pal: 'flan', face: 'grumpy', name: { vi: 'Dỗi rồi', en: 'Grumpy' }, loop: 2000 },
  { id: 'khoc', pal: 'bong', face: 'cry', name: { vi: 'Huhu', en: 'Sob' }, loop: 2400 }
]
