import { useLayoutEffect, useRef, useState } from 'react'
import { formatBadge } from '../quickFilter'
import { cssSpring } from '../motion/spring'

/** How far a digit travels as it rolls, and the two halves of the roll (ms). */
export const ROLL_PX = 12
export const ROLL_OUT_MS = 180
export const ROLL_IN_MS = 260
/** The pill emptying out when the count reaches 0. */
export const PILL_AWAY_MS = 180

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export type DigitChange = 'same' | 'roll' | 'enter'

/**
 * What each position of a number does when it goes from `before` to `after` (both as shown, "99+" included). Positions are counted
 * from the right, so the units digit stays the same cell when a digit is added in front of it. `exit` = how many positions on
 * the left were lost.
 */
export function digitChanges(before: string, after: string): { cells: DigitChange[]; exit: number } {
  const cells: DigitChange[] = []
  for (let i = 0; i < after.length; i++) {
    const was = before[before.length - 1 - i]
    const now = after[after.length - 1 - i]
    cells.unshift(was === undefined ? 'enter' : was === now ? 'same' : 'roll')
  }
  return { cells, exit: Math.max(0, before.length - after.length) }
}

/**
 * A number whose digits roll: the one that changes goes up 12 px with a little blur and fades while the new one comes in from
 * below; when the digit count changes the width follows on a spring. `formatBadge`'s "99+" rule applies (the string is what rolls).
 * Reduced motion swaps the digits at once.
 */
export function RollingNumber({ value }: { value: number }): JSX.Element {
  const text = formatBadge(Math.max(0, Math.floor(value)))
  const root = useRef<HTMLSpanElement>(null)
  const last = useRef({ text, width: 0, cell: 8 })

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const prev = last.current
    const cells = [...el.querySelectorAll<HTMLElement>(':scope > .roll-cell')]
    const record = (width = el.offsetWidth): void => {
      last.current = { text, width, cell: cells[0]?.offsetWidth || prev.cell }
    }
    if (prev.text === text) {
      if (!el.getAnimations().some((a) => a.id === 'roll-width')) record()
      return
    }
    if (reduced()) {
      el.getAnimations({ subtree: true }).forEach((a) => a.cancel())
      el.querySelectorAll('.roll-ghost').forEach((g) => g.remove())
      record()
      return
    }
    // Where the width is now (a width animation may be running), before it is cancelled.
    const running = el.getAnimations().some((a) => a.id === 'roll-width')
    const w0 = running ? el.offsetWidth : prev.width
    el.getAnimations({ subtree: true }).forEach((a) => a.cancel())
    el.querySelectorAll('.roll-ghost').forEach((g) => g.remove())
    const { cells: changes, exit } = digitChanges(prev.text, text)
    const up = { duration: ROLL_OUT_MS, easing: 'ease-in', fill: 'forwards' } as const
    const arrive = { duration: ROLL_IN_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' } as const
    changes.forEach((change, i) => {
      const cell = cells[i]
      const d = cell?.firstElementChild as HTMLElement | null
      if (!cell || !d || change === 'same') return
      if (change === 'roll') {
        // The digit it replaced rolls away over it.
        const ghost = document.createElement('span')
        ghost.className = 'roll-d roll-ghost'
        ghost.setAttribute('aria-hidden', 'true')
        ghost.textContent = prev.text[prev.text.length - changes.length + i]
        cell.appendChild(ghost)
        const gone = ghost.animate(
          { translate: ['0 0', `0 -${ROLL_PX}px`], opacity: [1, 0], filter: ['blur(0px)', 'blur(3px)'] },
          up
        )
        gone.onfinish = () => ghost.remove()
      }
      d.animate({ translate: [`0 ${ROLL_PX}px`, '0 0'], opacity: [0, 1], filter: ['blur(3px)', 'blur(0px)'] }, arrive)
    })
    // A digit that is no longer there leaves at the left while the width shrinks.
    for (let k = 0; k < exit; k++) {
      const ghost = document.createElement('span')
      ghost.className = 'roll-d roll-ghost roll-lost'
      ghost.setAttribute('aria-hidden', 'true')
      ghost.textContent = prev.text[exit - 1 - k]
      ghost.style.left = `${k * prev.cell}px`
      el.appendChild(ghost)
      const gone = ghost.animate({ translate: ['0 0', `0 -${ROLL_PX}px`], opacity: [1, 0], filter: ['blur(0px)', 'blur(3px)'] }, up)
      gone.onfinish = () => ghost.remove()
    }
    const w1 = el.offsetWidth
    if (w0 > 0 && Math.abs(w1 - w0) > 1) {
      const a = el.animate({ width: [`${w0}px`, `${w1}px`] }, { duration: 300, easing: cssSpring('digits') })
      a.id = 'roll-width'
    }
    record(w1)
  }, [text])

  return (
    <span ref={root} className="roll" aria-label={text} role="img">
      {[...text].map((ch, i) => (
        // (keyed from the right so the units digit is the same cell when a digit is added in front of it)
        <span key={text.length - i} className="roll-cell" aria-hidden>
          <span className="roll-d">{ch}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * The unread count pill of a conversation row: its digits roll, and when the count reaches 0 it shrinks to .4 and fades over 180 ms
 * (the row's markup keeps it until then). Takes the number, so the row's props stay primitive.
 */
export function UnreadPill({ count }: { count: number }): JSX.Element | null {
  const [leaving, setLeaving] = useState(false)
  const [seen, setSeen] = useState(count)
  const kept = useRef(Math.max(1, count))
  if (count > 0) kept.current = count
  if (count !== seen) {
    setSeen(count)
    if (count <= 0 && seen > 0 && !reduced()) setLeaving(true)
    else if (count > 0) setLeaving(false)
  }
  useLayoutEffect(() => {
    if (!leaving) return
    const id = setTimeout(() => setLeaving(false), PILL_AWAY_MS)
    return () => clearTimeout(id)
  }, [leaving])

  // 0 -> n while the row is drawn: the pill comes in the way it left.
  const el = useRef<HTMLSpanElement>(null)
  const before = useRef(count)
  useLayoutEffect(() => {
    const was = before.current
    before.current = count
    if (was <= 0 && count > 0 && el.current && !reduced()) {
      el.current.animate({ scale: [0.4, 1], opacity: [0, 1] }, { duration: 300, easing: cssSpring('digits') })
    }
  }, [count])

  if (count <= 0 && !leaving) return null
  return (
    <span ref={el} className={`unread-pill ${leaving ? 'leaving' : ''}`} aria-hidden={leaving || undefined}>
      <RollingNumber value={count > 0 ? count : kept.current} />
    </span>
  )
}
