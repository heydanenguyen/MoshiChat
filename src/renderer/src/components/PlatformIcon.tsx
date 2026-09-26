import type { CSSProperties } from 'react'
import type { Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'

interface Props {
  platform: Platform
  size?: number
  className?: string
  style?: CSSProperties
}

/**
 * The one platform icon used everywhere (sidebar, avatar badges, chips, sheets): a pastel rounded
 * tile with the glyph in the brand colour, matching the tag pills. Small sizes get a bolder glyph.
 */
export function PlatformIcon({ platform, size = 16, className = '', style }: Props): JSX.Element {
  const meta = PLATFORMS[platform]
  const glyph = size <= 20 ? size * 0.64 : size * 0.56
  return (
    <span
      className={`platform-icon tile ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), ['--brand' as string]: meta.color, ...style } as CSSProperties}
      aria-label={meta.name}
      role="img"
    >
      <Glyph platform={platform} size={glyph} />
    </span>
  )
}

function Glyph({ platform, size }: { platform: Platform; size: number }): JSX.Element {
  switch (platform) {
    case 'messenger':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2C6.48 2 2 6.14 2 11.25c0 2.92 1.45 5.52 3.72 7.22V22l3.43-1.88c.91.25 1.87.38 2.85.38 5.52 0 10-4.14 10-9.25S17.52 2 12 2zm1.03 12.46-2.55-2.72-4.97 2.72 5.47-5.8 2.6 2.72 4.92-2.72-5.47 5.8z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
          <circle cx="12" cy="12" r="4.2" />
          <circle cx="17.6" cy="6.4" r="0.6" fill="currentColor" />
        </svg>
      )
    case 'telegram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M21.6 3.3 2.9 10.6c-1.1.4-1.1 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.2-15.2c.3-1.2-.5-1.8-1.5-1.5zM17.6 7.1l-7.8 7.1-.3 3.3-1.5-4.9 9.3-5.9c.4-.3.8-.1.3.4z" />
        </svg>
      )
    case 'zalo':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M4.5 5.5h13.2v2.6L9.4 17.1h8.6v2.4H4.2v-2.6l8.3-9H4.5z" />
        </svg>
      )
    case 'whatsapp':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2.2a9.8 9.8 0 0 0-8.4 14.8L2.2 22l5.2-1.4A9.8 9.8 0 1 0 12 2.2zm0 17.9a8.1 8.1 0 0 1-4.1-1.1l-.3-.2-3.1.8.8-3-.2-.3A8.1 8.1 0 1 1 12 20.1zm4.5-6c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s1 2.6 1.1 2.8c.1.2 1.9 3 4.7 4.2 1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.2-.2-.2-.5-.4z" />
        </svg>
      )
  }
}
