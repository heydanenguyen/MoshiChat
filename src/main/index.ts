import { app, BrowserWindow, dialog, ipcMain, Notification, nativeImage, nativeTheme, session, shell } from 'electron'
import { join, basename } from 'path'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import type { AddAccountInput, BridgeEvent, OutgoingAttachment, PageOption, SendOptions, Settings, SharedKind } from '@shared/types'
import type { WebCookie } from './adapters/facebook-personal'
import { IPC } from '@shared/bridge'
import { isMutedBy } from '@shared/types'
import { Storage } from './storage'
import { AccountManager } from './adapters/manager'
import { mimeOf } from './adapters/types'
import { webmToOgg } from './media/webm-to-ogg'
import { getWeather } from './weather'

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

let window: BrowserWindow | undefined
const storage = new Storage()
const log = (...args: unknown[]): void => console.log('[unison]', ...args)

const emit = (event: BridgeEvent): void => {
  if (window && !window.isDestroyed()) window.webContents.send(IPC.event, event)
  if (event.type === 'message:new' && !event.message.isOutgoing) notify(event)
}

const manager = new AccountManager(storage, emit, log)

function notify(event: Extract<BridgeEvent, { type: 'message:new' }>): void {
  if (!storage.settings.notifications || !Notification.isSupported()) return
  if (window?.isFocused()) return
  // Ignore history that is older than a minute (initial syncs replay old messages).
  if (Date.now() - event.message.sentAt > 60_000) return
  const conversation = manager.listConversations().find((c) => c.id === event.message.conversationId)
  if (conversation?.muted) return
  if (conversation && isMutedBy(storage.settings, conversation)) return
  const title = conversation?.isGroup ? `${event.message.senderName} in ${conversation.title}` : event.message.senderName
  const notification = new Notification({
    title,
    body: event.message.text || 'Sent an attachment',
    silent: false
  })
  notification.on('click', () => {
    window?.show()
    window?.focus()
    window?.webContents.send(IPC.event, { type: 'focus-conversation', conversationId: event.message.conversationId })
  })
  notification.show()
}

function applyTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme
}

function appIcon(): Electron.NativeImage | undefined {
  const image = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  return image.isEmpty() ? undefined : image
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 420,
    minHeight: 480,
    show: false,
    title: 'Unison',
    icon: appIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    // A thin custom title bar on every platform; macOS keeps its native traffic lights inset into it.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      webSecurity: true
    }
  })

  window.once('ready-to-show', () => window?.show())
  // Safety net: never leave the user with an invisible window if the first paint stalls.
  setTimeout(() => {
    if (window && !window.isDestroyed() && !window.isVisible()) window.show()
  }, 4000)
  window.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) log('renderer:', message, source ? `(${source}:${line})` : '')
  })
  window.webContents.on('preload-error', (_e, path, error) => log('preload error', path, error.message))
  window.on('closed', () => (window = undefined))
  const sendState = (): void => {
    if (window && !window.isDestroyed()) window.webContents.send(IPC.event, { type: 'window:state', maximized: window.isMaximized() })
  }
  window.on('maximize', sendState)
  window.on('unmaximize', sendState)

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function hardenSession(): void {
  // In development Vite injects inline scripts (React Fast Refresh), so the policy is only applied to packaged builds.
  if (process.env.ELECTRON_RENDERER_URL) return
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: file:",
    "media-src 'self' data: https: file:",
    "connect-src 'self'"
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
}

async function pickFiles(): Promise<OutgoingAttachment[]> {
  if (!window) return []
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'] },
      { name: 'Videos', extensions: ['mp4', 'mov', 'webm'] }
    ]
  })
  if (result.canceled) return []
  const files: OutgoingAttachment[] = []
  for (const path of result.filePaths) {
    const info = await stat(path)
    const mime = mimeOf(path)
    const preview = mime.startsWith('image/') && info.size < 3_000_000 ? `data:${mime};base64,${(await readFile(path)).toString('base64')}` : undefined
    files.push({ path, name: basename(path), mime, size: info.size, preview })
  }
  return files
}

