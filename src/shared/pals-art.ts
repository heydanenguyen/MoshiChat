/**
 * Pals artwork: the characters of the Pals style as plain SVG strings (no React), shared by the renderer (avatars,
 * the empty screens) and design/pals (the animated sticker pack, rendered frame by frame from the same parts).
 * Soft candy bodies (a scallop, a flower, a sun, a clover, a water drop, a cotton candy, a little ghost, an egg, a flan)
 * lit like a gummy from the top left, with faces drawn in thick black ink.
 */
export type PalShape = 'scallop' | 'flower' | 'sun' | 'clover' | 'drop' | 'cotton' | 'ghost' | 'egg' | 'flan'
export type PalFace = 'smile' | 'joy' | 'sleepy' | 'wink' | 'grumpy' | 'wow' | 'meh' | 'love' | 'cry' | 'laugh' | 'cheeky' | 'kiss'

/** Every expression, in the order the pickers show them. */
export const PAL_FACES: PalFace[] = ['smile', 'joy', 'laugh', 'wink', 'cheeky', 'love', 'kiss', 'wow', 'meh', 'sleepy', 'grumpy', 'cry']
export type PalExtra = 'zz'

export interface PalSpec {
  shape: PalShape
  color: string
  /** Second gradient stop (cotton candy fades pink to lilac); absent = the colour deepens a little. */
  color2?: string
  face: PalFace
  extra?: PalExtra
  blush?: boolean
}

export const INK = '#000'

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (c: number[]): string => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
/** Mix toward white (amount > 0) or black (amount < 0). */
export const shade = (hex: string, amount: number): string => toHex(channels(hex).map((v) => (amount > 0 ? v + (255 - v) * amount : v * (1 + amount))))

