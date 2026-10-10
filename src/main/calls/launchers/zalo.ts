import { session } from 'electron'
import { ZALO_HEADER_SCRIPT, ZALO_SEARCH_SCRIPT, headerMatches, pickChatHit, zaloHitsScript, type ChatHit } from '../buttons'
import type { CallWindow } from '../call-window'
import { callTexts } from '../strings'
import { PLATFORM_HOSTS, callUrl, threadIdOf, type CallKind } from '../target'
import type { CallSession, CallTarget, LaunchEnv, LaunchOutcome, Launcher } from '../types'
import { zaloSessionCookies } from '../zalo-cookies'
import { clickAt, pressCallButton, sleep, waitForResult } from './common'

type Point = { x: number; y: number }

/** The call window's own session: its cookies are only ever the ones lent from the account's saved login. */
export const zaloCallPartition = (accountId: string): string => `persist:zalo-call-${accountId.replace(/[^\w-]/g, '_')}`

/**
 * Zalo allows one web session per login: opening chat.zalo.me with the account's cookie closes the socket Moshi itself
 * keeps (code 3000). So the account's connection steps aside for the call (pauseForCall) and comes back when the window
 * closes (resumeAfterCall), and everything the call window stored (cookies, message cache) is wiped first. The session on
 * Zalo's side is never logged out.
 */
export const zaloLauncher: Launcher = {
  async start({ account, conversation }: CallTarget, kind: CallKind, env: LaunchEnv): Promise<CallSession> {
    const text = callTexts(env.language)
    const credentials = env.backend.zaloCredentials(account.id)
    if (!credentials) throw new Error(text.needsSignIn)
    const control = env.backend.zalo(account.id)
    const partition = zaloCallPartition(account.id)
    const ses = session.fromPartition(partition)
    const wipe = (): Promise<void> => ses.clearStorageData().catch(() => undefined)
    await wipe()
    for (const cookie of zaloSessionCookies(credentials.cookie)) await ses.cookies.set(cookie).catch((err: Error) => env.log('[call] zalo cookie skipped:', cookie.name, err.message))

    control?.pauseForCall()
    // Let the socket close on Zalo's side before the web app opens its own.
    await sleep(500)
    let win: CallWindow
    try {
      win = env.open({
        partition,
        userAgent: credentials.userAgent,
        hosts: PLATFORM_HOSTS.zalo,
        info: { name: conversation.title, platform: 'zalo', kind, avatarUrl: conversation.avatarUrl, hint: text.opening }
      })
    } catch (err) {
      control?.resumeAfterCall()
      throw err
    }
    // The wipe finishes before the connection comes back (and before a quitting app lets go).
    win.onClosed(() => env.track(wipe().then(() => control?.resumeAfterCall())))

    const settled = (async (): Promise<LaunchOutcome> => {
      // Zalo's web app names this device by localStorage.z_uuid, which is the imei the saved login was made with. It is set
      // from a page of the same site that runs no app code, so the app never sees (and registers) a device of its own.
      await win.load(`${callUrl('zalo', '')}robots.txt`)
      if (win.isClosed) return 'skipped'
      await win.contents.executeJavaScript(`try { localStorage.setItem('z_uuid', ${JSON.stringify(credentials.imei)}) } catch {}`)
      await win.load(callUrl('zalo', ''))
      if (win.isClosed) return 'skipped'
      if (!(await openChat(win, conversation.title, threadIdOf(conversation.id)))) {
        win.setHint(text.pickChat)
        return 'not-found'
      }
      const pressed = await pressCallButton(win.contents, kind, 8000)
      if (win.isClosed) return 'skipped'
      win.setHint(pressed ? undefined : text.pressCall)
      return pressed ? 'clicked' : 'not-found'
    })().catch((err: Error) => {
      env.log('[call] zalo launch failed:', err.message)
      if (!win.isClosed) win.setHint(text.loadFailed)
      return 'skipped' as const
    })
    return { end: () => win.close(), onEnded: (handler) => win.onClosed(handler), settled }
  }
}

/**
 * Opens the chat through the list's search box and makes sure it is the right one before anything is dialled: the search must
 * show it exactly once (or one hit must carry the thread id), and the header that opens must read the same name. False
 * otherwise (no search box, no match, two people with that name, another header): the person picks the chat themselves.
 */
async function openChat(win: CallWindow, title: string, threadId: string): Promise<boolean> {
  const { contents } = win
  const search = await waitForResult<Point>(contents, ZALO_SEARCH_SCRIPT, 25_000)
  if (!search || win.isClosed) return false
  clickAt(contents, search)
  await contents.insertText(title)
  if (!(await waitForResult<ChatHit[]>(contents, zaloHitsScript(title), 8000)) || win.isClosed) return false
  // The rest of the results arrive just after the first: a second one with the same name is what must not be missed.
  await sleep(700)
  const hits = (await contents.executeJavaScript(zaloHitsScript(title))) as ChatHit[]
  const hit = pickChatHit(hits, threadId)
  if (!hit || win.isClosed) return false
  clickAt(contents, hit)
  const until = Date.now() + 5000
  while (Date.now() < until && !win.isClosed) {
    await sleep(400)
    const header = await contents.executeJavaScript(ZALO_HEADER_SCRIPT).catch(() => [])
    if (headerMatches(header as string[], title)) return true
  }
  return false
}