/** Persist a MediaRecorder voice note as Ogg/Opus so platforms treat it as a voice message. */
async function saveVoice(bytes: Uint8Array, durationSeconds: number): Promise<OutgoingAttachment> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let data: Uint8Array = bytes
  let ext = 'webm'
  let mime = 'audio/webm'
  try {
    data = webmToOgg(bytes)
    ext = 'ogg'
    mime = 'audio/ogg'
  } catch (err) {
    log('voice remux failed, keeping WebM:', (err as Error).message)
  }
  const path = join(app.getPath('temp'), `unison-voice-${stamp}.${ext}`)
  await writeFile(path, data)
  return {
    path,
    name: `voice-${stamp}.${ext}`,
    mime,
    size: data.length,
    voice: true,
    duration: Math.round(durationSeconds),
    preview: data.length < 2_000_000 ? `data:${mime};base64,${Buffer.from(data).toString('base64')}` : undefined
  }
}

/** Open an attachment with the default app: remote URLs go to the browser, everything else is fetched to a temp file. */
async function openAttachment(conversationId: string, messageId: string, attachmentId: string): Promise<void> {
  const cached = manager.cachedAttachment(conversationId, messageId, attachmentId)
  let url = cached?.attachment.url
  if (!url || url.startsWith('data:') === false && !/^https?:/.test(url)) url = await manager.loadAttachment(conversationId, messageId, attachmentId)
  if (!url) throw new Error('Attachment is not available')
  if (/^https?:/.test(url)) {
    await shell.openExternal(url)
    return
  }
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url)
  if (!match) throw new Error('Unsupported attachment')
  const name = cached?.attachment.name ?? `attachment-${attachmentId}`
  const ext = name.includes('.') ? '' : '.' + (match[1].split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '')
  const path = join(app.getPath('temp'), 'unison-open', `${Date.now()}-${name.replace(/[\\/:*?"<>|]/g, '_')}${ext}`)
  await mkdir(join(app.getPath('temp'), 'unison-open'), { recursive: true })
  await writeFile(path, Buffer.from(match[2], 'base64'))
  const error = await shell.openPath(path)
  if (error) throw new Error(error)
}

const WEB_LOGIN: Record<'messenger' | 'instagram', { url: string; domain: string; required: string[] }> = {
  messenger: { url: 'https://www.facebook.com/login.php', domain: '.facebook.com', required: ['c_user', 'xs'] },
  instagram: { url: 'https://www.instagram.com/accounts/login/', domain: '.instagram.com', required: ['sessionid', 'ds_user_id'] }
}

/**
 * Let the user sign in on the platform's real login page inside a dedicated
 * app window, then hand the session cookies to the adapter. Passwords are
 * typed into the platform's page only; Unison never sees them.
 */
async function captureWebSession(platform: 'messenger' | 'instagram', fresh = false): Promise<WebCookie[]> {
  const spec = WEB_LOGIN[platform]
  const ses = session.fromPartition(`persist:login-${platform}`)
  if (fresh) {
    // Drop only the dead login cookies; keep device ids (datr, mid, ig_did) so the platform recognises this device.
    for (const name of spec.required) {
      for (const c of await ses.cookies.get({ name })) {
        await ses.cookies.remove(`https://${(c.domain ?? spec.domain).replace(/^\./, '')}${c.path ?? '/'}`, name).catch(() => undefined)
      }
    }
  }
  return new Promise<WebCookie[]>((resolve, reject) => {
    const loginWindow = new BrowserWindow({
      width: 480,
      height: 720,
      parent: window,
      modal: false,
      title: platform === 'messenger' ? 'Facebook' : 'Instagram',
      autoHideMenuBar: true,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    let settled = false
    const finish = (err?: Error, cookies?: WebCookie[]): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      if (!loginWindow.isDestroyed()) loginWindow.close()
      err ? reject(err) : resolve(cookies ?? [])
    }
    const check = async (): Promise<void> => {
      try {
        const cookies = await ses.cookies.get({ domain: spec.domain.replace(/^\./, '') })
        const names = new Set(cookies.map((c) => c.name))
        if (spec.required.every((n) => names.has(n))) {
          finish(undefined, cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expirationDate: c.expirationDate })))
        }
      } catch {
        /* window closing */
      }
    }
    const timer = setInterval(() => void check(), 1200)
    loginWindow.on('closed', () => finish(new Error('Sign-in cancelled')))
    // Reuse an existing session immediately when the cookies are still valid.
    void check()
    void loginWindow.loadURL(spec.url)
  })
}

