import { browserUserAgent } from '../../user-agent'
import { callTexts } from '../strings'
import { PLATFORM_HOSTS, callUrl, isLoginPage, threadIdOf, type CallKind } from '../target'
import type { CallTarget, LaunchEnv, Launcher } from '../types'
import { launchPage } from './common'

/**
 * Instagram: the thread on instagram.com. Calling is not offered on every account on the web, so a page without the
 * button counts as a miss (see the probe in manager.ts) and says so instead of asking to press something that is not there.
 */
export const instagramLauncher: Launcher = {
  async start({ account, conversation }: CallTarget, kind: CallKind, env: LaunchEnv) {
    const text = callTexts(env.language)
    const win = env.open({
      partition: env.backend.partition(account.id, 'instagram'),
      userAgent: browserUserAgent(),
      hosts: PLATFORM_HOSTS.instagram,
      info: { name: conversation.title, platform: 'instagram', kind, avatarUrl: conversation.avatarUrl, hint: text.opening }
    })
    return launchPage(win, { url: callUrl('instagram', threadIdOf(conversation.id)), kind, lookMs: 12000, threadPath: '/direct/t/', missing: text.instagramNone, unsure: text.pressCall, signIn: text.signIn, loadFailed: text.loadFailed, isLoginPage }, env.log)
  }
}
