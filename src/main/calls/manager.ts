import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { ipcMain, shell, type NativeImage } from 'electron'
import type { WebContents } from 'electron'
import type { Account, BridgeEvent, CallSettings, CallState, IncomingCall, Language } from '@shared/types'
import { externalUrl } from '../safety'
import { CallWindow } from './call-window'
import { IncomingCalls, type IncomingPort, type RingHost } from './incoming'
import { FRAME_IPC } from './ipc'
import { instagramLauncher } from './launchers/instagram'
import { messengerLauncher } from './launchers/messenger'
import { zaloLauncher } from './launchers/zalo'
import { callTexts } from './strings'
import { callFeatureOf, callPlatformOf, recordProbe, type CallFeature, type CallKind, type CallPlatform, type ProbeRecord } from './target'
import type { CallBackend, CallHandle, CallSession, CallTarget, LaunchEnv, Launcher } from './types'

const LAUNCHERS: Record<CallPlatform, Launcher> = { messenger: messengerLauncher, instagram: instagramLauncher, zalo: zaloLauncher }

export interface CallManagerOptions {
  backend: CallBackend
  emit(event: BridgeEvent): void
  log(...args: unknown[]): void
  language(): Language
  /** The window's own colour in the current theme. */
  background(): string
  icon(): NativeImage | undefined
  /** Where what the Instagram probe found is kept (per account). */
  probeFile: string
  /** Settings -> Calls, defaults filled in. */
  callSettings(): CallSettings
}

/** Longest a start waits for the last call's tidying (its Zalo connection comes back only after the wipe): a call must not begin before that. */
const SETTLE_MS = 5000

interface ActiveCall {
  id: string
  /** Absent for a call answered from a ringing dialog (it is no chat's call). */
  conversationId?: string
  accountId: string
  platform: CallPlatform
  kind: CallKind
  startedAt: number
  window: CallHandle
  session?: CallSession
}

/** One call at a time: starts it in a call window of its own, tells the renderer, and tidies up when the window closes. */
export class CallManager {
  private current?: ActiveCall
  private starting = false
  private closing = false
  private probes: Record<string, ProbeRecord> = {}
  /** Ringing calls (fed by incoming.ts): the renderer takes every call:state as the whole picture, so they must be in each one. */
  private incoming: IncomingCall[] = []
  /** Pages that belong to a ringing call (hidden windows) and may use the microphone for it. */
  private readonly trusted = new Set<WebContents>()
  private readonly listened = new WeakSet<WebContents>()
  /** Cleaning up after windows (wiping what they stored), which quitting waits for. */
  private readonly pending = new Set<Promise<unknown>>()
  /** Listens to the hidden pages that can ring (incoming.ts) and answers in them. */
  private readonly rings: IncomingCalls

  constructor(private readonly options: CallManagerOptions) {
    this.rings = new IncomingCalls(this.ringPort())
    try {
      this.probes = JSON.parse(readFileSync(options.probeFile, 'utf8')) as Record<string, ProbeRecord>
    } catch {
      // no probe yet: every Instagram account starts out offering calls
    }
    // The bar of the call window: the only page whose messages end or minimise the call.
    ipcMain.on(FRAME_IPC.end, (event) => {
      if (this.current?.window.isFrame(event.sender)) this.end(this.current.id)
    })
    ipcMain.on(FRAME_IPC.minimize, (event) => {
      if (this.current?.window.isFrame(event.sender)) this.current.window.minimize()
    })
  }

  // Read after an await: the window may have closed meanwhile, which a narrowed field would not show.
  private currentCall(): ActiveCall | undefined {
    return this.current
  }

  /** Whether this page is part of the open call (or of a ringing one): the only pages a call site's camera and microphone go to. */
  owns(contents: WebContents | null): boolean {
    return !!contents && (!!this.current?.window.owns(contents) || this.trusted.has(contents))
  }