/** Scallop edge: |cos| gives round lobes with pinched valleys, like a flower-shaped gummy. */
function scallopPath(cx: number, cy: number, r: number, amp: number, lobes: number): string {
  const steps = lobes * 14
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2
    const rr = r + amp * (Math.abs(Math.cos((lobes * a) / 2)) * 2 - 1)
    d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`
  }
  return d + 'Z'
}

/** Points around 60,62 (angle 0 = up). */
const around = (count: number, radius: number, offset = 0): Array<[number, number, number]> =>
  Array.from({ length: count }, (_, i) => {
    const deg = offset + (i * 360) / count
    const a = ((deg - 90) * Math.PI) / 180
    return [+(60 + radius * Math.cos(a)).toFixed(1), +(62 + radius * Math.sin(a)).toFixed(1), deg]
  })

/** Bodies. Everything inside one body shares one gradient (userSpaceOnUse), so overlapping parts read as one gummy. */
const BODY: Record<PalShape, string> = {
  scallop: `<path d="${scallopPath(60, 62, 44, 5, 9)}"/>`,
  flower: around(6, 31)
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="21"/>`)
    .join(''),
  sun:
    '<circle cx="60" cy="62" r="35"/>' +
    around(10, 0)
      .map(([, , deg]) => `<rect x="55.5" y="4" width="9" height="17" rx="4.5" transform="rotate(${deg} 60 62)"/>`)
      .join(''),
  // four chubby round leaves on the diagonals, joined by a round middle
  clover:
    around(4, 25, 45)
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="23"/>`)
      .join('') + '<circle cx="60" cy="62" r="20"/>',
  drop: '<path d="M60 8c4 8 40 44 40 70 0 22-17 36-40 36S20 100 20 78C20 52 56 16 60 8z"/>',
  ghost: '<path d="M22 60c0-26 17-46 38-46s38 20 38 46v44c0 6-6 8-10 4l-6-6-8 8c-3 3-7 3-10 0l-4-5-4 5c-3 3-7 3-10 0l-8-8-6 6c-4 4-10 2-10-4z"/>',
  cotton: '<circle cx="38" cy="54" r="21"/><circle cx="60" cy="38" r="24"/><circle cx="83" cy="53" r="21"/><circle cx="46" cy="76" r="22"/><circle cx="74" cy="76" r="22"/><circle cx="60" cy="60" r="26"/>',
  // the yolk; the white sits behind it
  egg: '<circle cx="60" cy="64" r="30"/>',
  // a wobbly flan on a plate, caramel on top
  flan: '<path d="M32 42c0-6 4-10 10-10h36c6 0 10 4 10 10l10 54c1 6-3 10-9 10H31c-6 0-10-4-9-10z"/>'
}

/** Parts drawn behind the body (a stem, a stick, an egg white, a plate) and over it (a centre disc, a glint, caramel). */
const BEHIND: Partial<Record<PalShape, string>> = {
  clover: '<path d="M62 70c6 18 14 32 28 42" fill="none" stroke="#3f9f4f" stroke-width="7" stroke-linecap="round"/>',
  cotton: '<rect x="56" y="88" width="8" height="30" rx="4" fill="#f1dcb8"/>',
  egg: '<path d="M20 58c-6-22 14-40 34-36 12-12 34-8 40 6 18 4 24 26 14 40 8 18-8 38-28 34-14 12-38 8-46-6-18-4-26-24-14-38z" fill="#fffaf2"/><path d="M20 58c-6-22 14-40 34-36 12-12 34-8 40 6 18 4 24 26 14 40 8 18-8 38-28 34-14 12-38 8-46-6-18-4-26-24-14-38z" fill="none" stroke="#000" stroke-opacity=".06" stroke-width="2"/>',
  flan: '<ellipse cx="60" cy="106" rx="50" ry="8" fill="#fff"/><ellipse cx="60" cy="106" rx="50" ry="8" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="2"/>'
}
const OVER: Partial<Record<PalShape, string>> = {
  flower: '<circle cx="60" cy="62" r="27" fill="url(#CORE)"/>',
  drop: '<ellipse cx="40" cy="66" rx="5.5" ry="11" fill="#fff" opacity=".55" transform="rotate(18 40 66)"/>',
  flan:
    '<path d="M32 42c0-6 4-10 10-10h36c6 0 10 4 10 10v6c-2 8-8 8-10 2-2-6-6-6-8 2-2 8-8 8-10 0-2-6-6-6-8 0-2 8-8 8-10 0-2-6-6-6-8 0-2 6-8 6-10-2z" fill="#b8642c"/>' +
    '<path d="M40 38h18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/>'
}

/** Where each body carries its face (canonical faces are drawn around 60,62). */
const FACE_AT: Record<PalShape, [number, number]> = {
  scallop: [0, 0],
  flower: [0, 1],
  sun: [0, 0],
  clover: [0, 0],
  drop: [0, 12],
  cotton: [0, 0],
  ghost: [0, -4],
  egg: [0, 2],
  flan: [0, 14]
}
/** Faces on the smaller centres (flower, sun, the yolk, the flan) are drawn a little smaller so they stay inside. */
const FACE_SCALE: Partial<Record<PalShape, number>> = { flower: 1.02, sun: 1.1, clover: 1.1, ghost: 1.1, egg: 0.92, flan: 0.95 }

export const stroke = `fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`

/** A small heart centred on x,y (for love eyes and the kiss). */
export const heart = (x: number, y: number, size: number, fill: string): string =>
  `<path d="M0 6C-6 2-9-1-9-4c0-3 2-5 4.5-5 2 0 3.5 1 4.5 3 1-2 2.5-3 4.5-3 2.5 0 4.5 2 4.5 5 0 3-3 6-9 10z" fill="${fill}" transform="translate(${x} ${y - 1}) scale(${size})"/>`

/** Eyes sit in their own group so the empty-screen characters can blink. */
export const FACE: Record<PalFace, { eyes: string; mouth: string }> = {
  smile: {
    eyes: `<circle cx="48" cy="58" r="4.8" fill="${INK}"/><circle cx="72" cy="58" r="4.8" fill="${INK}"/>`,
    mouth: `<path d="M53 70q7 7 14 0" ${stroke}/>`
  },
  // round sparkling eyes over an open laugh
  joy: {
    eyes:
      `<circle cx="48" cy="58" r="6" fill="${INK}"/><circle cx="72" cy="58" r="6" fill="${INK}"/>` +
      '<circle cx="50" cy="55.5" r="2.2" fill="#fff"/><circle cx="74" cy="55.5" r="2.2" fill="#fff"/><circle cx="46.5" cy="60" r="1" fill="#fff"/><circle cx="70.5" cy="60" r="1" fill="#fff"/>',
    mouth: `<path d="M51 69h18q-1 12-9 12t-9-12z" fill="${INK}"/><path d="M55 77q5-4 10 0-2 3-5 3t-5-3z" fill="#ff6f8e"/>`
  },
  sleepy: {
    eyes: `<path d="M41 58q7 7 14 0M65 58q7 7 14 0" ${stroke}/>`,
    mouth: `<path d="M56 74q4-3 8 0" ${stroke}/>`
  },
  wink: {
    eyes: `<circle cx="48" cy="58" r="4.8" fill="${INK}"/><path d="M65 59q7-8 14 0" ${stroke}/>`,
    mouth: `<path d="M52 69q8 9 16 0" ${stroke}/>`
  },
  grumpy: {
    eyes: `<path d="M39 49l14 5M81 49l-14 5" ${stroke}/><circle cx="48" cy="61" r="4.2" fill="${INK}"/><circle cx="72" cy="61" r="4.2" fill="${INK}"/>`,
    mouth: `<path d="M54 76q6-5 12 0" ${stroke}/>`
  },
  // Big white eyes with no outline (the white alone sets them off the candy), pupils looking slightly down.
  wow: {
    eyes:
      `<circle cx="47" cy="57" r="10" fill="#fff"/><circle cx="73" cy="57" r="10" fill="#fff"/>` +
      `<circle cx="48.5" cy="59" r="5.6" fill="${INK}"/><circle cx="74.5" cy="59" r="5.6" fill="${INK}"/>` +
      `<circle cx="50.5" cy="57" r="1.6" fill="#fff"/><circle cx="76.5" cy="57" r="1.6" fill="#fff"/>`,
    mouth: `<ellipse cx="60" cy="77" rx="3.6" ry="4.6" fill="${INK}"/>`
  },
  meh: {
    eyes:
      `<path d="M36 56a11 11 0 0 0 22 0zM62 56a11 11 0 0 0 22 0z" fill="#fff"/>` +
      `<circle cx="47" cy="61.5" r="4.2" fill="${INK}"/><circle cx="73" cy="61.5" r="4.2" fill="${INK}"/>`,
    mouth: `<path d="M54 74h12" ${stroke}/>`
  },
  love: {
    eyes: heart(48, 58, 1, '#ff4f7b') + heart(72, 58, 1, '#ff4f7b'),
    mouth: `<path d="M52 70q8 9 16 0" ${stroke}/>`
  },
  // big glossy eyes welling up (a pool of blue at the bottom of each), a trembling frown, one tear rolling down
  cry: {
    eyes:
      `<circle cx="48" cy="58" r="7.5" fill="${INK}"/><circle cx="72" cy="58" r="7.5" fill="${INK}"/>` +
      '<path d="M40.8 60a7.5 7.5 0 0 0 14.4 0zM64.8 60a7.5 7.5 0 0 0 14.4 0z" fill="#6cc0ff"/>' +
      '<circle cx="50.5" cy="55" r="2.6" fill="#fff"/><circle cx="74.5" cy="55" r="2.6" fill="#fff"/><circle cx="46" cy="59" r="1.2" fill="#fff"/><circle cx="70" cy="59" r="1.2" fill="#fff"/>',
    mouth:
      `<path d="M54 77q6-5 12 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>` +
      '<g transform="translate(41 74) scale(.8)"><path d="M0-8s-5 6.5-5 10a5 5 0 0 0 10 0c0-3.5-5-10-5-10z" fill="#4aa8ff"/><circle cx="-1.6" cy="3" r="1.3" fill="#fff" opacity=".85"/></g>'
  },
  // squeezed > < eyes over a big open laugh
  laugh: {
    eyes: `<path d="M41 51l11 7-11 7M79 51l-11 7 11 7" ${stroke}/>`,
    mouth: `<path d="M46 69h28q-2 18-14 18t-14-18z" fill="${INK}"/><path d="M52 82q8-7 16 0-3 5-8 5t-8-5z" fill="#ff6f8e"/>`
  },
  // a sly half smile with the tongue poking out of one corner
  cheeky: {
    eyes: `<circle cx="48" cy="59" r="4.8" fill="${INK}"/><circle cx="72" cy="59" r="4.8" fill="${INK}"/>`,
    mouth:
      '<g transform="translate(67 72) rotate(-22)"><path d="M-5 0v5a5 5 0 0 0 10 0v-5z" fill="#ff6f8e"/><path d="M0 1.5v7" stroke="#e24a72" stroke-width="1.6" stroke-linecap="round"/></g>' +
      `<path d="M50 71q9 4 22-3" ${stroke}/>`
  },
  // shut happy eyes, puckered lips and a little heart floating off
  kiss: {
    eyes: `<path d="M41 60q7-8 14 0M65 60q7-8 14 0" ${stroke}/>`,
    mouth: `<path d="M58 69q6 2 1 5 5 3-1 6" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` + heart(80, 76, 0.7, '#ff4f7b')
  }
}

