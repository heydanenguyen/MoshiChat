import { PLATFORMS, PLATFORM_ORDER, type Platform } from '@shared/types'

/** One chip of the platform row that stands in for the (hidden) sidebar on a phone-sized window. */
export interface NarrowChip {
  id: 'all' | Platform
  label: string
  count: number
}

/**
 * "All" with every unread message, then one chip per app that has an account, in the sidebar's order. An app with no
 * account gets no chip (the sidebar lists every app only while no account exists at all, and then there is nothing to filter).
 */
export function narrowChips(accounts: ReadonlyArray<{ platform: Platform }>, unreadByPlatform: Partial<Record<Platform, number>>, allLabel = 'All'): NarrowChip[] {
  const total = PLATFORM_ORDER.reduce((sum, platform) => sum + (unreadByPlatform[platform] ?? 0), 0)
  const chips: NarrowChip[] = [{ id: 'all', label: allLabel, count: total }]
  for (const platform of PLATFORM_ORDER) {
    if (!accounts.some((a) => a.platform === platform)) continue
    chips.push({ id: platform, label: PLATFORMS[platform].name, count: unreadByPlatform[platform] ?? 0 })
  }
  return chips
}

/** Which button of a horizontal toolbar takes focus after `key` (arrows wrap, Home and End jump); undefined = not a toolbar key. */
export function toolbarStep(key: string, index: number, count: number): number | undefined {
  if (count <= 0) return undefined
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight') return (index + 1) % count
  if (key === 'ArrowLeft') return (index - 1 + count) % count
  return undefined
}

/** The number beside the Back button: every unread message except those of the chat that is open (never below zero). */
export function remainingUnread(total: number, own: number): number {
  return Math.max(0, total - Math.max(0, own))
}