  /** A hidden window that rings or answers a call: its page may use the microphone until it is destroyed. */
  trust(contents: WebContents): void {
    this.trusted.add(contents)
    // One listener per page however often it is trusted again (a long-lived hidden window is, for every ring).
    if (this.listened.has(contents)) return
    this.listened.add(contents)
    contents.once('destroyed', () => this.trusted.delete(contents))
  }

  /** The ring is over (declined, gone, call finished): the hidden page loses the microphone it was lent. */
  untrust(contents: WebContents): void {
    this.trusted.delete(contents)
  }

  /** A hidden page starts listening for calls (and answers them): Instagram's realtime window, a Messenger presence window. */
  watchRing(host: RingHost): void {
    this.rings.watch(host)
  }

  forgetRing(host: RingHost): void {
    this.rings.forget(host)
  }

  addIncoming(call: IncomingCall): void {
    this.incoming = [...this.incoming.filter((c) => c.id !== call.id), call]
    this.options.emit({ type: 'call:incoming', call })
    this.options.emit({ type: 'call:state', state: this.state() })
  }

  removeIncoming(id: string): void {
    if (!this.incoming.some((c) => c.id === id)) return
    this.incoming = this.incoming.filter((c) => c.id !== id)
    this.options.emit({ type: 'call:state', state: this.state() })
  }

  state(): CallState {
    const call = this.current
    return { active: call && { id: call.id, conversationId: call.conversationId, accountId: call.accountId, platform: call.platform, kind: call.kind, startedAt: call.startedAt }, incoming: [...this.incoming] }
  }

  /** `features.call` for an account as the chat header should see it (Instagram drops to 'none' once the web app proved to have no calls). */
  features(accountId: string): CallFeature | undefined {
    const account = this.options.backend.account(accountId)
    return account && callFeatureOf(account, this.probes[accountId])
  }

  /** The account with its call feature settled; for every account the renderer is told about. */
  decorate(account: Account): Account {
    const call = callFeatureOf(account, this.probes[account.id])
    return call === account.features.call ? account : { ...account, features: { ...account.features, call } }
  }

  async start(conversationId: string, kind: CallKind): Promise<void> {
    const { backend } = this.options
    const text = callTexts(this.options.language())
    if (this.current || this.starting) throw new Error(text.busy)
    const conversation = backend.conversation(conversationId)
    if (!conversation) throw new Error(text.noChat)
    const account = backend.account(conversation.accountId)
    const platform = account && callPlatformOf(account)
    if (!account || !platform) throw new Error(text.unavailable)
    if (account.status === 'needs_auth') throw new Error(text.needsSignIn)

    this.starting = true
    const target: CallTarget = { account, conversation, platform }
    try {
      // The last call's window is still being tidied (a Zalo connection comes back after its wipe): that must be over first,
      // or the late resume would clear the pause of this call.
      await this.settled()
      const session = await LAUNCHERS[platform].start(target, kind, this.launchEnv(target, kind))
      const call = this.currentCall()
      if (!call) {
        // The window was closed while the page was still being prepared.
        session.end()
        return
      }
      call.session = session
      void session.settled.then((outcome) => platform === 'instagram' && this.probe(account.id, outcome))
    } catch (err) {
      this.currentCall()?.window.close()
      throw err
    } finally {
      this.starting = false
    }
  }

  end(id: string): void {
    if (this.current?.id === id) this.current.window.close()
  }

  /** Brings the call window of the call in progress to the front. */
  focus(): void {
    this.current?.window.show()
  }

  /** Answers a ringing call in the page that rings: its window becomes the call window. */
  answer(id: string): Promise<boolean> {
    return this.rings.answer(id)
  }

  decline(id: string): Promise<boolean> {
    return this.rings.decline(id)
  }

  /** Quitting: the call window goes with the app (Zalo's connection need not come back); what the window stored is wiped first. */
  async shutdown(): Promise<void> {
    this.closing = true
    this.rings.shutdown()
    const call = this.current
    call?.window.close()
    // A window's 'closed' comes a tick after close(), and what it stored is wiped (tracked in `pending`) from that handler:
    // look at `pending` only once every window has said it is gone.
    await call?.window.closed()
    await Promise.all(this.pending)
  }

