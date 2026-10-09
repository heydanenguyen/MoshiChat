import { useRef, type ReactNode } from 'react'
import { usePresence, useSheetFocus } from '../usePresence'

/**
 * A layer (sheet, picker, photo viewer) with an exit animation. While `children` is set it shows; when it
 * goes away the last children stay mounted as `data-state="closing"` until the CSS exit keyframes are done.
 * A modal layer (the default: sheets, the photo viewer) also traps focus and makes the rest of the app inert
 * while it is up (see useSheetFocus); a popover (`modal={false}`: menus, composer pickers) only fades.
 */
export function Presence({ children, modal = true, focusKey }: { children?: ReactNode; modal?: boolean; focusKey?: string }): JSX.Element | null {
  const open = !!children
  const last = useRef<ReactNode>(null)
  if (children) last.current = children
  const { mounted, state } = usePresence(open)
  const ref = useRef<HTMLDivElement>(null)
  useSheetFocus(open && modal, ref, focusKey)
  if (!mounted) return null
  // Out of reach while it fades: no clicks, no focus. (React 18 only passes `inert` through as a string.)
  const inert = state === 'closing' ? { inert: '' } : undefined
  return (
    <div ref={ref} className={modal ? 'presence' : 'presence pop'} data-state={state} {...inert}>
      {children || last.current}
    </div>
  )
}
