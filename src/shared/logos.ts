/**
 * Unison's logo characters, one source for the app (inline SVG) and for the icon files
 * (scripts/make-icons.mjs). Flat colours, black features, no outlines; every character is a
 * chat bubble with a face. Marks use a 64x64 canvas; app icons put a mark on a coloured tile.
 * Class names (buddy-body / buddy-eyes / buddy-pupils) drive the blink and glance animations.
 */

export type LogoId = 'buddies' | 'sunny' | 'sporty' | 'blossom' | 'curious' | 'grape'
export type LogoMood = 'happy' | 'calm'

export interface LogoMeta {
  id: LogoId
  name: { vi: string; en: string }
  /** Character colour (also used for soft glows). */
  color: string
  /** App icon tile colour. */
  background: string
}

export const LOGOS: Record<LogoId, LogoMeta> = {
  buddies: { id: 'buddies', name: { vi: 'Bộ đôi', en: 'Buddies' }, color: '#FF5B1F', background: '#CDBBFF' },
  sunny: { id: 'sunny', name: { vi: 'Nắng', en: 'Sunny' }, color: '#FFC21A', background: '#7CC4FF' },
  sporty: { id: 'sporty', name: { vi: 'Năng động', en: 'Sporty' }, color: '#13B26B', background: '#FFE45C' },
  blossom: { id: 'blossom', name: { vi: 'Hoa', en: 'Blossom' }, color: '#FF6FB5', background: '#A8F0D0' },
  curious: { id: 'curious', name: { vi: 'Tò mò', en: 'Curious' }, color: '#1F6BFF', background: '#FFB38A' },
  grape: { id: 'grape', name: { vi: 'Nho', en: 'Grape' }, color: '#9B5DE5', background: '#D6F36B' }
}

export const LOGO_ORDER: LogoId[] = ['buddies', 'sunny', 'sporty', 'blossom', 'curious', 'grape']

const INK = '#141414'

/** Closed, content eyes and a soft smile centred at (cx, cy). */
const calmFace = (cx: number, cy: number, s = 1): string =>
  `<g fill="none" stroke="${INK}" stroke-width="${2.6 * s}" stroke-linecap="round">` +
  `<path d="M${cx - 12.5 * s} ${cy} q${3.5 * s} ${3.8 * s} ${7 * s} 0"/>` +
  `<path d="M${cx + 4.5 * s} ${cy} q${3.5 * s} ${3.8 * s} ${7 * s} 0"/>` +
  `<path d="M${cx - 4.5 * s} ${cy + 8 * s} q${4.5 * s} ${3.6 * s} ${9 * s} 0"/></g>`

/** Two googly eyes (pupils nudged by dx/dy) inside a blinking group. */
const googly = (lx: number, rx: number, y: number, r: number, pr: number, dx: number, dy: number): string =>
  `<g class="buddy-eyes"><circle cx="${lx}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${rx}" cy="${y}" r="${r}" fill="#fff"/>` +
  `<g class="buddy-pupils"><circle cx="${lx + dx}" cy="${y + dy}" r="${pr}" fill="${INK}"/><circle cx="${rx + dx}" cy="${y + dy}" r="${pr}" fill="${INK}"/></g></g>`

interface Character {
  body: string
  happy: string
  calm: string
}

const CHARACTERS: Record<LogoId, Character> = {
  // Orange scalloped speech bubble, googly eyes, grin.
  buddies: {
    body:
      `<g fill="#FF5B1F" stroke="#FF5B1F" stroke-width="3" stroke-linejoin="round">` +
      `<rect x="7" y="17" width="50" height="36" rx="16" stroke="none"/><circle cx="16" cy="19" r="9" stroke="none"/>` +
      `<circle cx="29" cy="14" r="10" stroke="none"/><circle cx="42" cy="15" r="9" stroke="none"/><circle cx="51" cy="21" r="8" stroke="none"/>` +
      `<path d="M14 47 L9 59 L26 51 Z"/></g>`,
    happy: googly(24, 41, 31, 7.5, 4.2, 2.5, -1.5) + `<path d="M26 40.5 H39 A6.5 6 0 0 1 26 40.5 Z" fill="${INK}"/>`,
    calm: calmFace(32, 31)
  },
  // Yellow quarter-circle "quote" bubble looking up at you.
  sunny: {
    body: `<path d="M12 12 A42 42 0 0 1 54 54 L12 54 Z" fill="#FFC21A" stroke="#FFC21A" stroke-width="6" stroke-linejoin="round"/>`,
    happy: googly(24, 38, 38, 6.8, 3.9, 1.8, -2.2) + `<path d="M26 47 q5 4.2 10 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,
    calm: calmFace(31, 38, 0.95)
  },
  // Green dome with a sporty headband and a sweat drop.
  sporty: {
    body:
      `<path d="M8 56 V34 C8 19 19 8 32 8 C45 8 56 19 56 34 V56 Z" fill="#13B26B" stroke="#13B26B" stroke-width="3" stroke-linejoin="round"/>` +
      `<rect x="8.5" y="20" width="47" height="3.6" rx="1.8" fill="#FF7AC0"/><rect x="7.5" y="24.4" width="49" height="3.6" rx="1.8" fill="#FF5B1F"/>` +
      `<path d="M50 30 q4.5 5.5 0 9 q-4.5 -3.5 0 -9 Z" fill="#3D8BFF"/>`,
    happy: googly(24, 40, 40, 7.6, 4.6, 0, 0.5) + `<rect x="28.5" y="50" width="7" height="3.8" rx="1.9" fill="${INK}"/>`,
    calm: calmFace(32, 41)
  },
  // Pink four-petal flower, big grin.
  blossom: {
    body:
      `<g fill="#FF6FB5"><circle cx="32" cy="32" r="16"/><circle cx="20" cy="20" r="13"/><circle cx="44" cy="20" r="13"/>` +
      `<circle cx="20" cy="44" r="13"/><circle cx="44" cy="44" r="13"/></g>`,
    happy:
      `<g fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"><path d="M21 29 q4 4.5 8 0"/><path d="M35 29 q4 4.5 8 0"/></g>` +
      `<path d="M23 37 H41 A9 8.5 0 0 1 23 37 Z" fill="${INK}"/><path d="M28 42.4 q4 2.6 8 0 q-4 -2.4 -8 0 Z" fill="#FF3D7F"/>`,
    calm: calmFace(32, 30)
  },
  // Blue hexagon peeking sideways.
  curious: {
    body: `<path d="M19 10 H45 L57 32 L45 54 H19 L7 32 Z" fill="#1F6BFF" stroke="#1F6BFF" stroke-width="6" stroke-linejoin="round"/>`,
    happy: googly(24, 40, 30, 7.2, 4, 2.8, 0.6) + `<path d="M27 42 q5 3.8 10 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,
    calm: calmFace(32, 31)
  },
  // Purple stacked cloud, content and grateful.
  grape: {
    body:
      `<g fill="#9B5DE5"><rect x="7" y="9" width="50" height="25" rx="12.5"/><rect x="7" y="30" width="50" height="25" rx="12.5"/>` +
      `<rect x="11" y="18" width="42" height="28"/></g>`,
    happy:
      `<g fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"><path d="M20.5 27 q3.5 3.8 7 0"/><path d="M36.5 27 q3.5 3.8 7 0"/>` +
      `<path d="M22 36 q10 8 20 0"/></g><circle cx="18" cy="33" r="2.6" fill="#FF7AC0"/><circle cx="46" cy="33" r="2.6" fill="#FF7AC0"/>`,
    calm: calmFace(32, 30)
  }
}