export const EXTRA: Record<PalExtra, string> = {
  zz: `<path d="M92 18h9l-9 10h9M104 6h6l-6 7h6" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
}

/** A character taken apart, so the sticker frames can move each piece (see design/pals). */
export interface PalParts {
  /** Gradients: the body's (`url(#<fill>)`) and the cream one (`url(#<fill>c)`). */
  defs: string
  fill: string
  /** Drawn behind the body (stem, stick, egg white, plate), the body shapes, and over it (centre disc, glint, caramel). */
  behind: string
  body: string
  over: string
  /** Where the face sits: translate to x,y and scale (canonical faces are drawn around 60,62). */
  face: { x: number; y: number; scale: number }
  blush: string
  eyes: string
  mouth: string
  extra: string
}

export function palParts(spec: PalSpec, uid: string): PalParts {
  const g = `pal-${uid}`
  const [dx, dy] = FACE_AT[spec.shape]
  const end = spec.color2 ?? shade(spec.color, -0.14)
  return {
    defs:
      `<radialGradient id="${g}" gradientUnits="userSpaceOnUse" cx="44" cy="36" r="92"><stop offset="0" stop-color="${shade(spec.color, 0.55)}"/><stop offset=".5" stop-color="${spec.color}"/><stop offset="1" stop-color="${end}"/></radialGradient>` +
      // the flower's centre: a cream disc lit the same way
      `<radialGradient id="${g}c" gradientUnits="userSpaceOnUse" cx="52" cy="52" r="34"><stop offset="0" stop-color="#fffbe9"/><stop offset="1" stop-color="#ffe49a"/></radialGradient>`,
    fill: g,
    behind: BEHIND[spec.shape] ?? '',
    body: BODY[spec.shape],
    over: (OVER[spec.shape] ?? '').replace('url(#CORE)', `url(#${g}c)`),
    // Faces are drawn a size up from their canonical coordinates: the features carry the character.
    face: { x: dx + 60, y: dy + 62, scale: FACE_SCALE[spec.shape] ?? 1.2 },
    blush: spec.blush
      ? `<ellipse cx="37" cy="69" rx="6.5" ry="3.6" fill="#ff5f8f" opacity=".32"/><ellipse cx="83" cy="69" rx="6.5" ry="3.6" fill="#ff5f8f" opacity=".32"/>`
      : '',
    eyes: FACE[spec.face].eyes,
    mouth: FACE[spec.face].mouth,
    extra: spec.extra ? EXTRA[spec.extra] : ''
  }
}

/** One character as SVG markup. `uid` keeps gradient ids unique when several sit inline on one page. */
export function palSvg(spec: PalSpec, uid: string, opts: { ground?: boolean; live?: boolean } = {}): string {
  const p = palParts(spec, uid)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"${opts.live ? ' class="pal-live"' : ''}>` +
    `<defs>${p.defs}</defs>` +
    (opts.ground ? '<ellipse cx="60" cy="116" rx="32" ry="3.6" fill="#000" opacity=".1"/>' : '') +
    p.behind +
    `<g fill="url(#${p.fill})">${p.body}</g>` +
    p.over +
    `<g transform="translate(${p.face.x} ${p.face.y}) scale(${p.face.scale}) translate(-60 -62)">${p.blush}<g class="pal-eyes">${p.eyes}</g>${p.mouth}</g>` +
    p.extra +
    '</svg>'
  )
}

