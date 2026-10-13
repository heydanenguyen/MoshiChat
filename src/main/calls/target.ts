import type { Account } from '@shared/types'
import { externalIdOf } from '../adapters/types'

export type CallKind = 'audio' | 'video'
export type CallPlatform = 'messenger' | 'instagram' | 'zalo'
/** The platforms whose calls run in their web app, in Moshi's call window (Zalo's are handed to Zalo PC). */
export type WebCallPlatform = Exclude<CallPlatform, 'zalo'>
export type CallFeature = 'audio' | 'video' | 'both' | 'none'

/** The sites each platform's call page may stay on (anything else opens in the system browser). */
export const PLATFORM_HOSTS: Record<WebCallPlatform, string[]> = {
  messenger: ['facebook.com', 'messenger.com'],
  instagram: ['instagram.com']
}

/** Where a call's camera and microphone may be used (permissions.ts). */
export const CALL_ORIGINS = ['facebook.com', 'messenger.com', 'instagram.com']

/** Instagram's web app may not offer calls on an account at all: this many misses in a row and the buttons are hidden... */
export const PROBE_MISSES_TO_HIDE = 3
/** ...for this long; then the verdict is forgotten and the buttons come back (Instagram changes its web app, so it is asked again). */
export const PROBE_VERDICT_MS = 7 * 24 * 3600_000

export interface ProbeRecord {
  misses: number
  at: number
}

/** Whether `url` is https on one of `domains` or their subdomains. */
export function onDomain(url: string, domains: readonly string[]): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return domains.some((d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/** Which platform's web app can call for this account; undefined for demo accounts, relays and everything that cannot call. */
export function callPlatformOf(account: Pick<Account, 'id' | 'platform' | 'demo'>): CallPlatform | undefined {
  if (account.demo) return undefined
  if (account.platform === 'messenger' && account.id.startsWith('messenger:fb-')) return 'messenger'
  if (account.platform === 'instagram' && account.id.startsWith('instagram:ig-')) return 'instagram'
  // A relay account (zalo:relay-<owner>) has no session of its own to hand over.
  if (account.platform === 'zalo' && !account.id.startsWith('zalo:relay-')) return 'zalo'
  return undefined
}

/** The id the platform's own web app names the chat by. */
export const threadIdOf = (conversationId: string): string => externalIdOf(conversationId)

/** The page that holds the chat (and so its call buttons). */
export function callUrl(platform: WebCallPlatform, threadId: string): string {
  if (platform === 'messenger') return `https://www.facebook.com/messages/t/${encodeURIComponent(threadId)}`
  return `https://www.instagram.com/direct/t/${encodeURIComponent(threadId)}/`
}

/** A probe still worth counting: one older than the verdict's life is forgotten. */
const live = (probe: ProbeRecord | undefined, now: number): ProbeRecord | undefined => (probe && now - probe.at < PROBE_VERDICT_MS ? probe : undefined)

/** What a probe adds up to: three misses in a row hide Instagram's call buttons, one hit brings them back. */
export function recordProbe(previous: ProbeRecord | undefined, found: boolean, now: number): ProbeRecord {
  return { misses: found ? 0 : (live(previous, now)?.misses ?? 0) + 1, at: now }
}

/**
 * `features.call` as the chat header should see it for this account. Zalo's web app has no calls (chat.zalo.me dropped
 * them); its one button opens the chat in Zalo PC to call from there, so it shows only where Zalo PC is installed.
 */
export function callFeatureOf(account: Pick<Account, 'id' | 'platform' | 'demo' | 'features'>, probe: ProbeRecord | undefined, now = Date.now(), zaloDesktop = false): CallFeature | undefined {
  const platform = callPlatformOf(account)
  if (!platform) return account.features.call
  if (platform === 'zalo') return zaloDesktop ? 'audio' : 'none'
  if (platform === 'instagram' && (live(probe, now)?.misses ?? 0) >= PROBE_MISSES_TO_HIDE) return 'none'
  return 'both'
}

/**
 * Zalo PC's own link to a one-to-one chat (handled by the app: zalo://conversation?id=<user id>). A group has no such
 * link, so none is made for it.
 */
export function zaloDesktopLink(threadId: string): string | undefined {
  return /^\d+$/.test(threadId) ? `zalo://conversation?id=${threadId}` : undefined
}

/** The page Facebook and Instagram show to a session that is not signed in (a call cannot start there). */
export function isLoginPage(url: string): boolean {
  try {
    return /^\/(login|checkpoint|accounts\/login|recover)(\/|\.php|$)/.test(new URL(url).pathname)
  } catch {
    return false
  }
}
