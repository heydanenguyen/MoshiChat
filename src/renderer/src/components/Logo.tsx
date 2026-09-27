import { logoHero, logoMarkInner, type LogoId, type LogoMood } from '@shared/logos'
import { useStore } from '../store'

/**
 * The logo character (see src/shared/logos.ts). Uses the logo picked in Settings unless one is
 * passed. Markup comes from static strings in logos.ts (no user input). Eyes blink and glance;
 * motion stops under prefers-reduced-motion.
 */
export function LogoMark({ size = 28, mood = 'happy', logo, className = '', title = 'Moshi' }: { size?: number; mood?: LogoMood; logo?: LogoId; className?: string; title?: string }): JSX.Element {
  const chosen = useStore((s) => s.settings.logo)
  const id = logo ?? chosen ?? 'buddies'
  return (
    <svg
      className={`unison-mark ${mood} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: logoMarkInner(id, mood) }}
    />
  )
}

/** Large version for the welcome screen: the two Buddies, or the chosen character. */
export function LogoHero({ size = 160, className = '' }: { size?: number; className?: string }): JSX.Element {
  const chosen = useStore((s) => s.settings.logo)
  const hero = logoHero(chosen ?? 'buddies')
  return (
    <svg
      className={`unison-duo ${className}`}
      width={size}
      height={size * hero.ratio}
      viewBox={hero.viewBox}
      role="img"
      aria-label="Moshi"
      dangerouslySetInnerHTML={{ __html: hero.inner }}
    />
  )
}
