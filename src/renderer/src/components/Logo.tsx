/**
 * Unison's mascots: two chat-bubble buddies. Flat colours, black features, no outlines —
 * the same geometry as build/icon.svg / build/icon-small.svg (the app icon).
 * Eyes blink and glance now and then; everything holds still under prefers-reduced-motion.
 */

const ORANGE = '#FF5B1F'
const PINK = '#FF7AC0'
const INK = '#141414'

type Mood = 'happy' | 'calm'

/** The orange speech-bubble buddy on its own (sidebar, empty states). */
export function UnisonMark({ size = 28, mood = 'happy', className = '', title = 'Unison' }: { size?: number; mood?: Mood; className?: string; title?: string }): JSX.Element {
  return (
    <svg className={`unison-mark ${mood} ${className}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <g className="buddy-body">
        <g fill={ORANGE} stroke={ORANGE} strokeWidth={3} strokeLinejoin="round">
          <rect x="7" y="17" width="50" height="36" rx="16" stroke="none" />
          <circle cx="16" cy="19" r="9" stroke="none" />
          <circle cx="29" cy="14" r="10" stroke="none" />
          <circle cx="42" cy="15" r="9" stroke="none" />
          <circle cx="51" cy="21" r="8" stroke="none" />
          <path d="M14 47 L9 59 L26 51 Z" />
        </g>
        {mood === 'happy' ? (
          <>
            <g className="buddy-eyes">
              <circle cx="24" cy="31" r="7.5" fill="#fff" />
              <circle cx="41" cy="31" r="7.5" fill="#fff" />
              <g className="buddy-pupils">
                <circle cx="26.5" cy="29.5" r="4.2" fill={INK} />
                <circle cx="43.5" cy="29.5" r="4.2" fill={INK} />
              </g>
            </g>
            <path d="M26 40.5 H39 A6.5 6 0 0 1 26 40.5 Z" fill={INK} />
          </>
        ) : (
          <g fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round">
            <path d="M19.5 31 q3.5 3.8 7 0" />
            <path d="M36.5 31 q3.5 3.8 7 0" />
            <path d="M27 39 q4.5 3.6 9 0" />
          </g>
        )}
      </g>
    </svg>
  )
}

/** Both buddies, talking in unison (welcome screen). */
export function UnisonDuo({ size = 160, className = '' }: { size?: number; className?: string }): JSX.Element {
  return (
    <svg className={`unison-duo ${className}`} width={size} height={(size * 848) / 792} viewBox="130 90 792 848" role="img" aria-label="Unison">
      <g className="buddy-pink">
        <g fill={PINK} stroke={PINK} strokeWidth={34} strokeLinejoin="round">
          <circle cx="652" cy="318" r="148" stroke="none" />
          <circle cx="564" cy="230" r="120" stroke="none" />
          <circle cx="740" cy="230" r="120" stroke="none" />
          <circle cx="564" cy="406" r="120" stroke="none" />
          <circle cx="740" cy="406" r="120" stroke="none" />
          <path d="M812 468 L884 566 L748 516 Z" />
        </g>
        <g fill="none" stroke={INK} strokeWidth={19} strokeLinecap="round">
          <path d="M598 270 q20 23 40 0" />
          <path d="M672 270 q20 23 40 0" />
          <path d="M606 318 q50 42 100 0" />
        </g>
      </g>
      <g className="buddy-body">
        <g fill={ORANGE} stroke={ORANGE} strokeWidth={36} strokeLinejoin="round">
          <rect x="150" y="440" width="570" height="400" rx="190" stroke="none" />
          <circle cx="262" cy="478" r="104" stroke="none" />
          <circle cx="404" cy="428" r="108" stroke="none" />
          <circle cx="552" cy="438" r="104" stroke="none" />
          <circle cx="662" cy="508" r="98" stroke="none" />
          <path d="M240 780 L182 900 L368 820 Z" />
        </g>
        <g className="buddy-eyes">
          <circle cx="336" cy="610" r="76" fill="#fff" />
          <circle cx="540" cy="610" r="76" fill="#fff" />
          <g className="buddy-pupils">
            <circle cx="362" cy="592" r="41" fill={INK} />
            <circle cx="566" cy="592" r="41" fill={INK} />
          </g>
        </g>
        <path d="M360 704 H520 A80 74 0 0 1 360 704 Z" fill={INK} />
        <rect x="408" y="702" width="30" height="34" rx="8" fill="#fff" />
        <rect x="444" y="702" width="30" height="34" rx="8" fill="#fff" />
      </g>
    </svg>
  )
}
