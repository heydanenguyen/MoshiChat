import { app, session, type Session, type WebContents } from 'electron'
import { CALL_ORIGINS, onDomain } from './target'

export interface PermissionQuestion {
  permission: string
  /** The page asking (its last URL). */
  url: string
  /** The page asking is part of the call that is open (its window, a popup of it) or of a ringing call's hidden window. */
  ownCall: boolean
  /** Moshi's own page: it keeps what it always had (voice messages, paste, full screen), except sharing the screen. */
  isAppPage: boolean
}

/**
 * Whether a page may have a browser permission. The camera and microphone go to the call's own pages, and only on the four
 * call sites; screen capture is never given; other web pages get nothing but full screen and sanitised copy (as before).
 */
export function permissionAllowed({ permission, url, ownCall, isAppPage }: PermissionQuestion): boolean {
  if (permission === 'display-capture') return false
  if (isAppPage) return true
  if (permission === 'media' || permission === 'speaker-selection') return ownCall && onDomain(url, CALL_ORIGINS)
  return permission === 'fullscreen' || permission === 'clipboard-sanitized-write'
}

export interface PermissionHost {
  /** Whether this page belongs to the open call (or a ringing one). */
  ownsCall(webContents: WebContents | null): boolean
  isAppPage(url: string): boolean
}

function apply(ses: Session, host: PermissionHost): void {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details.requestingUrl || webContents.getURL()
    callback(permissionAllowed({ permission, url, ownCall: host.ownsCall(webContents), isAppPage: host.isAppPage(webContents.getURL()) }))
  })
  // Pages check before they ask (devices are listed, or a stream starts, only when the check passes).
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const url = details.requestingUrl || requestingOrigin
    return permissionAllowed({ permission, url, ownCall: host.ownsCall(webContents), isAppPage: host.isAppPage(webContents?.getURL() ?? url) })
  })
}

/** Puts the rules on every browser session the app has now and every one it creates later (a login window, a call, an account's own). */
export function installPermissions(host: PermissionHost): void {
  apply(session.defaultSession, host)
  app.on('session-created', (ses) => apply(ses, host))
}
