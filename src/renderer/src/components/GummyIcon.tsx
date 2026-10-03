import type { CSSProperties } from 'react'
import { iconStyleOf, type Platform } from '@shared/types'
import { PIXEL_GRID, PIXEL_INK, monoTile, pixelGlyphSize, pixelPath, pixelTile } from '@shared/pixel-art'
import { useStore } from '../store'

/**
 * The "Gummy" icon set (Settings > Appearance > Icon style): candy tiles with a jelly shine, the glyph in white and
 * its few details in a deep shade of the tile. Drawn on a 24 grid as filled shapes, so they stay solid down to 13 px.
 */
export type GummyName = Platform | 'general' | 'appearance' | 'accounts' | 'chat' | 'notifications' | 'tags' | 'ai' | 'data' | 'inbox' | 'todos' | 'insights'

interface Glyph {
  color: string
  /** White shapes. */
  shapes: JSX.Element
  /** Details in the deep shade (lines and holes). */
  details?: JSX.Element
}

const line = { fill: 'none', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const GLYPHS: Record<GummyName, Glyph> = {
  messenger: {
    color: '#a78bff',
    shapes: <path d="M12 3C7 3 3 6.7 3 11.3c0 2.6 1.3 4.9 3.3 6.4V21l3-1.7c.9.3 1.8.4 2.7.4 5 0 9-3.7 9-8.4S17 3 12 3z" />,
    details: <path d="M7.3 13.8l3.3-3.6 2.2 2.1 3.9-2.1-3.3 3.6-2.2-2.1z" />
  },
  instagram: {
    color: '#ff8fc4',
    shapes: <rect x="3" y="3" width="18" height="18" rx="5.6" />,
    details: (
      <>
        <circle cx="12" cy="12" r="4.1" {...line} strokeWidth={2.3} />
        <circle cx="17.2" cy="6.8" r="1.25" stroke="none" />
      </>
    )
  },
  telegram: {
    color: '#7cc3ff',
    shapes: <path d="M2.8 11.4 20.4 4.3c.8-.3 1.5.3 1.3 1.2l-2.9 13.4c-.2.9-.9 1.1-1.6.7l-4.6-3.4-2.3 2.2c-.3.3-.8.2-.9-.3l-.4-4.1-5.9-1.8c-.9-.3-.9-1-.3-1.3z" />,
    details: <path d="M9.4 14.1 16.6 8l-6.4 7.3z" />
  },
  zalo: {
    color: '#5f9dff',
    shapes: <path d="M6 3.5h12A3.5 3.5 0 0 1 21.5 7v8a3.5 3.5 0 0 1-3.5 3.5h-5.2l-4.6 3v-3H6A3.5 3.5 0 0 1 2.5 15V7A3.5 3.5 0 0 1 6 3.5z" />,
    details: <path d="M7.6 7.3h8.3v1.6l-5.3 5.4h5.4v1.8H7.4v-1.6l5.3-5.4H7.6z" />
  },
  whatsapp: {
    color: '#6fd17f',
    shapes: <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3z" />,
    details: <path d="M9.1 7.4c.3 0 .5.1.6.4l.9 2c.1.2 0 .5-.1.7l-.7.8c.6 1.3 1.7 2.4 3 3l.8-.7c.2-.2.5-.2.7-.1l2 .9c.3.1.4.4.4.6-.1 1.1-1 1.9-2.1 1.9-3.9 0-7.1-3.2-7.1-7.1 0-1.1.8-2 1.9-2.1z" />
  },
  general: {
    color: '#b8b2d6',
    shapes: (
      <>
        <rect x="2.5" y="6.6" width="19" height="2.8" rx="1.4" />
        <rect x="2.5" y="14.6" width="19" height="2.8" rx="1.4" />
        <circle cx="8.5" cy="8" r="3.2" />
        <circle cx="15.5" cy="16" r="3.2" />
      </>
    ),
    details: (
      <>
        <circle cx="8.5" cy="8" r="1.2" />
        <circle cx="15.5" cy="16" r="1.2" />
      </>
    )
  },
  appearance: {
    color: '#ff8fc4',
    shapes: <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-1.9-.5-1.2.3-2.5 1.6-2.5H17a4 4 0 0 0 4-4C21 7.4 17 3 12 3z" />,
    details: (
      <>
        <circle cx="7.6" cy="11.4" r="1.4" />
        <circle cx="10.4" cy="7.2" r="1.4" />
        <circle cx="15.2" cy="7.6" r="1.4" />
      </>
    )
  },
  accounts: {
    color: '#7cc3ff',
    shapes: (
      <>
        <circle cx="16.4" cy="8.6" r="2.9" />
        <path d="M14.6 13.5c3.6-.3 6.6 1.7 6.6 5.5h-5.4z" />
        <circle cx="9" cy="8.2" r="3.6" />
        <path d="M2.6 19.5c0-3.6 2.8-6 6.4-6s6.4 2.4 6.4 6z" />
      </>
    )
  },
  chat: {
    color: '#6fd17f',
    shapes: <path d="M6 3.5h12A3.5 3.5 0 0 1 21.5 7v7.5A3.5 3.5 0 0 1 18 18H10l-5 3.5V18a3 3 0 0 1-2.5-3V7A3.5 3.5 0 0 1 6 3.5z" />,
    details: (
      <>
        <circle cx="8.2" cy="10.8" r="1.3" />
        <circle cx="12" cy="10.8" r="1.3" />
        <circle cx="15.8" cy="10.8" r="1.3" />
      </>
    )
  },
  notifications: {
    color: '#ffb81f',
    shapes: (
      <>
        <path d="M12 2.8a6.2 6.2 0 0 0-6.2 6.2v3.6L4 15.9h16l-1.8-3.3V9A6.2 6.2 0 0 0 12 2.8z" />
        <path d="M9.6 18a2.4 2.4 0 0 0 4.8 0z" />
      </>
    )
  },
  tags: {
    color: '#ffb0da',
    shapes: <path d="M3 4.6v6.6l9.7 9.7a1.7 1.7 0 0 0 2.4 0l5.3-5.3a1.7 1.7 0 0 0 0-2.4L10.7 3.5H4.1A1.1 1.1 0 0 0 3 4.6z" />,
    details: <circle cx="7.6" cy="7.6" r="1.6" />
  },
  ai: {
    color: '#c4adff',
    shapes: (
      <>
        <path d="M10.5 2.5c.7 4.8 3.1 7.2 7.9 7.9-4.8.7-7.2 3.1-7.9 7.9-.7-4.8-3.1-7.2-7.9-7.9 4.8-.7 7.2-3.1 7.9-7.9z" />
        <path d="M18.2 14.6c.3 2 1.3 3 3.3 3.3-2 .3-3 1.3-3.3 3.3-.3-2-1.3-3-3.3-3.3 2-.3 3-1.3 3.3-3.3z" />
      </>
    )
  },
  data: {
    color: '#96ccff',
    shapes: (
      <>
        <path d="M5 6.2v11.6c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V6.2z" />
        <ellipse cx="12" cy="6.2" rx="7" ry="2.9" />
      </>
    ),
    details: <path d="M5 12c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9" {...line} strokeWidth={1.8} />
  },
  inbox: {
    color: '#c3adff',
    shapes: <path d="M5.2 4h13.6l2.7 8.2V18a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-5.8z" />,
    details: <path d="M2.6 12.4h5.2l1.4 2.4h5.6l1.4-2.4h5.2" {...line} strokeWidth={2} />
  },
  todos: {
    color: '#7fd987',
    shapes: <rect x="3" y="3" width="18" height="18" rx="5" />,
    details: <path d="M7 9l1.6 1.6L11.4 7.6M7 15.4l1.6 1.6 2.8-3M13.6 9.4h3.4M13.6 15.8h3.4" {...line} strokeWidth={2} />
  },
  insights: {
    color: '#ffb0da',
    shapes: (
      <>
        <rect x="3.5" y="12" width="4.4" height="8.5" rx="1.6" />
        <rect x="9.8" y="4" width="4.4" height="16.5" rx="1.6" />
        <rect x="16.1" y="8.5" width="4.4" height="12" rx="1.6" />
      </>
    )
  }
}

/** A deeper shade of the tile for the glyph's details. */
const deep = (hex: string): string =>
  '#' +
  [1, 3, 5]
    .map((i) =>
      Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.55)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')

/** Which tile icon set is in use (Gummy or Pixel), or undefined when icons are drawn the classic way. */
export function useTileIcons(): TileKind | undefined {
  return useStore((s) => {
    const picked = iconStyleOf(s.settings)
    return picked === 'gummy' || picked === 'pixel' ? picked : undefined
  })
}
export type TileKind = 'gummy' | 'pixel'

/**
 * A tile icon: a Gummy candy tile, or with kind="pixel" the Pixel style's ink pixel glyph on a pastel tile.
 */
export function GummyIcon({
  name,
  size,
  radius,
  className = '',
  style,
  label,
  kind = 'gummy'
}: {
  name: GummyName
  kind?: TileKind
  size: number
  radius?: number
  className?: string
  style?: CSSProperties
  label?: string
}): JSX.Element {
  const mono = useStore((s) => s.settings.style === 'mono')
  if (kind === 'pixel') {
    // Mono snaps the glyph to whole grid steps so no pixel row is lost; other styles keep the plain proportion
    const glyph = mono ? pixelGlyphSize(size * 0.6) : Math.round(size * 0.6)
    return (
      <span
        className={`gummy-tile pixel-tile ${className}`}
        data-icon={name}
        style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.3), background: `var(--pixel-tile, ${pixelTile(name)})`, ['--px-mono' as string]: monoTile(name), ...style }}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        <svg width={glyph} height={glyph} viewBox={`0 0 ${PIXEL_GRID} ${PIXEL_GRID}`} shapeRendering="crispEdges" aria-hidden>
          {/* the Mono style redraws the tile and the ink in its greys */}
          <path style={{ fill: `var(--pixel-ink, ${PIXEL_INK})` }} d={pixelPath(name)} />
        </svg>
      </span>
    )
  }
  const g = GLYPHS[name]
  const glyph = Math.round(size * (size <= 20 ? 0.72 : 0.64))
  return (
    <span
      className={`gummy-tile ${className}`}
      data-icon={name}
      style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.3), ['--gummy' as string]: g.color, ...style } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" aria-hidden>
        <g fill="#fff">{g.shapes}</g>
        {g.details && (
          <g fill={deep(g.color)} stroke={deep(g.color)} strokeWidth={0}>
            {g.details}
          </g>
        )}
      </svg>
    </span>
  )
}
