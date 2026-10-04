/**
 * The Pixel style's art: hand-drawn 9x9 glyphs, one pixel wide like a pixel font, in ink on pastel tiles.
 * '#' is a filled pixel. Kept as text so a glyph can be read (and fixed) at a glance.
 */
export const PIXEL_GRID = 9

export const PIXEL_INK = '#190909'

/** The six pastels of the reference board, and the white and ink they sit with. */
export const PIXEL_PASTELS = {
  lime: '#dafd8c',
  periwinkle: '#dae1f9',
  lavender: '#c6b8ff',
  lilac: '#eacaff',
  sky: '#c6f1fd',
  lemon: '#fffa7c'
} as const
type Pastel = keyof typeof PIXEL_PASTELS

export const PIXEL_ART = {
  messenger: ['.#######.', '#.......#', '#.....#.#', '#..#.#..#', '#.#.#...#', '#.......#', '.#######.', '.##......', '.#.......'],
  instagram: ['.#######.', '#.......#', '#.....#.#', '#..###..#', '#..#.#..#', '#..###..#', '#.......#', '#.......#', '.#######.'],
  telegram: ['.........', '##.......', '.####....', '.#..####.', '..#....##', '.#..####.', '.####....', '##.......', '.........'],
  zalo: ['.#######.', '#.......#', '#..####.#', '#....#..#', '#...#...#', '#..####.#', '#.......#', '.#######.', '.##......'],
  whatsapp: ['..#####..', '.#.....#.', '#..#....#', '#..#....#', '#...#...#', '#....##.#', '#.......#', '##.....#.', '#.#####..'],
  gmail: ['.........', '#########', '##.....##', '#.#...#.#', '#..#.#..#', '#...#...#', '#.......#', '#########', '.........'],
  slack: ['...#.....', '...#.#...', '####.#...', '.....####', '..#......', '###.#....', '....#....', '....#.###', '.....#...'],
  general: ['.........', '..###....', '###.#####', '..###....', '.........', '....###..', '#####.###', '....###..', '.........'],
  appearance: ['..#####..', '.#.....#.', '#.#.#.#.#', '#.......#', '#.....###', '#....#...', '#....#...', '.#....#..', '..####...'],
  accounts: ['.........', '.##...##.', '####.####', '####.####', '.##...##.', '.........', '.###.###.', '####.####', '####.####'],
  chat: ['.#######.', '#.......#', '#.......#', '#.#.#.#.#', '#.......#', '#.......#', '.######.#', '.......##', '........#'],
  notifications: ['....#....', '..#####..', '.#.....#.', '.#.....#.', '.#.....#.', '.#.....#.', '#.......#', '#########', '...###...'],
  tags: ['#####....', '#....#...', '#.#...#..', '#......#.', '#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....'],
  ai: ['...#.....', '...#.....', '..###....', '#######..', '..###....', '...#...#.', '...#..###', '.......#.', '.........'],
  data: ['.#######.', '#.......#', '#########', '#.......#', '#.......#', '#########', '#.......#', '#.......#', '.#######.'],
  inbox: ['.........', '.#######.', '#.......#', '#.......#', '###...###', '#..###..#', '#.......#', '#########', '.........'],
  todos: ['.........', '...#.....', '#.#..####', '.#.......', '.........', '...#.....', '#.#..####', '.#.......', '.........'],
  insights: ['.........', '....#....', '....#....', '....#..#.', '.#..#..#.', '.#..#..#.', '.#..#..#.', '.#..#..#.', '#########'],
  // for the empty chat's tiles, not an app icon
  heart: ['.##...##.', '#..#.#..#', '#...#...#', '#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....', '.........'],
  smile: ['..#####..', '.#.....#.', '#.......#', '#.#...#.#', '#.......#', '#.#...#.#', '#..###..#', '.#.....#.', '..#####..']
} satisfies Record<string, string[]>
export type PixelName = keyof typeof PIXEL_ART

/** Each icon's tile. Neighbours in the sidebar and in Settings never share a colour. */
export const PIXEL_TILE: Record<PixelName, Pastel> = {
  messenger: 'lavender',
  instagram: 'lilac',
  telegram: 'sky',
  zalo: 'periwinkle',
  whatsapp: 'lime',
  gmail: 'lemon',
  slack: 'lilac',
  general: 'periwinkle',
  appearance: 'lilac',
  accounts: 'sky',
  chat: 'lime',
  notifications: 'lemon',
  tags: 'lilac',
  ai: 'lavender',
  data: 'sky',
  inbox: 'lavender',
  todos: 'lime',
  insights: 'lemon',
  heart: 'lilac',
  smile: 'lemon'
}

export const pixelTile = (name: PixelName): string => PIXEL_PASTELS[PIXEL_TILE[name]]

/** A pixel glyph's size for a tile or slot: a whole multiple of the 9-pixel grid, so no row or column is lost. */
export const pixelGlyphSize = (target: number): number => Math.max(PIXEL_GRID, Math.round(target / PIXEL_GRID) * PIXEL_GRID)