/**
 * The cast. Each pal keeps its body and colour; avatars vary the face (from `faces`) and the backdrop (from
 * `backdrops`). Backdrops come from across the colour wheel, never the pal's own hue: pale tints behind the deeper
 * pals, mid tones behind the light ones (flan, the egg's white), so there is always a clear lightness step between pal and
 * backdrop. tests/pals-colors.test.ts measures both in OKLCH.
 */
export interface CastMember {
  id: string
  name: { vi: string; en: string }
  shape: PalShape
  color: string
  color2?: string
  /** The colour that meets the backdrop when it is not the body's (the egg's white); colour tests use it. */
  edge?: string
  blush?: boolean
  faces: PalFace[]
  backdrops: string[]
}

export const CAST: CastMember[] = [
  { id: 'hoa', name: { vi: 'Hoa', en: 'Bloom' }, shape: 'flower', color: '#ff8fc4', blush: true, faces: ['smile', 'joy', 'wink'], backdrops: ['#dcf5e3', '#fff1c9'] },
  { id: 'nang', name: { vi: 'Mặt trời', en: 'Sunshine' }, shape: 'sun', color: '#ffb81f', faces: ['joy', 'smile', 'wink'], backdrops: ['#dcecff', '#ece4ff'] },
  { id: 'co', name: { vi: 'Cỏ', en: 'Lucky' }, shape: 'clover', color: '#7fd987', faces: ['wow', 'wink', 'smile'], backdrops: ['#ffe4ef', '#fff1c9'] },
  { id: 'giot', name: { vi: 'Giọt', en: 'Drip' }, shape: 'drop', color: '#7cc3ff', faces: ['smile', 'wow', 'meh'], backdrops: ['#ffe9da', '#fff3cc'] },
  { id: 'bong', name: { vi: 'Bông', en: 'Fluff' }, shape: 'cotton', color: '#ffb0da', color2: '#c3adff', faces: ['joy', 'wink', 'smile'], backdrops: ['#dcefff', '#dcf5ea'] },
  { id: 'ma', name: { vi: 'Ma nhỏ', en: 'Boo' }, shape: 'ghost', color: '#c4adff', faces: ['wow', 'smile', 'meh'], backdrops: ['#fff1c7', '#dcf6e6'] },
  { id: 'may', name: { vi: 'Mây', en: 'Cloudy' }, shape: 'scallop', color: '#96ccff', blush: true, faces: ['smile', 'joy', 'wow'], backdrops: ['#fff1c4', '#ffe3ee'] },
  { id: 'trung', name: { vi: 'Trứng', en: 'Eggy' }, shape: 'egg', color: '#ffc23a', edge: '#fffaf2', faces: ['smile', 'joy', 'wink'], backdrops: ['#c2b0ff', '#88c0ff'] },
  { id: 'flan', name: { vi: 'Flan', en: 'Flan' }, shape: 'flan', color: '#ffd45c', faces: ['joy', 'wow', 'wink'], backdrops: ['#b8a6ff', '#ff8fbf'] }
]

