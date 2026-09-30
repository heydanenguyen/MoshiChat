import type { SavedMessage, SentSticker, Settings } from './types'
import type { Todo } from './todos'

/**
 * Sync between computers through a shared folder (OneDrive, Google Drive, Dropbox...). Settings are cut
 * into small entries (one tag list per chat, one to-do, one nickname...), each stamped with when and on
 * which computer it last changed. Every computer writes its own file of entries and merges the others':
 * per entry, the newer change wins, so edits to different chats on two computers both survive.
 * Deletions travel as tombstones. Sign-ins and anything tied to one computer are never synced.
 */

/** Kept whole: one entry per key. */
const VALUE_KEYS = [
  'theme',
  'language',
  'mesh',
  'style',
  'darkBase',
  'accent',
  'font',
  'logo',
  'messageShadows',
  'customAccents',
  'greetings',
  'sendOnEnter',
  'sendReadReceipts',
  'tagDefs',
  'muted',
  'quickReplies',
  'bubbleActions',
  'actionLabels',
  'suggestLanguage',
  'aiSuggest',
  'effects',
  'acceptedUnofficial',
  'gif'
] as const satisfies ReadonlyArray<keyof Settings>

/** Maps keyed by conversation id: one entry per chat. */
const RECORD_KEYS = ['tags', 'pins', 'contactOverrides', 'hidden', 'markedUnread', 'archived', 'mentionsOnly', 'acceptedRequests', 'people', 'mergeDismissed'] as const satisfies ReadonlyArray<keyof Settings>

type ListKey = 'todos' | 'savedMessages' | 'sentStickers'

/** Lists: one entry per item, and how to put the list back in order. */
const LIST_KEYS: { [K in ListKey]: { id: (item: NonNullable<Settings[K]>[number]) => string; order: (list: NonNullable<Settings[K]>) => NonNullable<Settings[K]> } } = {
  todos: { id: (t: Todo) => t.id, order: (list) => [...list].sort((a, b) => a.createdAt - b.createdAt) },
  savedMessages: { id: (m: SavedMessage) => `${m.conversationId}|${m.messageId}`, order: (list) => [...list].sort((a, b) => b.savedAt - a.savedAt) },
  sentStickers: { id: (s: SentSticker) => `${s.conversationId}|${s.messageId}`, order: (list) => [...list].sort((a, b) => a.sentAt - b.sentAt).slice(-500) }
}

/** Everything a computer keeps to itself: size, zoom, sidebar, download folder, AI models, notification sounds, scheduled sends (sent once, by the computer that has them). */
export const SYNCED_KEYS: ReadonlyArray<keyof Settings> = [...VALUE_KEYS, ...RECORD_KEYS, ...(Object.keys(LIST_KEYS) as ListKey[])]

const SEP = '\u001f'

/** When and where an entry last changed. `del`: it was removed. */
export interface Stamp {
  t: number
  d: string
  del?: true
}

export interface SyncEntry extends Stamp {
  v?: unknown
}

/** What one computer writes into the shared folder. */
export interface DeviceFile {
  version: 1
  deviceId: string
  deviceName: string
  updatedAt: number
  entries: Record<string, SyncEntry>
}

/** Settings as entries: path -> value. Paths are `key` or `key<US>id`. */
export function flatten(settings: Partial<Settings>): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const key of VALUE_KEYS) if (settings[key] !== undefined) out.set(key, settings[key])
  for (const key of RECORD_KEYS) {
    for (const [id, value] of Object.entries((settings[key] ?? {}) as Record<string, unknown>)) if (value !== undefined) out.set(key + SEP + id, value)
  }
  for (const key of Object.keys(LIST_KEYS) as ListKey[]) {
    const id = LIST_KEYS[key].id as (item: unknown) => string
    for (const item of (settings[key] ?? []) as unknown[]) out.set(key + SEP + id(item), item)
  }
  return out
}

const keyOf = (path: string): keyof Settings => path.split(SEP, 1)[0] as keyof Settings

