import { browserUserAgent } from '../../user-agent'
import { callTexts } from '../strings'
import { PLATFORM_HOSTS, callUrl, isLoginPage, threadIdOf, type CallKind } from '../target'
import type { CallTarget, LaunchEnv, Launcher } from '../types'
import { launchPage } from './common'

/** Messenger: the chat on facebook.com in the account's own signed-in session; Facebook opens the call in a popup the window adopts. */
export const messengerLauncher: Launcher = {
  async start({ account, conversation }: CallTarget, kind: CallKind, env: LaunchEnv) {
    const text = callTexts(env.language)
    const win = env.open({
      partition: env.backend.partition(account.id, 'messenger'),
      // A page that looks like Electron is not served the call: same user agent as the sign-in window.
      userAgent: browserUserAgent(),
      hosts: PLATFORM_HOSTS.messenger,
      info: { name: conversation.title, platform: 'messenger', kind, avatarUrl: conversation.avatarUrl, hint: text.opening }
    })
    return launchPage(win, { url: callUrl('messenger', threadIdOf(conversation.id)), kind, lookMs: 8000, threadPath: '/messages/', missing: text.pressCall, unsure: text.pressCall, signIn: text.signIn, loadFailed: text.loadFailed, isLoginPage }, env.log)
  }
}
