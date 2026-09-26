import type { Platform } from '@shared/types'
import { abstractAvatarUrl } from './AbstractAvatar'
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

/** Photo when the platform has one, otherwise a generated abstract character. */
export function Avatar({ name, url, size = 40, platform, ring, className = '', onClick }: Props): JSX.Element {
  const badge = Math.max(14, Math.round(size * 0.4))
  return (
    <span
      className={`avatar ${className} ${onClick ? 'clickable' : ''}`}
      style={{ width: size, height: size, boxShadow: ring ? `0 0 0 2px var(--ring-gap), 0 0 0 4px ${ring}` : undefined }}
      onClick={onClick}
    >
      <img className="avatar-img" src={url || abstractAvatarUrl(name)} alt="" draggable={false} loading="lazy" />
      {platform && (
        <span className="avatar-badge" style={{ width: badge, height: badge }}>
          <PlatformIcon platform={platform} size={badge} />
        </span>
      )}
    </span>
  )
}
