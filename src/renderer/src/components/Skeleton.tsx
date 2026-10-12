import type { CSSProperties } from 'react'

/** The most blocks one surface draws. */
export const SKELETON_CAP = 12

/** A skeleton shows only if the content takes longer than this, so a quick load never flashes it (app.css `skeleton-appear` uses the same delay). */
export const SKELETON_DELAY_MS = 300

/**
 * A grey block with a diagonal highlight sweeping across it (app.css, "Motion pack 1 (ideas 6, 8, 15, 20)"). It stands where the
 * shape of the content is known and goes the moment the content arrives. Decorative: the surface that uses it says what is loading.
 */
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }): JSX.Element {
  return <span className={`skeleton ${className}`} style={style} aria-hidden />
}

/** The widths (percent of the thread) of the bubbles that stand in for a chat opening, alternating incoming and outgoing. */
const BUBBLES: Array<{ width: number; height: number }> = [
  { width: 62, height: 40 },
  { width: 40, height: 40 },
  { width: 75, height: 64 },
  { width: 55, height: 40 },
  { width: 48, height: 40 }
]

/** A chat thread's first load: five bubbles where the messages will be. */
export function SkeletonThread({ label }: { label: string }): JSX.Element {
  return (
    <div className="skeleton-thread" role="status" aria-label={label}>
      {BUBBLES.slice(0, SKELETON_CAP).map((b, i) => (
        <Skeleton key={i} className={`skeleton-bubble ${i % 2 ? 'out' : 'in'}`} style={{ ['--w' as string]: `${b.width}%`, ['--h' as string]: `${b.height}px`, ['--sk-i' as string]: i }} />
      ))}
    </div>
  )
}

/** Each row is three blocks (avatar and two lines); the cap counts blocks. */
export const BLOCKS_PER_ROW = 3
export const rowsWithin = (blocks: number): number => Math.floor(blocks / BLOCKS_PER_ROW)

/** Conversation-list rows (avatar and two lines) while an account's first list is on its way. */
export function SkeletonRows({ count = 4, label }: { count?: number; label: string }): JSX.Element {
  return (
    <div className="skeleton-rows" role="status" aria-label={label}>
      {Array.from({ length: Math.min(count, rowsWithin(SKELETON_CAP)) }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ ['--sk-i' as string]: i }}>
          <Skeleton className="skeleton-avatar" />
          <div className="skeleton-lines">
            <Skeleton className="skeleton-line" style={{ ['--w' as string]: `${46 + ((i * 17) % 30)}%` }} />
            <Skeleton className="skeleton-line short" style={{ ['--w' as string]: `${64 + ((i * 11) % 28)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
