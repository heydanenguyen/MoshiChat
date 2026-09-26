/**
 * Playful abstract avatars for contacts without a photo: a colored shape with
 * a tiny face on a black disc. Deterministic per name, so the same person
 * always gets the same character.
 */

const COLORS = ['#FFB3C1', '#5BBF6C', '#FFA24C', '#7FD3FF', '#2F7BFF', '#FF6A4D', '#FFB6C9', '#FFD35C', '#B98CFF', '#4CD9C0']

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const SHAPES: Array<(c: string) => string> = [
  // trapezoid with a fringe
  (c) => `<path d="M30 30h40l14 72H16z" fill="${c}"/><path d="M28 30h44v12H28z" fill="#0b0b0b"/>`,
  // rounded blob leaning left
  (c) => `<path d="M12 40c8-26 42-30 62-16 24 16 26 52 6 70S14 96 12 66c-1-9-2-18 0-26z" fill="${c}"/>`,
  // tilted card
  (c) => `<path d="M18 36 78 16l14 60-52 24z" fill="${c}"/>`,
  // wave / snake
  (c) => `<path d="M8 50c0-18 22-26 36-14 12 10 14 26 30 26 20 0 26-14 26-24v56H8z" fill="${c}"/>`,
  // spiky star
  (c) => `<path d="m50 10 10 18 20-6-5 20 19 10-19 8 7 20-21-4-11 18-11-18-21 4 7-20-19-8 19-10-5-20 20 6z" fill="${c}"/>`,
  // clover
  (c) => `<circle cx="35" cy="38" r="22" fill="${c}"/><circle cx="65" cy="38" r="22" fill="${c}"/><circle cx="35" cy="66" r="22" fill="${c}"/><circle cx="65" cy="66" r="22" fill="${c}"/><rect x="44" y="60" width="12" height="40" fill="${c}"/>`,
  // scallop shell
  (c) => `<circle cx="26" cy="46" r="14" fill="${c}"/><circle cx="42" cy="36" r="14" fill="${c}"/><circle cx="58" cy="36" r="14" fill="${c}"/><circle cx="74" cy="46" r="14" fill="${c}"/><path d="M12 48h76v18c0 20-18 34-38 34S12 86 12 66z" fill="${c}"/>`,
  // bottle / bell
  (c) => `<path d="M40 8h20v14c18 6 30 22 30 42v36H10V64c0-20 12-36 30-42z" fill="${c}"/>`
]

const EYES: string[] = [
  '<circle cx="38" cy="54" r="3.2" fill="#111"/><circle cx="62" cy="54" r="3.2" fill="#111"/>',
  '<path d="M32 54h12M56 54h12" stroke="#111" stroke-width="3.5" stroke-linecap="round"/>',
  '<path d="M32 56c3-5 9-5 12 0M56 56c3-5 9-5 12 0" fill="none" stroke="#111" stroke-width="3.5" stroke-linecap="round"/>',
  '<path d="m32 50 6 5-6 5M68 50l-6 5 6 5" fill="none" stroke="#111" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M32 58c3-6 9-6 12 0M56 58c3-6 9-6 12 0" fill="none" stroke="#111" stroke-width="3.5" stroke-linecap="round" transform="rotate(180 50 55)"/>'
]

const MOUTHS: string[] = [
  '<path d="M42 68c4 5 12 5 16 0" fill="none" stroke="#111" stroke-width="3.5" stroke-linecap="round"/>',
  '<path d="M43 68h14" stroke="#111" stroke-width="3.5" stroke-linecap="round"/>',
  '<circle cx="50" cy="69" r="4" fill="none" stroke="#111" stroke-width="3.5"/>',
  '<path d="M44 66c2 4 4 4 6 0 2 4 4 4 6 0" fill="none" stroke="#111" stroke-width="3.5" stroke-linecap="round"/>',
  '<path d="M42 71c4-5 12-5 16 0" fill="none" stroke="#111" stroke-width="3.5" stroke-linecap="round"/>',
  '<path d="M44 67h12l-6 6z" fill="#111"/>'
]

export function abstractAvatarSvg(seed: string): string {
  const h = hash(seed || '?')
  const color = COLORS[h % COLORS.length]
  const shape = SHAPES[(h >>> 4) % SHAPES.length](color)
  const eyes = EYES[(h >>> 8) % EYES.length]
  const mouth = MOUTHS[(h >>> 12) % MOUTHS.length]
  const flip = (h >>> 16) & 1 ? 'transform="scale(-1 1) translate(-100 0)"' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath><g clip-path="url(#c)"><circle cx="50" cy="50" r="50" fill="#0b0b0b"/><g ${flip}>${shape}</g>${eyes}${mouth}</g></svg>`
}

const cache = new Map<string, string>()

/** Data URL for an <img src>, cached per seed. */
export function abstractAvatarUrl(seed: string): string {
  let url = cache.get(seed)
  if (!url) {
    url = 'data:image/svg+xml;utf8,' + encodeURIComponent(abstractAvatarSvg(seed))
    cache.set(seed, url)
  }
  return url
}
