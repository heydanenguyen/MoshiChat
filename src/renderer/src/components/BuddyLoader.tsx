import { LogoMark } from './Logo'

/**
 * Loading indicator: the logo character picked in Settings hops in place (squash on landing,
 * stretch on take-off) above a breathing shadow, with an optional label and bouncing dots.
 * `inline` is the small version that sits in a row of text in place of a spinner.
 */
export function BuddyLoader({ size = 44, label, inline = false, className = '' }: { size?: number; label?: string; inline?: boolean; className?: string }): JSX.Element {
  return (
    <span className={`buddy-loader ${inline ? 'inline' : ''} ${className}`} role="status" aria-label={label ?? 'Loading'} style={{ ['--loader-size' as string]: `${size}px` }}>
      <span className="buddy-loader-stage" aria-hidden>
        <span className="buddy-loader-shadow" />
        <span className="buddy-loader-hop">
          <LogoMark size={size} title="" />
        </span>
      </span>
      {label && !inline && (
        <span className="buddy-loader-label" aria-hidden>
          {label}
          <span className="buddy-loader-dots">
            <i />
            <i />
            <i />
          </span>
        </span>
      )}
    </span>
  )
}
