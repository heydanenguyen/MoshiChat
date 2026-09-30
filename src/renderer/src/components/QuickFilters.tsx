import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TKey } from '../i18n'
import { QUICK_FILTERS, formatBadge, type QuickFilter } from '../quickFilter'
import { useStore, useT } from '../store'

const LABEL: Record<QuickFilter, TKey> = {
  all: 'quickAll',
  unread: 'quickUnread',
  awaiting: 'quickAwaiting',
  groups: 'quickGroups',
  drafts: 'quickDrafts'
}

const HINT: Partial<Record<QuickFilter, TKey>> = {
  unread: 'quickUnreadHint',
  awaiting: 'quickAwaitingHint',
  groups: 'quickGroupsHint',
  drafts: 'quickDraftsHint'
}

/** Counts worth reading at a glance: things to act on. "All" and "Groups" would only be noise. */
const COUNTED: ReadonlySet<QuickFilter> = new Set(['unread', 'awaiting', 'drafts'])

/**
 * The chips above the chat list. A radio group: one is always on, arrow keys move between them, and the row
 * scrolls sideways (fading at the edge that has more) when the column is too narrow for all of them.
 */
export function QuickFilters({ counts }: { counts: Record<QuickFilter, number> }): JSX.Element {
  const t = useT()
  const current = useStore((s) => s.quickFilter)
  const setQuickFilter = useStore((s) => s.setQuickFilter)
  const rowRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  // Drafts only earns a chip while there is one (or while it is the chip you are on).
  const chips = QUICK_FILTERS.filter((f) => f !== 'drafts' || counts.drafts > 0 || current === 'drafts')

  const measure = (): void => {
    const row = rowRef.current
    if (!row) return
    const start = row.scrollLeft > 1
    const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }))
  }

  // Resizes and scrolling are watched below; this catches the row's content changing width (Drafts coming or
  // going, a count appearing or growing a digit).
  const widthKey = chips.map((f) => (COUNTED.has(f) ? `${f}${formatBadge(counts[f])}` : f)).join()
  useLayoutEffect(measure, [widthKey])

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [])

  // Keep the chosen chip in view, e.g. after picking it with the keyboard at the far end of the row.
  useEffect(() => {
    const chip = rowRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' })
  }, [current])

  // The arrows at a faded edge page the row for pointer users (keyboard users have the arrow keys).
  const page = (direction: 1 | -1): void => {
    const row = rowRef.current
    if (!row) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row.scrollBy({ left: direction * row.clientWidth * 0.6, behavior: smooth ? 'smooth' : 'auto' })
  }

  const pick = (filter: QuickFilter, focus = false): void => {
    setQuickFilter(filter)
    if (focus) requestAnimationFrame(() => rowRef.current?.querySelector<HTMLElement>(`[data-filter="${filter}"]`)?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const index = chips.indexOf(current)
    const next =
      e.key === 'ArrowRight' ? chips[(index + 1) % chips.length]
      : e.key === 'ArrowLeft' ? chips[(index - 1 + chips.length) % chips.length]
      : e.key === 'Home' ? chips[0]
      : e.key === 'End' ? chips[chips.length - 1]
      : undefined
    if (!next) return
    e.preventDefault()
    pick(next, true)
  }

  return (
    <div className="quick-filters-wrap">
      <div
        ref={rowRef}
        className={`quick-filters ${edges.start ? 'fade-start' : ''} ${edges.end ? 'fade-end' : ''}`}
        role="radiogroup"
        aria-label={t('quickFilters')}
        onKeyDown={onKeyDown}
        onScroll={measure}
        onWheel={(e) => {
          // A mouse wheel only scrolls up and down; turn that into sideways travel along the row.
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {chips.map((filter) => {
          const active = filter === current
          const count = counts[filter]
          const showCount = COUNTED.has(filter) && count > 0
          const label = t(LABEL[filter])
          const hint = HINT[filter]
          return (
            <button
              key={filter}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={showCount ? `${label}, ${count}` : label}
              tabIndex={active ? 0 : -1}
              data-filter={filter}
              title={hint ? t(hint) : undefined}
              className={`quick-chip ${active ? 'active' : ''} ${filter === 'drafts' ? 'enters' : ''}`}
              onClick={() => pick(filter)}
            >
              <span className="quick-chip-label">{label}</span>
              {showCount && (
                <span className={`quick-chip-count ${filter === 'unread' || filter === 'awaiting' ? 'strong' : ''}`} aria-hidden>
                  {formatBadge(count)}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {edges.start && (
        <button type="button" className="quick-scroll start" tabIndex={-1} aria-hidden onClick={() => page(-1)}>
          <ChevronLeft size={14} strokeWidth={2.6} />
        </button>
      )}
      {edges.end && (
        <button type="button" className="quick-scroll end" tabIndex={-1} aria-hidden onClick={() => page(1)}>
          <ChevronRight size={14} strokeWidth={2.6} />
        </button>
      )}
    </div>
  )
}

const EMPTY: Record<Exclude<QuickFilter, 'all'>, { title: TKey; hint: TKey; glyph: string }> = {
  unread: { title: 'quickEmptyUnread', hint: 'quickEmptyUnreadHint', glyph: '✨' },
  awaiting: { title: 'quickEmptyAwaiting', hint: 'quickEmptyAwaitingHint', glyph: '🌿' },
  groups: { title: 'quickEmptyGroups', hint: 'quickEmptyGroupsHint', glyph: '👥' },
  drafts: { title: 'quickEmptyDrafts', hint: 'quickEmptyDraftsHint', glyph: '✏️' }
}

/** What an empty chip says: good news for Unread and Needs reply, a pointer back to everything for all of them. */
export function QuickFilterEmpty({ filter }: { filter: Exclude<QuickFilter, 'all'> }): JSX.Element {
  const t = useT()
  const setQuickFilter = useStore((s) => s.setQuickFilter)
  const copy = EMPTY[filter]
  return <ListEmpty glyph={copy.glyph} title={t(copy.title)} hint={t(copy.hint)} action={{ label: t('quickShowAll'), run: () => setQuickFilter('all') }} />
}

/** A friendly empty list: a glyph, a line of good news or guidance, and optionally a way out. */
export function ListEmpty({ glyph, title, hint, action }: { glyph: string; title: string; hint: string; action?: { label: string; run(): void } }): JSX.Element {
  return (
    <div className="quick-empty" role="status">
      <span className="quick-empty-glyph" aria-hidden>
        {glyph}
      </span>
      <strong>{title}</strong>
      <p>{hint}</p>
      {action && (
        <button type="button" className="quick-empty-reset" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  )
}