const OAUTH_REDIRECT = 'https://www.facebook.com/connect/login_success.html'
const PAGE_SCOPES = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement', 'instagram_basic', 'instagram_manage_messages']

/** Facebook Login popup with the user's own App ID; returns the Pages they manage with page tokens. */
async function listPages(appId: string): Promise<PageOption[]> {
  const token = await new Promise<string>((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 560,
      height: 720,
      parent: window,
      title: 'Facebook Login',
      autoHideMenuBar: true,
      webPreferences: { session: session.fromPartition('persist:login-messenger'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    let settled = false
    const done = (err?: Error, value?: string): void => {
      if (settled) return
      settled = true
      if (!authWindow.isDestroyed()) authWindow.close()
      err ? reject(err) : resolve(value ?? '')
    }
    const inspect = (url: string): void => {
      if (!url.startsWith(OAUTH_REDIRECT)) return
      const hash = new URLSearchParams(url.split('#')[1] ?? '')
      const query = new URL(url).searchParams
      const accessToken = hash.get('access_token')
      const error = query.get('error_description') ?? hash.get('error_description') ?? query.get('error')
      if (accessToken) done(undefined, accessToken)
      else done(new Error(error ?? 'Facebook Login was cancelled'))
    }
    authWindow.webContents.on('will-redirect', (_e, url) => inspect(url))
    authWindow.webContents.on('did-navigate', (_e, url) => inspect(url))
    authWindow.webContents.on('did-navigate-in-page', (_e, url) => inspect(url))
    authWindow.on('closed', () => done(new Error('Facebook Login was cancelled')))
    const url = new URL('https://www.facebook.com/v21.0/dialog/oauth')
    url.searchParams.set('client_id', appId.trim())
    url.searchParams.set('redirect_uri', OAUTH_REDIRECT)
    url.searchParams.set('response_type', 'token')
    url.searchParams.set('scope', PAGE_SCOPES.join(','))
    void authWindow.loadURL(url.toString())
  })
  const response = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,picture{url},instagram_business_account{id,username}&limit=100&access_token=${encodeURIComponent(token)}`)
  const json = (await response.json()) as { data?: Array<{ id: string; name: string; access_token: string; picture?: { data: { url: string } }; instagram_business_account?: { id: string; username: string } }>; error?: { message: string } }
  if (json.error) throw new Error(json.error.message)
  return (json.data ?? []).map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token, pictureUrl: p.picture?.data.url, instagram: p.instagram_business_account }))
}

function registerIpc(): void {
  ipcMain.handle(IPC.accountsList, () => manager.listAccounts())
  ipcMain.handle(IPC.accountsAdd, (_e, input: AddAccountInput) => manager.add(input))
  ipcMain.handle(IPC.accountsRemove, (_e, id: string) => manager.remove(id))
  ipcMain.handle(IPC.accountsReconnect, async (_e, id: string) => {
    const web = id.startsWith('instagram:ig-') ? 'instagram' : id.startsWith('messenger:fb-') ? 'messenger' : undefined
    const account = manager.listAccounts().find((a) => a.id === id)
    if (web && account && account.status !== 'connected') {
      await manager.reauthWebSession(id, await captureWebSession(web, true))
      return
    }
    await manager.reconnect(id)
  })
  ipcMain.handle(IPC.accountsAddDemo, () => manager.addDemo())
  ipcMain.handle(IPC.accountsConnectWeb, async (_e, platform: 'messenger' | 'instagram') => manager.addWebSession(platform, await captureWebSession(platform)))
  ipcMain.handle(IPC.accountsListPages, (_e, appId: string) => listPages(appId))
  ipcMain.handle(IPC.accountsAddPages, (_e, pages: PageOption[], includeInstagram: boolean) => manager.addPages(pages, includeInstagram))
  ipcMain.handle(IPC.contactsList, (_e, query: string) => manager.contacts(query))
  ipcMain.handle(IPC.contactsOpen, (_e, accountId: string, peerId: string) => manager.openConversation(accountId, peerId))
  ipcMain.handle(IPC.conversationsList, () => manager.listConversations())
  ipcMain.handle(IPC.conversationsMarkRead, (_e, id: string) => manager.markRead(id))
  ipcMain.handle(IPC.conversationsProfile, (_e, id: string) => manager.profile(id))
  ipcMain.handle(IPC.conversationsShared, (_e, id: string, kind: SharedKind) => manager.shared(id, kind))
  ipcMain.handle(IPC.conversationsSearchIn, (_e, id: string, query: string) => manager.searchIn(id, query))
  ipcMain.handle(IPC.conversationsStats, (_e, id: string) => manager.stats(id))
  ipcMain.handle(IPC.messagesOpenAttachment, (_e, id: string, messageId: string, attachmentId: string) => openAttachment(id, messageId, attachmentId))
  ipcMain.handle(IPC.messagesList, (_e, id: string, beforeId?: string) => manager.fetchMessages(id, beforeId))
  ipcMain.handle(IPC.messagesSend, (_e, id: string, text: string, options?: SendOptions) => manager.sendMessage(id, text, options))
  ipcMain.handle(IPC.messagesForward, (_e, fromId: string, messageId: string, toId: string) => manager.forward(fromId, messageId, toId))
  ipcMain.handle(IPC.messagesLoadAttachment, (_e, id: string, messageId: string, attachmentId: string) => manager.loadAttachment(id, messageId, attachmentId))
  ipcMain.handle(IPC.messagesReact, (_e, id: string, messageId: string, emoji: string) => manager.react(id, messageId, emoji))
  ipcMain.handle(IPC.messagesSearch, (_e, query: string) => manager.search(query))
  ipcMain.handle(IPC.messagesTyping, (_e, id: string) => manager.setTyping(id))
  ipcMain.handle(IPC.authRespond, (_e, requestId: string, value: string) => manager.respondAuth(requestId, value))
  ipcMain.handle(IPC.authCancel, (_e, requestId: string) => manager.cancelAuth(requestId))
  ipcMain.handle(IPC.settingsGet, () => storage.settings)
  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    const settings = await storage.setSettings(patch)
    if (patch.theme) applyTheme(settings.theme)
    return settings
  })
  ipcMain.handle(IPC.appOpenExternal, (_e, url: string) => shell.openExternal(url))
  ipcMain.handle(IPC.appPickFiles, () => pickFiles())
  ipcMain.handle(IPC.appSaveVoice, (_e, bytes: Uint8Array, duration: number) => saveVoice(bytes, duration))
  ipcMain.handle(IPC.appWeather, (_e, force?: boolean) => getWeather(!!force))
  ipcMain.on(IPC.appWindowAction, (_e, action: 'minimize' | 'maximize' | 'close') => {
    if (!window) return
    if (action === 'minimize') window.minimize()
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
    else window.close()
  })
}

// Chromium stops painting occluded windows on Windows, which breaks screenshot-based
// UI checks during development. Keep the default behaviour in packaged builds.
if (process.env.ELECTRON_RENDERER_URL && isWindows) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.whenReady().then(async () => {
    if (isWindows) app.setAppUserModelId('com.3hvn.unison')
    await storage.load()
    nativeTheme.themeSource = storage.settings.theme
    nativeTheme.on('updated', () => applyTheme(storage.settings.theme))
    hardenSession()
    registerIpc()
    createWindow()
    await manager.restore()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  app.on('before-quit', () => {
    void manager.shutdown()
  })
}