  /** Everything the last call left to tidy is done (bounded: a stuck wipe must not hold a new call up for ever). */
  private async settled(): Promise<void> {
    if (!this.pending.size) return
    await Promise.race([Promise.all(this.pending), new Promise((resolve) => setTimeout(resolve, SETTLE_MS))])
  }

  /** What the incoming-call code may ask of the manager. */
  private ringPort(): IncomingPort {
    return {
      add: (call) => this.addIncoming(call),
      remove: (id) => this.removeIncoming(id),
      busy: () => !!this.current || this.starting,
      closing: () => this.closing,
      adopt: (id, call) => {
        const active: ActiveCall = { id, accountId: call.accountId, platform: call.platform, kind: call.kind, startedAt: Date.now(), window: call.handle }
        this.current = active
        // The ringing entry and the call in progress change hands in one message: the banner goes as the strip appears.
        this.incoming = this.incoming.filter((c) => c.id !== id)
        call.handle.onClosed(() => {
          if (this.current === active) this.current = undefined
          this.options.emit({ type: 'call:state', state: this.state() })
        })
        this.options.emit({ type: 'call:state', state: this.state() })
      },
      trust: (contents) => this.trust(contents),
      untrust: (contents) => this.untrust(contents),
      openExternal: (url) => {
        const safe = externalUrl(url)
        if (safe) void shell.openExternal(safe)
      },
      settings: () => this.options.callSettings(),
      language: () => this.options.language(),
      icon: () => this.options.icon(),
      log: (...args) => this.options.log(...args)
    }
  }

  private launchEnv(target: CallTarget, kind: CallKind): LaunchEnv {
    const { backend, log } = this.options
    const language = this.options.language()
    const text = callTexts(language)
    return {
      language,
      log,
      track: (work) => {
        const done: Promise<unknown> = work.catch(() => undefined).finally(() => this.pending.delete(done))
        this.pending.add(done)
      },
      backend: {
        ...backend,
        // A shut-down app has no use for the connection coming back.
        zalo: (id) => {
          const control = backend.zalo(id)
          return control && { pauseForCall: () => control.pauseForCall(), resumeAfterCall: () => !this.closing && control.resumeAfterCall() }
        }
      },
      open: ({ info, ...rest }) => {
        const startedAt = Date.now()
        const avatar = info.avatarUrl && /^https:/.test(info.avatarUrl) ? `unison-img://img/?u=${encodeURIComponent(info.avatarUrl)}` : undefined
        const window = new CallWindow({
          ...rest,
          icon: this.options.icon(),
          background: this.options.background(),
          log,
          info: { ...info, avatarUrl: avatar, startedAt, platformLabel: text.platform[info.platform], kindLabel: text.kind[kind], minimizeLabel: text.minimize, endLabel: text.end }
        })
        const call: ActiveCall = { id: randomUUID(), conversationId: target.conversation.id, accountId: target.account.id, platform: target.platform, kind, startedAt, window }
        this.current = call
        window.onClosed(() => {
          if (this.current === call) this.current = undefined
          this.options.emit({ type: 'call:state', state: this.state() })
        })
        this.options.emit({ type: 'call:state', state: this.state() })
        return window
      }
    }
  }

  /** Instagram's web app may not offer calls on an account: what each attempt found decides whether the buttons stay. */
  private probe(accountId: string, outcome: 'clicked' | 'not-found' | 'skipped'): void {
    if (outcome === 'skipped') return
    const before = this.features(accountId)
    this.probes[accountId] = recordProbe(this.probes[accountId], outcome === 'clicked', Date.now())
    void writeFile(this.options.probeFile, JSON.stringify(this.probes)).catch((err: Error) => this.options.log('[call] probe not saved:', err.message))
    const account = this.options.backend.account(accountId)
    if (account && before !== this.features(accountId)) this.options.emit({ type: 'account:updated', account: this.decorate(account) })
  }
}
