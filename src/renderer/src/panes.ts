/**
 * Split chat: one or two panes side by side, each showing a conversation. Pure functions so the
 * rules are testable; the store keeps the current layout and mirrors the active pane's conversation
 * into `selectedId` for everything that only cares about "the open chat".
 */

export type PaneIndex = 0 | 1

export interface PaneLayout {
  /** One entry = single view, two = split. `undefined` is an empty pane waiting for a chat. */
  panes: Array<string | undefined>
  active: PaneIndex
}

export const single = (id?: string): PaneLayout => ({ panes: [id], active: 0 })

export const isSplit = (layout: PaneLayout): boolean => layout.panes.length > 1

export const activeId = (layout: PaneLayout): string | undefined => layout.panes[layout.active]

export const openIds = (layout: PaneLayout): string[] => layout.panes.filter((id): id is string => !!id)

export function paneOf(layout: PaneLayout, id: string): PaneIndex | undefined {
  const index = layout.panes.indexOf(id)
  return index < 0 ? undefined : (index as PaneIndex)
}

const clampPane = (layout: PaneLayout, pane: number): PaneIndex => (pane === 1 && layout.panes.length > 1 ? 1 : 0)

/** Show a chat in a pane. A chat already open elsewhere is not duplicated: that pane becomes active instead. */
export function openIn(layout: PaneLayout, id: string, pane: PaneIndex): PaneLayout {
  const existing = paneOf(layout, id)
  if (existing !== undefined) return { ...layout, active: existing }
  const target = clampPane(layout, pane)
  const panes = layout.panes.slice()
  panes[target] = id
  return { panes, active: target }
}

/** Open a chat next to the current one (creating the split), or in the other pane when already split. */
export function openBeside(layout: PaneLayout, id: string): PaneLayout {
  const existing = paneOf(layout, id)
  if (existing !== undefined) return { ...layout, active: existing }
  if (!isSplit(layout)) return { panes: [layout.panes[0], id], active: 1 }
  const other = (layout.active === 0 ? 1 : 0) as PaneIndex
  const panes = layout.panes.slice()
  panes[other] = id
  return { panes, active: other }
}

export function activate(layout: PaneLayout, pane: PaneIndex): PaneLayout {
  const target = clampPane(layout, pane)
  return target === layout.active ? layout : { ...layout, active: target }
}

/** Close a pane; the remaining chat carries on as the single view. */
export function closePane(layout: PaneLayout, pane: PaneIndex): PaneLayout {
  if (!isSplit(layout)) return layout
  const remaining = layout.panes[pane === 0 ? 1 : 0]
  return single(remaining)
}

/**
 * Split or unsplit. Splitting opens `suggestion` (usually the previously read chat) on the right, or an
 * empty pane; unsplitting keeps the active pane's chat.
 */
export function toggleSplit(layout: PaneLayout, suggestion?: string): PaneLayout {
  if (isSplit(layout)) return single(activeId(layout))
  const current = layout.panes[0]
  const beside = suggestion && suggestion !== current ? suggestion : undefined
  return { panes: [current, beside], active: 1 }
}

/** Drop chats that no longer exist (account removed, chat hidden). A split with nothing left collapses. */
export function prune(layout: PaneLayout, exists: (id: string) => boolean): PaneLayout {
  const panes = layout.panes.map((id) => (id && exists(id) ? id : undefined))
  if (panes.every((id, i) => id === layout.panes[i])) return layout
  if (panes.length > 1 && !panes[0] && !panes[1]) return single()
  if (panes.length > 1 && (!panes[0] || !panes[1])) return single(panes[0] ?? panes[1])
  return { panes, active: clampPane({ panes, active: 0 }, layout.active) }
}

/** The most recently read chat that is not on screen: what a fresh split shows first. */
export function suggestBeside(layout: PaneLayout, recent: string[]): string | undefined {
  return recent.find((id) => paneOf(layout, id) === undefined)
}

/** Remember `id` as the latest read chat (newest first, no repeats, short). */
export function pushRecent(recent: string[], id: string, limit = 12): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, limit)
}

/** Restore a saved layout, keeping only chats that still exist. */
export function restoreLayout(saved: unknown, exists: (id: string) => boolean): PaneLayout {
  const raw = saved as Partial<PaneLayout> | undefined
  if (!raw || !Array.isArray(raw.panes) || raw.panes.length === 0 || raw.panes.length > 2) return single()
  const panes = raw.panes.slice(0, 2).map((id) => (typeof id === 'string' ? id : undefined))
  const active = raw.active === 1 ? 1 : 0
  return prune({ panes, active }, exists)
}
