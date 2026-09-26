/**
 * Unison sticker pack: every logo character (src/shared/logos.ts) with a set of expressions.
 * Same flat style as the logos (solid colours, black features), plus a white sticker outline.
 * Drawn on the character's 64x64 canvas; the sticker canvas adds room for props.
 * Used inline by the picker and rendered to PNG by scripts/make-icons.mjs (resources/stickers).
 */
import { LOGO_ORDER, logoBody, type LogoId } from './logos'

export type StickerExpression =
  | 'love'
  | 'haha'
  | 'wow'
  | 'sad'
  | 'angry'
  | 'cool'
  | 'sleepy'
  | 'wink'
  | 'party'
  | 'thanks'
  | 'nervous'
  | 'kiss'

export const STICKER_EXPRESSIONS: Array<{ id: StickerExpression; name: { vi: string; en: string } }> = [
  { id: 'love', name: { vi: 'Yêu quá', en: 'Love it' } },
  { id: 'haha', name: { vi: 'Haha', en: 'Haha' } },
  { id: 'wow', name: { vi: 'Wow', en: 'Wow' } },
  { id: 'sad', name: { vi: 'Buồn', en: 'Sad' } },
  { id: 'angry', name: { vi: 'Giận', en: 'Grr' } },
  { id: 'cool', name: { vi: 'Ngầu', en: 'Cool' } },
  { id: 'sleepy', name: { vi: 'Buồn ngủ', en: 'Sleepy' } },
  { id: 'wink', name: { vi: 'Nháy mắt', en: 'Wink' } },
  { id: 'party', name: { vi: 'Quẩy', en: 'Party' } },
  { id: 'thanks', name: { vi: 'Cảm ơn', en: 'Thanks' } },
  { id: 'nervous', name: { vi: 'Toát mồ hôi', en: 'Nervous' } },
  { id: 'kiss', name: { vi: 'Chụt', en: 'Kiss' } }
]

export type StickerId = `${LogoId}-${StickerExpression}`

export const stickerIds = (): StickerId[] => LOGO_ORDER.flatMap((c) => STICKER_EXPRESSIONS.map((e) => `${c}-${e.id}` as StickerId))

export function isStickerId(value: string): value is StickerId {
  const [character, expression] = value.split('-')
  return LOGO_ORDER.includes(character as LogoId) && STICKER_EXPRESSIONS.some((e) => e.id === expression) && value.split('-').length === 2
}

const INK = '#141414'
const RED = '#FF2E63'
const BLUE = '#3D8BFF'
const YELLOW = '#FFC21A'
const PINK = '#FF7AC0'

/** Where the face sits on each character and where props can go. */
interface Anchor {
  cx: number
  cy: number
  s: number
  hat: { x: number; y: number }
  tr: { x: number; y: number }
  tl: { x: number; y: number }
}

const ANCHORS: Record<LogoId, Anchor> = {
  buddies: { cx: 32.5, cy: 31, s: 1.25, hat: { x: 29, y: 5 }, tr: { x: 60, y: 6 }, tl: { x: 3, y: 7 } },
  sunny: { cx: 29.5, cy: 35.5, s: 1.05, hat: { x: 16, y: 10 }, tr: { x: 55, y: 10 }, tl: { x: 2, y: 5 } },
  sporty: { cx: 32, cy: 38.5, s: 1.15, hat: { x: 32, y: 8 }, tr: { x: 60, y: 8 }, tl: { x: 4, y: 8 } },
  blossom: { cx: 32, cy: 30.5, s: 1.15, hat: { x: 44, y: 8 }, tr: { x: 61, y: 6 }, tl: { x: 3, y: 6 } },
  curious: { cx: 32, cy: 30, s: 1.2, hat: { x: 32, y: 8 }, tr: { x: 60, y: 6 }, tl: { x: 4, y: 6 } },
  grape: { cx: 32, cy: 28.5, s: 1.2, hat: { x: 32, y: 9 }, tr: { x: 60, y: 5 }, tl: { x: 4, y: 5 } }
}

// ---------------------------------------------------------------- drawing helpers

