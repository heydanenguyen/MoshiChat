import type { Platform } from '@shared/types'
import { gradientFor, initials } from '../utils'
import { PlatformIcon } from './PlatformIcon'

interface Props {
  name: string
  url?: string
  size?: number
  /** Platform badge in the corner. Omit to hide (single-platform views). */
  platform?: Platform
  /** Colored ring, used for contact tags. */
  ring?: string
  className?: string
  onClick?: () => void
}

export function Avatar({ name, url, size = 40, platform, ring, className = '', onClick }: Props): JSX.Element {
  const badge = Math.max(14, Math.round(size * 0.4))
  return (
    <span
      className={`avatar ${className} ${onClick ? 'clickable' : ''}`}
      style={{ width: size, height: size, boxShadow: ring ? `0 0 0 2px var(--bg-list), 0 0 0 4px ${ring}` : undefined }}
      onClick={onClick}
    >
      {url ? (
        <img className="avatar-img" src={url} alt="" draggable={false} loading="lazy" />
      ) : (
        <span className="avatar-initials" style={{ background: gradientFor(name), fontSize: Math.round(size * 0.38) }}>
          {initials(name)}
        </span>
      )}
      {platform && (
        <span className="avatar-badge" style={{ width: badge, height: badge }}>
          <PlatformIcon platform={platform} size={badge} />
        </span>
      )}
    </span>
  )
}
