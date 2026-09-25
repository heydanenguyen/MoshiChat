import { app, BrowserWindow, dialog, ipcMain, Notification, nativeImage, nativeTheme, session, shell } from 'electron'
import { join, basename } from 'path'
import { readFile, stat, writeFile } from 'fs/promises'
import type { AddAccountInput, BridgeEvent, OutgoingAttachment, SendOptions, Settings } from '@shared/types'
import { IPC } from '@shared/bridge'
import { Storage } from './storage'
import { AccountManager } from './adapters/manager'
import { mimeOf } from './adapters/types'
import { webmToOgg } from './media/webm-to-ogg'

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

function overlayColors(): { color: string; symbolColor: string } {
  const dark = nativeTheme.shouldUseDarkColors
  return { color: dark ? '#1c1c1e' : '#f2f2f7', symbolColor: dark ? '#e5e5ea' : '#1c1c1e' }
}

function applyTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme
  if (isWindows && window && !window.isDestroyed()) {
    window.setTitleBarOverlay({ ...overlayColors(), height: 52 })
  }
}

function appIcon(): Electron.NativeImage | undefined {
  const image = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  return image.isEmpty() ? undefined : image
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Unison',
    icon: appIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isWindows ? { ...overlayColors(), height: 52 } : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundMaterial: isWindows ? 'mica' : undefined,
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

function registerIpc(): void {
  ipcMain.handle(IPC.accountsList, () => manager.listAccounts())
  ipcMain.handle(IPC.accountsAdd, (_e, input: AddAccountInput) => manager.add(input))
  ipcMain.handle(IPC.accountsRemove, (_e, id: string) => manager.remove(id))
  ipcMain.handle(IPC.accountsReconnect, (_e, id: string) => manager.reconnect(id))
  ipcMain.handle(IPC.accountsAddDemo, () => manager.addDemo())
  ipcMain.handle(IPC.conversationsList, () => manager.listConversations())
  ipcMain.handle(IPC.conversationsMarkRead, (_e, id: string) => manager.markRead(id))
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