const f = (n: number): string => (Math.round(n * 100) / 100).toString()
const stroke = (w: number, color = INK): string => `fill="none" stroke="${color}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"`

const dot = (x: number, y: number, r: number, color = INK): string => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${color}"/>`

const googly = (x: number, y: number, r: number, pr: number, dx = 0, dy = 0): string =>
  `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#fff"/>` + dot(x + dx, y + dy, pr)

/** Closed happy eye "∪". */
const closed = (x: number, y: number, w: number, lw: number): string => `<path d="M${f(x - w / 2)} ${f(y)} q${f(w / 2)} ${f(w * 0.55)} ${f(w)} 0" ${stroke(lw)}/>`

/** Squeezed eye "^". */
const squint = (x: number, y: number, w: number, h: number, lw: number): string =>
  `<path d="M${f(x - w / 2)} ${f(y + h)} L${f(x)} ${f(y - h)} L${f(x + w / 2)} ${f(y + h)}" ${stroke(lw)}/>`

/** Open "D" mouth with an optional tongue. */
const openMouth = (x: number, y: number, w: number, h: number, tongue = false): string =>
  `<path d="M${f(x - w / 2)} ${f(y)} H${f(x + w / 2)} A${f(w / 2)} ${f(h)} 0 0 1 ${f(x - w / 2)} ${f(y)} Z" fill="${INK}"/>` +
  (tongue ? `<ellipse cx="${f(x)}" cy="${f(y + h * 0.72)}" rx="${f(w * 0.26)}" ry="${f(h * 0.28)}" fill="#FF5D8F"/>` : '')

const smile = (x: number, y: number, w: number, lw: number, depth = 0.45): string => `<path d="M${f(x - w / 2)} ${f(y)} q${f(w / 2)} ${f(w * depth)} ${f(w)} 0" ${stroke(lw)}/>`

const frown = (x: number, y: number, w: number, lw: number): string => `<path d="M${f(x - w / 2)} ${f(y)} q${f(w / 2)} ${f(-w * 0.42)} ${f(w)} 0" ${stroke(lw)}/>`

const heart = (x: number, y: number, r: number, color = RED): string =>
  `<path d="M${f(x)} ${f(y + r * 0.95)} C${f(x - r * 1.5)} ${f(y - r * 0.05)} ${f(x - r * 0.85)} ${f(y - r * 1.15)} ${f(x)} ${f(y - r * 0.38)} ` +
  `C${f(x + r * 0.85)} ${f(y - r * 1.15)} ${f(x + r * 1.5)} ${f(y - r * 0.05)} ${f(x)} ${f(y + r * 0.95)} Z" fill="${color}"/>`

const tear = (x: number, y: number, r: number, color = BLUE): string =>
  `<path d="M${f(x)} ${f(y - r * 1.6)} C${f(x + r * 0.4)} ${f(y - r * 0.9)} ${f(x + r)} ${f(y - r * 0.4)} ${f(x + r)} ${f(y + r * 0.2)} ` +
  `A${f(r)} ${f(r)} 0 1 1 ${f(x - r)} ${f(y + r * 0.2)} C${f(x - r)} ${f(y - r * 0.4)} ${f(x - r * 0.4)} ${f(y - r * 0.9)} ${f(x)} ${f(y - r * 1.6)} Z" fill="${color}"/>`

const sparkle = (x: number, y: number, r: number, color = YELLOW): string =>
  `<path d="M${f(x)} ${f(y - r)} Q${f(x + r * 0.18)} ${f(y - r * 0.18)} ${f(x + r)} ${f(y)} Q${f(x + r * 0.18)} ${f(y + r * 0.18)} ${f(x)} ${f(y + r)} ` +
  `Q${f(x - r * 0.18)} ${f(y + r * 0.18)} ${f(x - r)} ${f(y)} Q${f(x - r * 0.18)} ${f(y - r * 0.18)} ${f(x)} ${f(y - r)} Z" fill="${color}"/>`

const letterZ = (x: number, y: number, size: number): string =>
  `<path d="M${f(x)} ${f(y)} h${f(size)} l${f(-size)} ${f(size)} h${f(size)}" ${stroke(size * 0.28, '#5B6BFF')}/>`