/** Inner SVG markup of a mark (64x64 coordinates). */
export function logoMarkInner(id: LogoId, mood: LogoMood = 'happy'): string {
  const c = CHARACTERS[id] ?? CHARACTERS.buddies
  return `<g class="buddy-body">${c.body}${mood === 'calm' ? c.calm : c.happy}</g>`
}

/** Standalone mark (transparent background). */
export function logoMarkSvg(id: LogoId, mood: LogoMood = 'happy'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${logoMarkInner(id, mood)}</svg>`
}

/** Buddies duo used for the large app icon and the welcome screen (1024 canvas coordinates). */
const DUO_INNER =
  `<g class="buddy-pink"><g fill="#FF7AC0" stroke="#FF7AC0" stroke-width="34" stroke-linejoin="round">` +
  `<circle cx="652" cy="318" r="148" stroke="none"/><circle cx="564" cy="230" r="120" stroke="none"/><circle cx="740" cy="230" r="120" stroke="none"/>` +
  `<circle cx="564" cy="406" r="120" stroke="none"/><circle cx="740" cy="406" r="120" stroke="none"/><path d="M812 468 L884 566 L748 516 Z"/></g>` +
  `<g fill="none" stroke="${INK}" stroke-width="19" stroke-linecap="round"><path d="M598 270 q20 23 40 0"/><path d="M672 270 q20 23 40 0"/><path d="M606 318 q50 42 100 0"/></g></g>` +
  `<g class="buddy-body"><g fill="#FF5B1F" stroke="#FF5B1F" stroke-width="36" stroke-linejoin="round">` +
  `<rect x="150" y="440" width="570" height="400" rx="190" stroke="none"/><circle cx="262" cy="478" r="104" stroke="none"/><circle cx="404" cy="428" r="108" stroke="none"/>` +
  `<circle cx="552" cy="438" r="104" stroke="none"/><circle cx="662" cy="508" r="98" stroke="none"/><path d="M240 780 L182 900 L368 820 Z"/></g>` +
  `<g class="buddy-eyes"><circle cx="336" cy="610" r="76" fill="#fff"/><circle cx="540" cy="610" r="76" fill="#fff"/>` +
  `<g class="buddy-pupils"><circle cx="362" cy="592" r="41" fill="${INK}"/><circle cx="566" cy="592" r="41" fill="${INK}"/></g></g>` +
  `<path d="M360 704 H520 A80 74 0 0 1 360 704 Z" fill="${INK}"/><rect x="408" y="702" width="30" height="34" rx="8" fill="#fff"/><rect x="444" y="702" width="30" height="34" rx="8" fill="#fff"/></g>`

/** The welcome-screen hero: the duo for Buddies, otherwise the mark itself. */
export function logoHero(id: LogoId): { viewBox: string; inner: string; ratio: number } {
  if (id === 'buddies') return { viewBox: '130 90 792 848', inner: DUO_INNER, ratio: 848 / 792 }
  return { viewBox: '0 0 64 64', inner: logoMarkInner(id), ratio: 1 }
}

/**
 * App icon on its coloured tile. `small` = the version for 16-48 px (for Buddies only the orange
 * character, other logos are single characters already).
 */
export function logoIconSvg(id: LogoId, small = false): string {
  const meta = LOGOS[id] ?? LOGOS.buddies
  if (id === 'buddies' && !small) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="228" fill="${meta.background}"/>` +
      `<g transform="translate(528 516) scale(0.9) translate(-512 -505)">${DUO_INNER}</g></svg>`
    )
  }
  const scale = small ? 1 : 0.84
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="${meta.background}"/>` +
    `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${logoMarkInner(id)}</g></svg>`
  )
}