/** Rebuild the settings keys touched by `paths` from the full set of entries. */
export function unflatten(flat: Map<string, unknown>, paths: Iterable<string>): Partial<Settings> {
  const keys = new Set([...paths].map(keyOf))
  const patch: Record<string, unknown> = {}
  for (const key of keys) {
    if ((VALUE_KEYS as readonly string[]).includes(key)) {
      patch[key] = flat.get(key)
      continue
    }
    const items: Array<[string, unknown]> = []
    for (const [path, value] of flat) if (keyOf(path) === key && path.includes(SEP)) items.push([path.slice(key.length + 1), value])
    if ((RECORD_KEYS as readonly string[]).includes(key)) patch[key] = Object.fromEntries(items)
    else if (key in LIST_KEYS) patch[key] = (LIST_KEYS[key as ListKey].order as (list: unknown[]) => unknown[])(items.map(([, v]) => v))
  }
  return patch as Partial<Settings>
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Newer change first; on the same millisecond the computer id decides, so every computer agrees. */
export function newer(a: Stamp | undefined, b: Stamp | undefined): boolean {
  if (!a) return false
  if (!b) return true
  return a.t !== b.t ? a.t > b.t : a.d > b.d
}

/**
 * Stamp what changed locally between two versions of the settings. Removed entries become tombstones,
 * unless `quiet` (tidying away chats of accounts this computer does not have: other computers may).
 */
export function stampChanges(before: Partial<Settings>, after: Partial<Settings>, stamps: Record<string, Stamp>, now: number, deviceId: string, quiet = false): boolean {
  const a = flatten(before)
  const b = flatten(after)
  let changed = false
  for (const [path, value] of b) {
    if (a.has(path) && same(a.get(path), value) && stamps[path] && !stamps[path].del) continue
    stamps[path] = { t: now, d: deviceId }
    changed = true
  }
  for (const path of a.keys()) {
    if (b.has(path) || quiet) continue
    stamps[path] = { t: now, d: deviceId, del: true }
    changed = true
  }
  return changed
}

/** Stamp everything already here as very old, so the first sync takes what other computers have and adds what only this one has. */
export function seedStamps(settings: Partial<Settings>, stamps: Record<string, Stamp>, deviceId: string): void {
  for (const path of flatten(settings).keys()) stamps[path] ??= { t: 1, d: deviceId }
}

/** This computer's file: every entry it holds, plus its tombstones. */
export function deviceEntries(settings: Partial<Settings>, stamps: Record<string, Stamp>): Record<string, SyncEntry> {
  const flat = flatten(settings)
  const entries: Record<string, SyncEntry> = {}
  for (const [path, stamp] of Object.entries(stamps)) {
    if (stamp.del) entries[path] = { ...stamp }
    else if (flat.has(path)) entries[path] = { ...stamp, v: flat.get(path) }
  }
  return entries
}

/** Take every remote entry that is newer than ours. Returns the settings patch and the stamps to keep (null when nothing changed). */
export function mergeRemote(settings: Partial<Settings>, stamps: Record<string, Stamp>, remotes: DeviceFile[]): { patch: Partial<Settings>; stamps: Record<string, Stamp> } | null {
  const flat = flatten(settings)
  const next = { ...stamps }
  const touched = new Set<string>()
  for (const remote of remotes) {
    for (const [path, entry] of Object.entries(remote.entries ?? {})) {
      if (!SYNCED_KEYS.includes(keyOf(path)) || !entry || typeof entry.t !== 'number' || typeof entry.d !== 'string') continue
      if (!newer(entry, next[path])) continue
      next[path] = entry.del ? { t: entry.t, d: entry.d, del: true } : { t: entry.t, d: entry.d }
      if (entry.del) {
        if (flat.delete(path)) touched.add(path)
      } else if (!same(flat.get(path), entry.v)) {
        flat.set(path, entry.v)
        touched.add(path)
      }
    }
  }
  const stampsChanged = Object.keys(next).length !== Object.keys(stamps).length || Object.entries(next).some(([p, s]) => stamps[p] !== s)
  if (!touched.size && !stampsChanged) return null
  return { patch: touched.size ? unflatten(flat, touched) : {}, stamps: next }
}