const anger = (x: number, y: number, r: number): string => {
  const arcs = [
    `M${f(x - r)} ${f(y - r * 0.35)} q${f(r * 0.65)} 0 ${f(r * 0.65)} ${f(-r * 0.65)}`,
    `M${f(x + r * 0.35)} ${f(y - r)} q0 ${f(r * 0.65)} ${f(r * 0.65)} ${f(r * 0.65)}`,
    `M${f(x + r)} ${f(y + r * 0.35)} q${f(-r * 0.65)} 0 ${f(-r * 0.65)} ${f(r * 0.65)}`,
    `M${f(x - r * 0.35)} ${f(y + r)} q0 ${f(-r * 0.65)} ${f(-r * 0.65)} ${f(-r * 0.65)}`
  ]
  return arcs.map((d) => `<path d="${d}" ${stroke(r * 0.42, '#FF3B30')}/>`).join('')
}

const blush = (x: number, y: number, s: number): string => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(3.4 * s)}" ry="${f(2.1 * s)}" fill="#FF3D7F" opacity="0.45"/>`

const partyHat = (x: number, y: number): string =>
  `<g transform="rotate(-14 ${f(x)} ${f(y)})"><path d="M${f(x - 7.5)} ${f(y + 1)} L${f(x)} ${f(y - 17)} L${f(x + 7.5)} ${f(y + 1)} Z" fill="#FFC21A"/>` +
  `<path d="M${f(x - 5.2)} ${f(y - 4.5)} L${f(x + 5.4)} ${f(y - 4.5)} M${f(x - 2.9)} ${f(y - 10)} L${f(x + 3.1)} ${f(y - 10)}" ${stroke(2.4, '#FF3D7F')}/>` +
  `${dot(x, y - 18, 2.6, '#1F6BFF')}</g>`

const confetti = (a: Anchor): string =>
  [
    `<rect x="${f(a.tl.x)}" y="${f(a.tl.y + 10)}" width="4" height="2.2" rx="1" fill="#1F6BFF" transform="rotate(30 ${f(a.tl.x)} ${f(a.tl.y + 10)})"/>`,
    dot(a.tl.x + 5, a.tl.y + 2, 1.7, '#FF3D7F'),
    `<rect x="${f(a.tr.x - 4)}" y="${f(a.tr.y + 12)}" width="4" height="2.2" rx="1" fill="#10A862" transform="rotate(-25 ${f(a.tr.x - 4)} ${f(a.tr.y + 12)})"/>`,
    dot(a.tr.x - 1, a.tr.y + 2, 1.8, '#FF5B1F'),
    sparkle(a.tr.x - 8, a.tr.y - 1, 3.2, YELLOW)
  ].join('')

const sunglasses = (cx: number, cy: number, e: number, s: number): string => {
  const w = 12 * s
  const h = 7.5 * s
  const lens = (x: number): string =>
    `<rect x="${f(x - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(2.6 * s)}" fill="${INK}"/>` +
    `<path d="M${f(x - w * 0.25)} ${f(cy - h * 0.18)} l${f(w * 0.2)} ${f(-h * 0.2)}" ${stroke(1.2 * s, '#ffffff')} opacity="0.7"/>`
  return lens(cx - e) + lens(cx + e) + `<path d="M${f(cx - e + w / 2)} ${f(cy - h * 0.2)} H${f(cx + e - w / 2)}" ${stroke(2 * s)}/>`
}

// ---------------------------------------------------------------- expressions