export const castById = (id: string): CastMember => CAST.find((c) => c.id === id) ?? CAST[0]

export const specOf = (member: CastMember, face: PalFace, extra?: PalExtra): PalSpec => ({
  shape: member.shape,
  color: member.color,
  color2: member.color2,
  blush: member.blush,
  face,
  extra
})

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Expressions an avatar can get by itself: open-eyed and friendly (no sleepy, grumpy or crying faces). */
export const AVATAR_FACES: PalFace[] = ['smile', 'joy', 'laugh', 'wink', 'cheeky', 'love', 'kiss', 'wow']

/**
 * The pal a name gets: same name, same pal, face and backdrop. The face comes from every friendly expression (not just
 * the pal's own three), so two people who share a pal still look apart in a list.
 */
export function palOf(seed: string): { member: CastMember; spec: PalSpec; backdrop: string } {
  const h = hash(seed || '?')
  const member = CAST[h % CAST.length]
  const face = AVATAR_FACES[(h >>> 8) % AVATAR_FACES.length]
  return { member, spec: specOf(member, face), backdrop: member.backdrops[(h >>> 16) % member.backdrops.length] }
}

const avatarCache = new Map<string, string>()

/** A pal on a tinted disc, rising from its bottom edge, as a data URL (cached by key). */
function avatarUrl(key: string, spec: PalSpec, backdrop: string): string {
  let url = avatarCache.get(key)
  if (!url) {
    const inner = palSvg(spec, 'a').replace(/^<svg[^>]*>|<\/svg>$/g, '')
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><clipPath id="c"><circle cx="60" cy="60" r="60"/></clipPath>' +
      `<g clip-path="url(#c)"><rect width="120" height="120" fill="${backdrop}"/><g transform="translate(-11 -7) scale(1.18)">${inner}</g></g></svg>`
    url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
    avatarCache.set(key, url)
  }
  return url
}

