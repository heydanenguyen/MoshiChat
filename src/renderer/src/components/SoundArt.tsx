import type { SoundId } from '@shared/types'

/**
 * One little character per message sound, drawn like the logo characters and stickers: flat colours
 * from the same palette, black features, round shapes, a face wherever it fits. 64×64 canvas.
 */
const INK = '#141414'
const ORANGE = '#FF5B1F'
const YELLOW = '#FFC21A'
const GREEN = '#13B26B'
const PINK = '#FF6FB5'
const SKY = '#7CC4FF'
const GRAPE = '#9B5DE5'
const PEACH = '#FFB38A'

/** Pastel tile behind each character (the logo picker uses the same idea). */
export const SOUND_TINTS: Record<SoundId | 'off', string> = {
  bubbles: '#D6EEFF',
  chirp: '#FFE3D1',
  boing: '#D8F5E6',
  twinkle: '#FFF1BF',
  marimba: '#FFE7D6',
  smooch: '#FFDDEB',
  off: '#E9E0FF'
}

const eyes = (x: number, y: number, gap: number, r = 1.9): string => `<circle cx="${x - gap}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${x + gap}" cy="${y}" r="${r}" fill="${INK}"/>`
const smile = (x: number, y: number, w: number): string => `<path d="M${x - w / 2} ${y} q${w / 2} ${w * 0.5} ${w} 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`
const shine = (x: number, y: number, r: number): string => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="0.85"/>`

const ART: Record<SoundId | 'off', string> = {
  // Three bubbles; the big one has a face, the others catch the light.
  bubbles:
    `<circle cx="27" cy="36" r="17" fill="${SKY}"/>${shine(20, 28, 3.2)}${eyes(28, 35, 5)}${smile(28, 41, 8)}` +
    `<circle cx="49" cy="20" r="8" fill="${PINK}"/>${shine(46, 17, 1.8)}` +
    `<circle cx="50" cy="44" r="5.5" fill="${YELLOW}"/>${shine(48, 42, 1.3)}`,
  // A round bird with a yellow beak and two notes.
  chirp:
    `<circle cx="27" cy="38" r="16" fill="${ORANGE}"/>` +
    `<path d="M14 46 l-8 4 l7 1z" fill="${ORANGE}"/>` +
    `<path d="M41 36 l9 3 l-9 3z" fill="${YELLOW}"/>` +
    `<circle cx="31" cy="33" r="2.2" fill="${INK}"/>` +
    `<path d="M20 44 q6 5 12 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M44 12v12M44 12l7-2v11" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="41.5" cy="25" r="3" fill="${INK}"/><circle cx="48.5" cy="22" r="3" fill="${INK}"/>`,
  // A coiled spring with a bouncing ball on top.
  boing:
    `<path d="M20 56 q12 -4 24 0 M20 50 q12 -4 24 0 M20 44 q12 -4 24 0" fill="none" stroke="${GREEN}" stroke-width="4" stroke-linecap="round"/>` +
    `<circle cx="32" cy="24" r="13" fill="${YELLOW}"/>${shine(26, 18, 2.6)}${eyes(32, 23, 4.5)}` +
    `<path d="M28 29 h8" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M14 30 l-4 -6 M50 30 l4 -6" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`,
  // A four-point sparkle with a calm face, plus two little ones.
  twinkle:
    `<path d="M32 8 Q35 27 52 30 Q35 33 32 52 Q29 33 12 30 Q29 27 32 8Z" fill="${YELLOW}"/>` +
    `<path d="M27 27 q2 2 4 0 M33 27 q2 2 4 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>${smile(32, 33, 6)}` +
    `<path d="M52 10 Q53 15 58 16 Q53 17 52 22 Q51 17 46 16 Q51 15 52 10Z" fill="${PINK}"/>` +
    `<path d="M11 44 Q12 48 16 49 Q12 50 11 54 Q10 50 6 49 Q10 48 11 44Z" fill="${SKY}"/>`,
  // Three wooden bars and two mallets; the middle bar smiles.
  marimba:
    `<rect x="9" y="34" width="12" height="20" rx="4" fill="${PEACH}"/>` +
    `<rect x="26" y="30" width="12" height="24" rx="4" fill="${ORANGE}"/>` +
    `<rect x="43" y="36" width="12" height="18" rx="4" fill="${PEACH}"/>` +
    `${eyes(32, 39, 3, 1.5)}${smile(32, 44, 5)}` +
    `<path d="M18 26 l8 -14 M46 26 l-8 -14" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<circle cx="27" cy="11" r="4.5" fill="${GRAPE}"/><circle cx="37" cy="11" r="4.5" fill="${GRAPE}"/>`,
  // Lips and a small heart.
  smooch:
    `<path d="M10 34 Q20 22 32 30 Q44 22 54 34 Q44 48 32 44 Q20 48 10 34Z" fill="${PINK}"/>` +
    `<path d="M14 34 Q32 38 50 34" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M52 12 c-3 -4 -9 -1 -9 4 c0 5 9 10 9 10 s9 -5 9 -10 c0 -5 -6 -8 -9 -4z" fill="${ORANGE}"/>`,
  // A sleepy bell with a slash.
  off:
    `<path d="M20 44 V30 a12 12 0 0 1 24 0 v14 l4 5 H16z" fill="${GRAPE}"/>` +
    `<circle cx="32" cy="16" r="3" fill="${GRAPE}"/><circle cx="32" cy="53" r="4" fill="${GRAPE}"/>` +
    `<path d="M26 34 q2 2 4 0 M34 34 q2 2 4 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M10 10 L54 54" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M10 10 L54 54" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
}

export function SoundArt({ id, size = 34 }: { id: SoundId | 'off'; size?: number }): JSX.Element {
  return <svg className="sound-art" width={size} height={size} viewBox="0 0 64 64" aria-hidden dangerouslySetInnerHTML={{ __html: ART[id] }} />
}
