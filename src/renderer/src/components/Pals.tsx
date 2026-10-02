/**
 * Pals on screen: the inline characters of the empty screens (which can blink) and their stage. The drawings
 * themselves (bodies, faces, the cast, avatars) live in @shared/pals-art, shared with the sticker pack.
 */
import { useMemo } from 'react'
import { castById, palSvg, specOf, type PalSpec } from '@shared/pals-art'

export { palAvatarUrl } from '@shared/pals-art'

let nextId = 0

/** An inline pal (blinks when `live`, unless the window is idle or motion is reduced: see .pal-live in pals.css). */
export function Pal({ spec, size, live, ground, className = '', style }: { spec: PalSpec; size: number; live?: boolean; ground?: boolean; className?: string; style?: React.CSSProperties }): JSX.Element {
  const uid = useMemo(() => `i${++nextId}`, [])
  const html = useMemo(() => palSvg(spec, uid, { live, ground }), [spec, uid, live, ground])
  return <span className={`pal ${className}`} style={{ width: size, height: size, ...style }} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
}

/** The empty-screen cluster: members of the same cast the avatars use. */
const STAGE: Array<{ spec: PalSpec; size: number; at: [number, number]; delay: string }> = [
  { spec: specOf(castById('hoa'), 'smile'), size: 160, at: [-18, 14], delay: '0s' },
  { spec: specOf(castById('bong'), 'joy'), size: 124, at: [124, 34], delay: '1.3s' },
  { spec: specOf(castById('nang'), 'joy'), size: 92, at: [-136, -58], delay: '2.1s' },
  { spec: specOf(castById('co'), 'wow'), size: 80, at: [-148, 74], delay: '0.6s' },
  { spec: specOf(castById('giot'), 'sleepy', 'zz'), size: 70, at: [166, -60], delay: '3s' }
]

/** The cluster on the empty chat and welcome screens, with an ink speech bubble. */
export function PalStage({ greeting }: { greeting: string }): JSX.Element {
  return (
    <div className="pals-stage" aria-hidden>
      {STAGE.map((p, i) => (
        <Pal
          key={i}
          spec={p.spec}
          size={p.size}
          live
          ground
          className={`stage-pal sp${i}`}
          style={{ left: `calc(50% + ${p.at[0] - p.size / 2}px)`, top: `calc(50% + ${p.at[1] - p.size / 2}px)`, ['--blink-delay' as string]: p.delay, ['--pop-delay' as string]: `${i * 70}ms` } as React.CSSProperties}
        />
      ))}
      <span className="pals-say">{greeting}</span>
    </div>
  )
}