/** Avatar for contacts without a photo: the pal fills a tinted disc, rising from its bottom edge. */
export function palAvatarUrl(seed: string): string {
  const { spec, backdrop } = palOf(seed)
  return avatarUrl(`seed:${seed}`, spec, backdrop)
}

/** A pal picked by hand for a contact, kept as `pal:<cast id>.<expression>.<backdrop index>` in its settings. */
export interface PalPick {
  member: CastMember
  face: PalFace
  backdrop: number
}

export const palPickId = (pick: PalPick): string => `pal:${pick.member.id}.${pick.face}.${pick.backdrop}`

export function parsePalPickId(value: string): PalPick | undefined {
  const m = /^pal:([a-z]+)\.([a-z]+)\.(\d)$/.exec(value)
  const member = m && CAST.find((c) => c.id === m[1])
  if (!m || !member || !PAL_FACES.includes(m[2] as PalFace) || Number(m[3]) >= member.backdrops.length) return undefined
  return { member, face: m[2] as PalFace, backdrop: Number(m[3]) }
}

/** Data URL for a picked pal (undefined when the value is not one). */
export function palPickUrl(value: string): string | undefined {
  const pick = parsePalPickId(value)
  return pick && avatarUrl(value, specOf(pick.member, pick.face), pick.member.backdrops[pick.backdrop])
}

/**
 * Pals to pick from: the one this name already gets first, then every pal of the cast. Each round moves every pal on
 * to its next expression and its other backdrop, so shuffling walks through all twelve expressions.
 */
export function palPicks(seed: string, round: number): PalPick[] {
  const own = palOf(seed)
  const picks: PalPick[] = round === 0 ? [{ member: own.member, face: own.spec.face, backdrop: own.member.backdrops.indexOf(own.backdrop) }] : []
  for (const member of CAST) {
    const face = PAL_FACES[(PAL_FACES.indexOf(member.faces[0]) + round) % PAL_FACES.length]
    const pick = { member, face, backdrop: round % member.backdrops.length }
    if (!picks.some((p) => palPickId(p) === palPickId(pick))) picks.push(pick)
  }
  return picks
}
