import { useEffect, useState } from 'react'
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

/**
 * Platform photo, retried once through the app's image proxy (some CDN links only load inside the
 * platform's signed-in session), then the generated character. Never shows a broken image.
 */
function AvatarImage({ name, url }: { name: string; url?: string }): JSX.Element {
  const [stage, setStage] = useState(0)
  useEffect(() => setStage(0), [url])
  const proxied = url && /^https:/.test(url) ? `unison-img://img/?u=${encodeURIComponent(url)}` : undefined
  const src = !url || stage >= 2 || (stage === 1 && !proxied) ? abstractAvatarUrl(name) : stage === 1 ? proxied! : url
  return <img className="avatar-img" src={src} alt="" draggable={false} loading="lazy" onError={() => setStage((s) => Math.min(s + 1, 2))} />
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
      <AvatarImage name={name} url={url} />
      {platform && (
        <span className="avatar-badge" style={{ width: badge, height: badge }}>
          <PlatformIcon platform={platform} size={badge} />
        </span>
      )}
    </span>
  )
}
