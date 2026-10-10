import type { CallKind, CallPlatform } from './target'

/** Channels between the call window's frame page (its own tiny preload) and the main process. */
export const FRAME_IPC = {
  end: 'call-frame:end',
  minimize: 'call-frame:minimize',
  state: 'call-frame:state'
} as const

/** What the frame page shows. Texts arrive already in the app's language; the page itself knows none. Kept in step with src/renderer/src/call-frame/main.ts. */
export interface FrameInfo {
  name: string
  platform: CallPlatform
  platformLabel: string
  kind: CallKind
  kindLabel: string
  avatarUrl?: string
  /** When the window opened (ms since epoch): the clock counts from here. */
  startedAt: number
  /** A line that replaces the platform name while there is something to tell (opening, "press the call button"). */
  hint?: string
  minimizeLabel: string
  endLabel: string
}
