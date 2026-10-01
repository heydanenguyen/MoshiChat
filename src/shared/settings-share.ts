import { DEFAULT_SETTINGS, type Settings } from './types'

/**
 * Settings as they come back from the main process, keeping the previous object for every key whose value did not
 * change. Settings arrive whole and freshly copied over IPC, so without this every toggle (a pin, an archive, a sticker
 * sent) handed every settings selector a new reference and recomputed the whole list, the unread counts and the
 * people fold; now only what depends on the key that changed does.
 */
export function shareSettings(previous: Settings, incoming: Settings): Settings {
  const next = { ...DEFAULT_SETTINGS, ...incoming } as Settings
  const kept = next as unknown as Record<string, unknown>
  const old = previous as unknown as Record<string, unknown>
  let changed = Object.keys(old).length !== Object.keys(kept).length
  for (const key of Object.keys(kept)) {
    const a = old[key]
    const b = kept[key]
    if (a === b) continue
    if (a && b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b)) kept[key] = a
    else changed = true
  }
  return changed ? next : previous
}