function face(expression: StickerExpression, a: Anchor): { face: string; props: string } {
  const { cx, cy, s } = a
  const e = 8.5 * s
  const lw = 2.6 * s
  switch (expression) {
    case 'love':
      return {
        face: heart(cx - e, cy, 5.4 * s) + heart(cx + e, cy, 5.4 * s) + openMouth(cx, cy + 8.5 * s, 12 * s, 7 * s, true),
        props: heart(a.tr.x - 2, a.tr.y + 4, 4.6) + heart(a.tr.x - 10, a.tr.y - 3, 2.8, PINK)
      }
    case 'haha':
      return {
        face: squint(cx - e, cy, 7 * s, 2.3 * s, lw) + squint(cx + e, cy, 7 * s, 2.3 * s, lw) + openMouth(cx, cy + 7.5 * s, 16 * s, 10 * s, true),
        props: tear(cx - e - 6 * s, cy + 3 * s, 2.3 * s) + tear(cx + e + 6 * s, cy + 3 * s, 2.3 * s)
      }
    case 'wow':
      return {
        face: googly(cx - e, cy, 7.6 * s, 2.6 * s) + googly(cx + e, cy, 7.6 * s, 2.6 * s) + `<ellipse cx="${f(cx)}" cy="${f(cy + 11.5 * s)}" rx="${f(3.3 * s)}" ry="${f(4.4 * s)}" fill="${INK}"/>`,
        props: sparkle(a.tr.x - 3, a.tr.y + 3, 4.8) + sparkle(a.tl.x + 3, a.tl.y + 5, 3.4)
      }
    case 'sad':
      return {
        face:
          dot(cx - e, cy + 1 * s, 2.9 * s) +
          dot(cx + e, cy + 1 * s, 2.9 * s) +
          `<path d="M${f(cx - e - 4 * s)} ${f(cy - 4.5 * s)} L${f(cx - e + 3.5 * s)} ${f(cy - 7.5 * s)}" ${stroke(lw)}/>` +
          `<path d="M${f(cx + e + 4 * s)} ${f(cy - 4.5 * s)} L${f(cx + e - 3.5 * s)} ${f(cy - 7.5 * s)}" ${stroke(lw)}/>` +
          frown(cx, cy + 11 * s, 10 * s, lw),
        props: tear(cx - e + 1 * s, cy + 7.5 * s, 2.6 * s)
      }
    case 'angry':
      return {
        face:
          dot(cx - e, cy + 1 * s, 2.9 * s) +
          dot(cx + e, cy + 1 * s, 2.9 * s) +
          `<path d="M${f(cx - e - 4.5 * s)} ${f(cy - 7.5 * s)} L${f(cx - e + 3.5 * s)} ${f(cy - 4 * s)}" ${stroke(lw * 1.1)}/>` +
          `<path d="M${f(cx + e + 4.5 * s)} ${f(cy - 7.5 * s)} L${f(cx + e - 3.5 * s)} ${f(cy - 4 * s)}" ${stroke(lw * 1.1)}/>` +
          frown(cx, cy + 11 * s, 9 * s, lw * 1.1),
        props: anger(a.tr.x - 4, a.tr.y + 5, 4.2)
      }
    case 'cool':
      return {
        face: sunglasses(cx, cy, e, s) + `<path d="M${f(cx - 3 * s)} ${f(cy + 10 * s)} q${f(5 * s)} ${f(3 * s)} ${f(9 * s)} ${f(-2.2 * s)}" ${stroke(lw)}/>`,
        props: sparkle(a.tr.x - 3, a.tr.y + 4, 4.4)
      }
    case 'sleepy':
      return {
        face:
          `<path d="M${f(cx - e - 3.5 * s)} ${f(cy + 1 * s)} q${f(3.5 * s)} ${f(1.6 * s)} ${f(7 * s)} 0" ${stroke(lw)}/>` +
          `<path d="M${f(cx + e - 3.5 * s)} ${f(cy + 1 * s)} q${f(3.5 * s)} ${f(1.6 * s)} ${f(7 * s)} 0" ${stroke(lw)}/>` +
          `<ellipse cx="${f(cx)}" cy="${f(cy + 10 * s)}" rx="${f(2.3 * s)}" ry="${f(2.9 * s)}" fill="${INK}"/>`,
        props: letterZ(a.tr.x - 12, a.tr.y + 8, 4.2) + letterZ(a.tr.x - 5, a.tr.y + 1, 5.4) + letterZ(a.tr.x + 1, a.tr.y - 7, 6.4)
      }
    case 'wink':
      return {
        face: googly(cx - e, cy, 7.2 * s, 4 * s, 1.2 * s, -0.6 * s) + squint(cx + e, cy, 7 * s, 2.2 * s, lw) + openMouth(cx, cy + 8.5 * s, 12 * s, 7.5 * s, true),
        props: sparkle(a.tr.x - 3, a.tr.y + 5, 4.2) + sparkle(a.tr.x - 11, a.tr.y - 2, 2.6, PINK)
      }
    case 'party':
      return {
        face: googly(cx - e, cy, 7.2 * s, 4 * s, 0.8 * s, -1.6 * s) + googly(cx + e, cy, 7.2 * s, 4 * s, 0.8 * s, -1.6 * s) + openMouth(cx, cy + 9 * s, 14 * s, 8.5 * s, true),
        props: partyHat(a.hat.x, a.hat.y) + confetti(a)
      }
    case 'thanks':
      return {
        face: closed(cx - e, cy, 7 * s, lw) + closed(cx + e, cy, 7 * s, lw) + blush(cx - e - 2 * s, cy + 6 * s, s) + blush(cx + e + 2 * s, cy + 6 * s, s) + smile(cx, cy + 8 * s, 10 * s, lw),
        props: heart(a.tr.x - 3, a.tr.y + 6, 4) + sparkle(a.tl.x + 4, a.tl.y + 6, 3.6) + sparkle(a.tr.x - 12, a.tr.y - 2, 2.6)
      }
    case 'nervous':
      return {
        face:
          googly(cx - e, cy, 7.2 * s, 2.4 * s, -2.8 * s, 0) +
          googly(cx + e, cy, 7.2 * s, 2.4 * s, -2.8 * s, 0) +
          `<path d="M${f(cx - 6 * s)} ${f(cy + 11 * s)} l${f(2 * s)} ${f(-1.8 * s)} l${f(2 * s)} ${f(1.8 * s)} l${f(2 * s)} ${f(-1.8 * s)} l${f(2 * s)} ${f(1.8 * s)} l${f(2 * s)} ${f(-1.8 * s)}" ${stroke(lw * 0.9)}/>`,
        props: tear(a.tr.x - 6, a.tr.y + 10, 3.4) + tear(a.tr.x - 1, a.tr.y + 2, 2.2)
      }
    case 'kiss':
      return {
        face:
          closed(cx - e, cy, 7 * s, lw) +
          closed(cx + e, cy, 7 * s, lw) +
          blush(cx - e - 2 * s, cy + 6 * s, s) +
          blush(cx + e + 2 * s, cy + 6 * s, s) +
          `<path d="M${f(cx - 1.4 * s)} ${f(cy + 7 * s)} q${f(4.4 * s)} ${f(1.6 * s)} 0 ${f(3.2 * s)} q${f(4.4 * s)} ${f(1.6 * s)} 0 ${f(3.2 * s)}" ${stroke(lw, '#E0245E')}/>`,
        props: heart(a.tr.x - 4, a.tr.y + 8, 3.6) + heart(a.tr.x + 1, a.tr.y, 2.4, PINK)
      }
  }
}