/** One SVG path of horizontal runs, so neighbouring pixels never show a hairline seam between them. */
export function pixelPath(name: PixelName): string {
  let d = ''
  PIXEL_ART[name].forEach((row, y) => {
    for (const run of row.matchAll(/#+/g)) d += `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`
  })
  return d
}

/**
 * The Mono style's palette: twelve pastels at one lightness, one hue apart each, so no two icons in the sidebar or
 * Settings look alike. The app icons follow their brands (Messenger and Instagram in their own gradients, made
 * pastel); tags take the hue of their own colour. Other styles keep the board pastels above.
 */
export const MONO_HUES = {
  red: '#ffc9c4',
  orange: '#ffd9b5',
  yellow: '#fff1a1',
  lime: '#e1f7a0',
  green: '#bff2da',
  teal: '#b9ede4',
  sky: '#c0e7fa',
  blue: '#c9d7ff',
  indigo: '#d6d1ff',
  violet: '#e7ceff',
  pink: '#ffcfe5',
  grey: '#e3e3e8',
  // picked one by one from the deeper and lighter rows of the same tone
  orangeDeep: '#fec690',
  redDeep: '#ffbbb3',
  periwinkle: '#dfe0ff'
} as const

/** The two apps whose brands are gradients keep them, in pastel. */
const MONO_GRADIENT: Partial<Record<PixelName, string>> = {
  messenger: 'linear-gradient(135deg, #e3c8ff, #c3d8ff)',
  instagram: 'linear-gradient(135deg, #ffd9b0, #ffc6dc 50%, #e4c9ff)'
}
export type MonoHue = keyof typeof MONO_HUES

const MONO_ICON: Record<PixelName, MonoHue> = {
  inbox: 'orangeDeep',
  messenger: 'violet',
  instagram: 'pink',
  telegram: 'sky',
  zalo: 'blue',
  whatsapp: 'green',
  gmail: 'red',
  slack: 'violet',
  todos: 'lime',
  insights: 'yellow',
  general: 'grey',
  appearance: 'pink',
  accounts: 'teal',
  chat: 'green',
  notifications: 'yellow',
  tags: 'red',
  ai: 'indigo',
  data: 'sky',
  heart: 'pink',
  smile: 'yellow'
}

/** An icon's tile in the Mono style. */
export const monoTile = (name: PixelName): string => MONO_GRADIENT[name] ?? MONO_HUES[MONO_ICON[name]]

/**
 * Built-in tags still in their own colour get a hue picked for Mono, so the six read apart at a glance: Love red,
 * VIP yellow, Family periwinkle, Best friend teal. A built-in tag the user recoloured follows its new colour.
 */
const BUILTIN_HUE: Record<string, { color: string; hue: MonoHue }> = {
  love: { color: '#e0457f', hue: 'redDeep' },
  vip: { color: '#a052e8', hue: 'yellow' },
  family: { color: '#11996a', hue: 'periwinkle' },
  friend: { color: '#ec7212', hue: 'teal' }
}

/** The tag palette's colours (types.ts TAG_PALETTE), each with its Mono hue. */
const TAG_HUE_OF: Record<string, MonoHue> = {
  '#3b82ee': 'blue',
  '#5a9a0b': 'lime',
  '#11996a': 'green',
  '#ec7212': 'orange',
  '#a052e8': 'violet',
  '#e0457f': 'pink',
  '#0a97b5': 'sky',
  '#dc4436': 'red',
  '#b07415': 'yellow',
  '#56657c': 'grey'
}

/** Hue (0-360) and saturation (0-1) of a #rrggbb colour. */
function hueSat(hex: string): { h: number; s: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1)) }
}

/** A tag's Mono hue: the palette's own, or for a custom colour the hue nearest to it (grey when greyish). */
export function tagPastel(color: string, id?: string): string {
  const hex = color.toLowerCase()
  const builtin = id ? BUILTIN_HUE[id] : undefined
  if (builtin && builtin.color === hex) return MONO_HUES[builtin.hue]
  const known = TAG_HUE_OF[hex]
  if (known) return MONO_HUES[known]
  if (!/^#[0-9a-f]{6}$/.test(hex)) return MONO_HUES.grey
  const { h, s } = hueSat(hex)
  if (s < 0.18) return MONO_HUES.grey
  let best: MonoHue = 'grey'
  let bestGap = 361
  for (const [name, hue] of Object.entries(MONO_HUES) as Array<[MonoHue, string]>) {
    if (name === 'grey' || name === 'orangeDeep' || name === 'redDeep' || name === 'periwinkle') continue
    const gap = Math.abs(hueSat(hue).h - h)
    const around = Math.min(gap, 360 - gap)
    if (around < bestGap) {
      bestGap = around
      best = name
    }
  }
  return MONO_HUES[best]
}
