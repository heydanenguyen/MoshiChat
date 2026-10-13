import type { WebContents } from 'electron'
import type { Account, Conversation, Language } from '@shared/types'
import type { CallWindow } from './call-window'
import type { FrameInfo } from './ipc'
import type { CallKind, WebCallPlatform } from './target'

/** What the call code needs from the account manager (and nothing more, so it can be tested apart). */
export interface CallBackend {
  account(accountId: string): Account | undefined
  conversation(conversationId: string): Conversation | undefined
  /** The browser session a personal Messenger / Instagram account is signed in with. */
  partition(accountId: string, platform: 'messenger' | 'instagram'): string
}

export interface CallTarget {
  account: Account
  conversation: Conversation
  platform: WebCallPlatform
}

/** What a launcher gets to work with. */
export interface LaunchEnv {
  backend: CallBackend
  language: Language
  log(...args: unknown[]): void
  /** Work that must finish before the app quits or the call is forgotten (wiping what a window stored). */
  track(work: Promise<unknown>): void
  /** Opens the call window (the manager tracks it from this moment on, so ending the call also covers a launch still under way). */
  open(options: { partition: string; userAgent: string; hosts: readonly string[]; info: Omit<FrameInfo, 'startedAt' | 'platformLabel' | 'kindLabel' | 'minimizeLabel' | 'endLabel'> }): CallWindow
}

export type LaunchOutcome =
  /** A call button was pressed. */
  | 'clicked'
  /** The chat page loaded but has no such button. */
  | 'not-found'
  /** Nothing could be tried (signed out, page failed, window closed first). */
  | 'skipped'

export interface CallSession {
  end(): void
  onEnded(handler: () => void): void
  /** Settles when the launcher is done trying to press the call button. */
  settled: Promise<LaunchOutcome>
}

export interface Launcher {
  start(target: CallTarget, kind: CallKind, env: LaunchEnv): Promise<CallSession>
}

/** The window a call in progress lives in: Moshi's call window, or a hidden page's window that answered a ringing call. */
export interface CallHandle {
  close(): void
  show(): void
  minimize(): void
  /** Whether this page is part of the call (what its camera and microphone are for). */
  owns(contents: WebContents | null): boolean
  /** Whether the sender is the call window's own bar (only Moshi's call window has one). */
  isFrame(sender: WebContents): boolean
  onClosed(handler: () => void): void
  /** Settles once the window is gone and every closed handler has run (what quitting waits for before it looks at what is left to tidy). */
  closed(): Promise<void>
}