const OUTLINE =
  `<defs><filter id="unison-sticker-outline" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">` +
  `<feMorphology in="SourceAlpha" operator="dilate" radius="2.6" result="thick"/>` +
  `<feFlood flood-color="#ffffff"/><feComposite in2="thick" operator="in" result="outline"/>` +
  `<feMorphology in="SourceAlpha" operator="dilate" radius="3.4" result="rim"/>` +
  `<feFlood flood-color="#141432" flood-opacity="0.14"/><feComposite in2="rim" operator="in" result="edge"/>` +
  `<feMerge><feMergeNode in="edge"/><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`

/** Inner markup (for inline use inside an <svg viewBox={STICKER_VIEWBOX}>). */
export function stickerInner(id: StickerId): string {
  const [character, expression] = id.split('-') as [LogoId, StickerExpression]
  const anchor = ANCHORS[character] ?? ANCHORS.buddies
  const { face: features, props } = face(expression, anchor)
  return `${OUTLINE}<g filter="url(#unison-sticker-outline)"><g class="sticker-body">${logoBody(character)}${features}</g>${props}</g>`
}

export const STICKER_VIEWBOX = '-9 -12 82 82'

export function stickerSvg(id: StickerId): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${STICKER_VIEWBOX}">${stickerInner(id)}</svg>`
}
