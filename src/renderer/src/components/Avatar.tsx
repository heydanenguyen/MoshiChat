import type { Platform } from '@shared/types'
import { gradientFor, initials } from '../utils'
import { PlatformIcon } from './PlatformIcon'

interface Props {
  name: string
  url?: string
  size?: number
  platform?: Platform
  className?: string
}

export function Avatar({ name, url, size = 40, platform, className = '' }: Props): JSX.Element {
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size }}>
      {url ? (
        <img className="avatar-img" src={url} alt="" draggable={false} />
      ) : (
        <span className="avatar-initials" style={{ background: gradientFor(name), fontSize: Math.round(size * 0.38) }}>
          {initials(name)}
        </span>
      )}
      {platform && (
        <span className="avatar-badge" style={{ width: Math.max(14, size * 0.4), height: Math.max(14, size * 0.4) }}>
          <PlatformIcon platform={platform} size={Math.max(14, size * 0.4)} />
        </span>
      )}
    </span>
  )
}
