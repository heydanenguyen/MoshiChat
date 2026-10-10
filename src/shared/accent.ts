/**
 * Custom accents: the user picks one colour or a two-colour gradient; everything the theme needs
 * (hover, soft tints, bubble fill, shadows, readable text on top) is derived here.
 */

export interface AccentSpec {
  from: string
  /** Second stop for a gradient; absent = a single solid colour. */
  to?: string
}

const HEX = /^#([0-9a-f]{6})$/i

export const isHexColor = (value: string): boolean => HEX.test(value.trim())

function rgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim())
  if (!m) return [79, 125, 243]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = ([r, g, b]: [number, number, number]): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

/** Mix toward black (amount 0..1). */
const darken = (hex: string, amount: number): string => toHex(rgb(hex).map((v) => v * (1 - amount)) as [number, number, number])

const mix = (a: string, b: string): string => {
  const [x, y] = [rgb(a), rgb(b)]
  return toHex([(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2])
}

/** WCAG relative luminance (0 dark .. 1 light). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Text colour that reads best on top of the accent (checks both stops of a gradient). */
export function textOn(spec: AccentSpec): '#ffffff' | '#141414' {
  const stops = spec.to ? [spec.from, spec.to] : [spec.from]
  // White needs contrast >= ~2.6 on every stop for bold UI text; otherwise use near-black.
  const whiteOk = stops.every((c) => 1.05 / (luminance(c) + 0.05) >= 2.6)
  return whiteOk ? '#ffffff' : '#141414'
}

/** CSS custom properties for a custom accent (applied on :root). */
export function accentVars(spec: AccentSpec): Record<string, string> {
  const from = isHexColor(spec.from) ? spec.from : '#4f7df3'
  const to = spec.to && isHexColor(spec.to) ? spec.to : undefined
  const base = to ? mix(from, to) : from
  const [r, g, b] = rgb(base)
  const fill = to ? `linear-gradient(135deg, ${from} 0%, ${to} 100%)` : from
  const text = textOn({ from, to })
  return {
    '--accent': darken(base, luminance(base) > 0.6 ? 0.28 : 0),
    '--accent-hover': darken(base, 0.1),
    '--accent-2': to ?? from,
    '--accent-gradient': fill,
    '--accent-soft': `rgba(${r}, ${g}, ${b}, 0.14)`,
    '--accent-soft-2': `rgba(${r}, ${g}, ${b}, 0.1)`,
    '--bubble-out': fill,
    '--bubble-out-solid': base,
    '--bubble-out-text': text,
    '--on-accent': text,
    '--bubble-out-shadow': `0 6px 16px rgba(${r}, ${g}, ${b}, 0.28)`,
    // Pale enough for dark text: a hairline edge keeps the bubble from melting into a light chat.
    '--bubble-out-ring': text === '#141414' ? 'inset 0 0 0 1px rgba(20, 20, 20, 0.1)' : 'inset 0 0 0 0 transparent',
    '--accent-shadow': `0 6px 16px rgba(${r}, ${g}, ${b}, 0.3)`,
    '--accent-shadow-strong': `0 9px 22px rgba(${r}, ${g}, ${b}, 0.42)`
  }
}

export const ACCENT_VAR_NAMES = Object.keys(accentVars({ from: '#000000' }))

/** Nudge every channel by `n` (the dark surfaces sit a few steps above the base). */
const lift = (hex: string, n: number): [number, number, number] => rgb(hex).map((v) => Math.min(255, v + n)) as [number, number, number]

/**
 * CSS custom properties for a dark-mode base colour: the window, the glass panels, the sidebar and
 * elevated sheets all follow it, keeping the same steps the navy default uses (#0f1122 -> #14162a ...).
 * The dark theme reads them through `var(--dark-*, fallback)`, so light mode is untouched.
 */
export function darkBaseVars(hex: string): Record<string, string> {
  const base = isHexColor(hex) ? hex : '#0f1122'
  const glass = lift(base, 9).join(', ')
  return {
    '--dark-base': base,
    '--dark-sidebar': toHex(lift(base, 5)),
    '--dark-glass': `rgba(${glass}, 0.62)`,
    '--dark-glass-strong': `rgba(${glass}, 0.82)`,
    '--dark-elevated': `rgba(${lift(base, 19).join(', ')}, 0.96)`,
    '--dark-ring-gap': toHex(lift(base, 11)),
    // the flat paper of the Moshi look's list and chat (with no base picked it is #16181f over the #0d0f14 window)
    '--dark-surface': toHex(lift(base, 9)),
    '--dark-bub-in': toHex(lift(base, 19))
  }
}

export const DARK_BASE_VAR_NAMES = Object.keys(darkBaseVars('#000000'))
