import { useRef, type ReactNode } from 'react'
import { usePresence } from '../usePresence'

/**
 * A strip that grows open and folds shut instead of popping in and out (the reply banner above the composer, which
 * used to shove the whole chat up and down). Height animates through the grid trick (0fr to 1fr), so it needs no
 * measuring. `children` falsy = closed; the last content stays while it folds away.
 */
export function Collapse({ children }: { children?: ReactNode }): JSX.Element | null {
  const last = useRef<ReactNode>(null)
  if (children) last.current = children
  const { mounted, state } = usePresence(!!children, 220)
  if (!mounted) return null
  return (
    <div className="collapse" data-state={state}>
      <div className="collapse-inner">{children || last.current}</div>
    </div>
  )
}
