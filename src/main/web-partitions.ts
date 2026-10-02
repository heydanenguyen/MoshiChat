import { randomUUID } from 'node:crypto'
import { session } from 'electron'

/**
 * Each personal Facebook / Instagram account keeps its sign-in cookies in a browser session of its own, so a second
 * account never takes over (or signs out) the first. Accounts from before this keep the original shared session
 * (`persist:login-<platform>`), so nobody has to sign in again.
 */
export type WebPlatform = 'messenger' | 'instagram'

export const legacyPartition = (platform: WebPlatform): string => `persist:login-${platform}`

const inUse = new Map<string, { platform: WebPlatform; partition: string }>()

export function rememberPartition(accountId: string, platform: WebPlatform, partition: string): void {
  inUse.set(accountId, { platform, partition })
}

export function forgetPartition(accountId: string): void {
  inUse.delete(accountId)
}

/** The session a new account signs in with: the shared one while no account uses it, else a fresh one of its own. */
export function freshPartition(platform: WebPlatform): string {
  const legacy = legacyPartition(platform)
  const taken = [...inUse.values()].some((u) => u.partition === legacy)
  return taken ? newPartition(platform) : legacy
}

/** A session of its own for an account whose current one is signed in to somebody else. */
export function newPartition(platform: WebPlatform): string {
  return `${legacyPartition(platform)}-${randomUUID().slice(0, 8)}`
}

/** The cookie that names who a session is signed in as (c_user on Facebook, ds_user_id on Instagram). */
export const USER_COOKIE: Record<WebPlatform, string> = { messenger: 'c_user', instagram: 'ds_user_id' }

/** Who `partition` is signed in to right now, if anyone. */
export async function sessionUser(platform: WebPlatform, partition: string): Promise<string | undefined> {
  const domain = platform === 'messenger' ? 'facebook.com' : 'instagram.com'
  const cookies = await session.fromPartition(partition).cookies.get({ domain, name: USER_COOKIE[platform] }).catch(() => [])
  return cookies[0]?.value || undefined
}

/** A signed-in session of this platform, for fetching its media (any account's will do); the shared one otherwise. */
export function partitionFor(platform: WebPlatform): string {
  return [...inUse.values()].find((u) => u.platform === platform)?.partition ?? legacyPartition(platform)
}

/** A removed account's own session is wiped (cookies and cache); the shared one is left for the next account. */
export async function wipePartition(platform: WebPlatform, partition: string): Promise<void> {
  if (partition === legacyPartition(platform) || [...inUse.values()].some((u) => u.partition === partition)) return
  await session.fromPartition(partition).clearStorageData().catch(() => undefined)
}
