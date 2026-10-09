import type { Settings } from '@shared/types'

/** Settings only the main process writes (the lock, the scheduler, Later and birthdays): a patch from the window never carries them. */
const MAIN_OWNED = ['appLock', 'scheduled', 'snoozed', 'followUps', 'birthdaysNotified'] as const

/** The patch without the main-owned keys, and which keys were dropped. */
export function stripMainOwned(patch: Partial<Settings>): { clean: Partial<Settings>; dropped: string[] } {
  const clean = { ...patch }
  const dropped: string[] = []
  for (const key of MAIN_OWNED) {
    if (key in clean) {
      delete clean[key]
      dropped.push(key)
    }
  }
  return { clean, dropped }
}

/**
 * What to drop from the per-chat settings (tags, pins, hidden, marked-unread, archived, mentions-only and accepted-request
 * chats, nicknames, saved messages, mutes, scheduled messages, snoozes, follow-ups, to-dos) for chats of accounts that
 * no longer exist, so counts and lists never include chats that are gone. Empty when nothing is orphaned.
 */
export function orphanedSettingsPatch(settings: Settings, accountIds: ReadonlySet<string>): Partial<Settings> {
  const owned = (conversationId: string): boolean => {
    const slash = conversationId.indexOf('/')
    return slash > 0 && accountIds.has(conversationId.slice(0, slash))
  }
  const keep = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined =>
    record ? Object.fromEntries(Object.entries(record).filter(([id]) => owned(id))) : record
  const patch: Partial<Settings> = {}
  const tags = keep(settings.tags) ?? {}
  if (Object.keys(tags).length !== Object.keys(settings.tags ?? {}).length) patch.tags = tags
  const pins = keep(settings.pins)
  if (pins && Object.keys(pins).length !== Object.keys(settings.pins ?? {}).length) patch.pins = pins
  const hidden = keep(settings.hidden)
  if (hidden && Object.keys(hidden).length !== Object.keys(settings.hidden ?? {}).length) patch.hidden = hidden
  // People are left as they are: another computer may have the accounts of the chats missing here (a person
  // with one chat around simply shows as that chat).
  for (const key of ['markedUnread', 'archived', 'mentionsOnly', 'acceptedRequests', 'snoozed', 'followUps'] as const) {
    const kept = keep<unknown>(settings[key])
    if (kept && Object.keys(kept).length !== Object.keys(settings[key] ?? {}).length) Object.assign(patch, { [key]: kept })
  }
  const overrides = keep(settings.contactOverrides)
  if (overrides && Object.keys(overrides).length !== Object.keys(settings.contactOverrides ?? {}).length) patch.contactOverrides = overrides
  const saved = settings.savedMessages?.filter((m) => owned(m.conversationId))
  if (saved && saved.length !== settings.savedMessages?.length) patch.savedMessages = saved
  const scheduled = settings.scheduled?.filter((m) => owned(m.conversationId))
  if (scheduled && scheduled.length !== settings.scheduled?.length) patch.scheduled = scheduled
  // A to-do typed by hand has no chat and stays.
  const todos = settings.todos?.filter((t) => !t.conversationId || owned(t.conversationId))
  if (todos && todos.length !== settings.todos?.length) patch.todos = todos
  const mutedChats = settings.muted?.conversations.filter(owned)
  const mutedAccounts = settings.muted?.accounts.filter((id) => accountIds.has(id))
  if (settings.muted && (mutedChats?.length !== settings.muted.conversations.length || mutedAccounts?.length !== settings.muted.accounts.length)) {
    patch.muted = { ...settings.muted, conversations: mutedChats ?? [], accounts: mutedAccounts ?? [] }
  }
  return patch
}
