import { app, BrowserWindow, dialog, ipcMain, Notification, nativeImage, nativeTheme, protocol, session, shell } from 'electron'
import { join, basename } from 'path'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import type { AddAccountInput, BridgeEvent, GifItem, OutgoingAttachment, PageOption, SendOptions, Settings, SharedKind } from '@shared/types'
import type { WebCookie } from './adapters/facebook-personal'
import { browserUserAgent } from './user-agent'
import { isStickerId } from '@shared/stickers'
import { IPC } from '@shared/bridge'
import { clampZoom, isMutedBy } from '@shared/types'
import { Storage } from './storage'
import { AccountManager } from './adapters/manager'
import { mimeOf } from './adapters/types'
import { webmToOgg } from './media/webm-to-ogg'
import { getWeather } from './weather'
import { gifFile, searchGifs } from './gifs'
import { Scheduler } from './scheduler'
import { AiService, readMedia } from './ai/service'
import type { AiKind } from '@shared/ai'
import { createBackup, inspectBackup, pruneSafetyCopies, restoreBackup } from './backup'
import { BACKUP_EXTENSION } from './backup-format'

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

const ai = new AiService(
  () => storage.settings.voiceModel ?? 'turbo',
  () => storage.settings.language,
  (progress) => emit({ type: 'ai:progress', progress }),
  log
)

const scheduler = new Scheduler(
  storage,
  manager,
  emit,
  (item) => {
    if (!Notification.isSupported()) return
    const vi = storage.settings.language === 'vi'
    const n = new Notification({
      title: vi ? 'Tin hẹn giờ chưa gửi được' : "A scheduled message wasn't sent",
      body: item.text.slice(0, 120),
      silent: false
    })
    n.on('click', () => {
      window?.show()
      window?.webContents.send(IPC.event, { type: 'focus-conversation', conversationId: item.conversationId })
    })
    n.show()
  },
  log
)

function notify(event: Extract<BridgeEvent, { type: 'message:new' }>): void {
  if (!storage.settings.notifications || !Notification.isSupported()) return
  if (window?.isFocused()) return
  // Ignore history that is older than a minute (initial syncs replay old messages).
  if (Date.now() - event.message.sentAt > 60_000) return
  const conversation = manager.listConversations().find((c) => c.id === event.message.conversationId)
  if (conversation?.muted) return
  if (conversation && isMutedBy(storage.settings, conversation)) return
  const nickname = storage.settings.contactOverrides?.[event.message.conversationId]?.nickname?.trim()
  const title = conversation?.isGroup ? `${event.message.senderName} in ${nickname || conversation.title}` : nickname || event.message.senderName
  const notification = new Notification({
    title,
    body: event.message.text || 'Sent an attachment',
    // Unison plays its own sound for new messages (renderer/src/sounds.ts) unless it is turned off.
    silent: storage.settings.sound !== 'off'
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

/** The legal documents shipped next to the app (Vietnamese first, English below). */
const LEGAL_DOCS = { notice: 'NOTICE.md', license: 'LICENSE', terms: 'TERMS.md', privacy: 'PRIVACY.md', credits: 'CREDITS.md' } as const

/** A sticker as an outgoing image: transparent PNG, plus a copy on white for platforms that flatten transparency. */
async function stickerFile(id: string): Promise<OutgoingAttachment> {
  if (!isStickerId(id)) throw new Error('Unknown sticker')
  const dir = app.isPackaged ? join(process.resourcesPath, 'stickers') : join(__dirname, '../../resources/stickers')
  const path = join(dir, `${id}.png`)
  const opaque = join(dir, `${id}-white.png`)
  const [data, opaqueInfo] = await Promise.all([readFile(path), stat(opaque).catch(() => undefined)])
  return {
    path,
    name: `${id}.png`,
    mime: 'image/png',
    size: data.length,
    sticker: id,
    preview: `data:image/png;base64,${data.toString('base64')}`,
    alternates: opaqueInfo ? [{ path: opaque, mime: 'image/png', size: opaqueInfo.size, role: 'opaque' }] : undefined
  }
}

/**
 * Drop per-chat settings (tags, pins, nicknames, saved messages, mutes) that belong to accounts
 * which no longer exist, so counts and lists never include chats that are gone.
 */
async function pruneOrphanedSettings(): Promise<void> {
  const accounts = new Set(storage.accounts.map((a) => a.id))
  const owned = (conversationId: string): boolean => {
    const slash = conversationId.indexOf('/')
    return slash > 0 && accounts.has(conversationId.slice(0, slash))
  }
  const settings = storage.settings
  const keep = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined =>
    record ? Object.fromEntries(Object.entries(record).filter(([id]) => owned(id))) : record
  const patch: Partial<Settings> = {}
  const tags = keep(settings.tags) ?? {}
  if (Object.keys(tags).length !== Object.keys(settings.tags ?? {}).length) patch.tags = tags
  const pins = keep(settings.pins)
  if (pins && Object.keys(pins).length !== Object.keys(settings.pins ?? {}).length) patch.pins = pins
  const overrides = keep(settings.contactOverrides)
  if (overrides && Object.keys(overrides).length !== Object.keys(settings.contactOverrides ?? {}).length) patch.contactOverrides = overrides
  const saved = settings.savedMessages?.filter((m) => owned(m.conversationId))
  if (saved && saved.length !== settings.savedMessages?.length) patch.savedMessages = saved
  const mutedChats = settings.muted?.conversations.filter(owned)
  const mutedAccounts = settings.muted?.accounts.filter((id) => accounts.has(id))
  if (settings.muted && (mutedChats?.length !== settings.muted.conversations.length || mutedAccounts?.length !== settings.muted.accounts.length)) {
    patch.muted = { ...settings.muted, conversations: mutedChats ?? [], accounts: mutedAccounts ?? [] }
  }
  if (Object.keys(patch).length) {
    await storage.setSettings(patch)
    log('pruned settings of removed accounts:', Object.keys(patch).join(', '))
  }
}

/** Window/taskbar icon for the chosen logo (rendered by scripts/make-icons.mjs into resources/icons). */
function appIcon(logo: Settings['logo'] = storage.settings.logo): Electron.NativeImage | undefined {
  const name = `${logo ?? 'buddies'}.png`
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icons', name)]
    : [join(__dirname, '../../resources/icons', name), join(__dirname, '../../resources/icon.png')]
  for (const path of candidates) {
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  return undefined
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
      webSecurity: true,
      // Message sounds must play while the window is in the background.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  // Interface zoom from Settings (large/4K screens); re-applied after every load.
  window.webContents.on('did-finish-load', () => window?.webContents.setZoomFactor(clampZoom(storage.settings.zoom)))
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

/**
 * unison-img://img/?u=<https url> re-fetches a profile picture through the platform's own session.
 * Some Instagram/Facebook CDN links only load inside the signed-in site. Only image CDNs are allowed.
 */
protocol.registerSchemesAsPrivileged([{ scheme: 'unison-img', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

const IMAGE_HOSTS = /(^|\.)(fbcdn\.net|cdninstagram\.com|instagram\.com|facebook\.com|fbsbx\.com|zdn\.vn|zadn\.vn|zaloapp\.com|telegram\.org|t\.me|whatsapp\.net)$/i

function registerImageProxy(): void {
  protocol.handle('unison-img', async (request) => {
    try {
      const target = new URL(new URL(request.url).searchParams.get('u') ?? '')
      if (target.protocol !== 'https:' || !IMAGE_HOSTS.test(target.hostname)) return new Response('blocked', { status: 403 })
      const instagram = /instagram|cdninstagram/.test(target.hostname) || target.searchParams.has('_nc_cat')
      const ses = /fbcdn|cdninstagram|instagram/.test(target.hostname)
        ? session.fromPartition(instagram ? 'persist:login-instagram' : 'persist:login-messenger')
        : /facebook|fbsbx/.test(target.hostname)
          ? session.fromPartition('persist:login-messenger')
          : session.defaultSession
      const res = await ses.fetch(target.toString(), { headers: { Referer: instagram ? 'https://www.instagram.com/' : 'https://www.facebook.com/' } })
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !type.startsWith('image/')) return new Response('unavailable', { status: 404 })
      return new Response(res.body, { status: 200, headers: { 'content-type': type, 'cache-control': 'max-age=86400' } })
    } catch {
      return new Response('error', { status: 502 })
    }
  })
}

function hardenSession(): void {
  // In development Vite injects inline scripts (React Fast Refresh), so the policy is only applied to packaged builds.
  if (process.env.ELECTRON_RENDERER_URL) return
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: file: unison-img:",
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
async function saveVoice(bytes: Uint8Array, durationSeconds: number, aac?: Uint8Array): Promise<OutgoingAttachment> {
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
  const alternates: OutgoingAttachment['alternates'] = []
  if (aac?.length) {
    const aacPath = join(app.getPath('temp'), `unison-voice-${stamp}.m4a`)
    await writeFile(aacPath, aac)
    alternates.push({ path: aacPath, mime: 'audio/mp4', size: aac.length })
  }
  return {
    path,
    name: `voice-${stamp}.${ext}`,
    mime,
    size: data.length,
    voice: true,
    duration: Math.round(durationSeconds),
    alternates: alternates.length ? alternates : undefined,
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
  messenger: { url: 'https://www.facebook.com/', domain: '.facebook.com', required: ['c_user', 'xs'] },
  instagram: { url: 'https://www.instagram.com/accounts/login/', domain: '.instagram.com', required: ['sessionid', 'ds_user_id'] }
}

/**
 * Let the user sign in on the platform's real login page inside a dedicated
 * app window, then hand the session cookies to the adapter. Passwords are
 * typed into the platform's page only; Unison never sees them.
 */
const openLogins = new Map<string, BrowserWindow>()

/**
 * Open the platform's own sign-in page in an app window and return its cookies once the
 * user is signed in. `dead` are cookies known to be rejected: only those exact values are
 * dropped first, so a newer session already in the window (for example one the user just
 * completed) is reused instead of forcing another sign-in.
 */
async function captureWebSession(platform: 'messenger' | 'instagram', dead: WebCookie[] = []): Promise<WebCookie[]> {
  const existing = openLogins.get(platform)
  if (existing && !existing.isDestroyed()) {
    // Already waiting on this platform (for example a two-factor step): bring it back instead of opening another.
    existing.show()
    existing.focus()
    throw new Error('Finish signing in in the Instagram/Facebook window that is already open')
  }
  const spec = WEB_LOGIN[platform]
  const ses = session.fromPartition(`persist:login-${platform}`)
  // Facebook sessions are shared with ws3-fca, which now uses this exact browser identity.
  if (platform === 'messenger') ses.setUserAgent(browserUserAgent())
  // If the window still holds exactly the rejected session, drop its login cookies so the sign-in page shows.
  // A newer session (new token, same user id) is kept and reused. Device ids (datr, mid, ig_did) always stay.
  const current = await ses.cookies.get({ domain: spec.domain.replace(/^\./, '') })
  const isDead = (c: Electron.Cookie): boolean => dead.some((d) => d.name === c.name && d.value === c.value)
  const loginCookies = current.filter((c) => spec.required.includes(c.name))
  if (dead.length && loginCookies.length && spec.required.every((n) => loginCookies.some((c) => c.name === n && isDead(c)))) {
    for (const c of loginCookies) {
      await ses.cookies.remove(`https://${(c.domain ?? spec.domain).replace(/^\./, '')}${c.path ?? '/'}`, c.name).catch(() => undefined)
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
    openLogins.set(platform, loginWindow)
    loginWindow.on('closed', () => openLogins.delete(platform))
    loginWindow.once('ready-to-show', () => loginWindow.focus())
    // Two-factor and checkpoint pages must not end up hidden behind the main window.
    loginWindow.webContents.on('did-navigate', () => {
      if (!loginWindow.isDestroyed()) {
        loginWindow.show()
        loginWindow.focus()
      }
    })
    let settled = false
    const finish = (err?: Error, cookies?: WebCookie[]): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      if (!loginWindow.isDestroyed()) loginWindow.close()
      err ? reject(err) : resolve(cookies ?? [])
    }
    let loaded = false
    let lastState = ''
    loginWindow.webContents.on('did-finish-load', () => (loaded = true))
    const check = async (): Promise<void> => {
      try {
        // Only trust cookies once the site itself has rendered a signed-in page (stale cookies still exist).
        if (!loaded || loginWindow.isDestroyed()) return
        // Judge the page by its path only: query strings often carry words like "login" (?next=, ?lsrc=).
        const path = new URL(loginWindow.webContents.getURL()).pathname
        const cookies = await ses.cookies.get({ domain: spec.domain.replace(/^\./, '') })
        const names = new Set(cookies.map((c) => c.name))
        const deadValues = new Set(dead.map((c) => c.name + '=' + c.value))
        // All login cookies present, and not the exact rejected set. The user-id cookie (c_user, ds_user_id)
        // is the same in every session, so only the session token has to be new.
        const present = spec.required.every((n) => names.has(n))
        const stale = dead.length > 0 && spec.required.every((n) => cookies.some((c) => c.name === n && deadValues.has(n + '=' + c.value)))
        const signedIn = present && !stale
        const state = `${path} [${spec.required.filter((n) => names.has(n))}] signedIn=${signedIn}`
        if (!app.isPackaged && state !== lastState) log(`login window (${platform}): ${state}`)
        lastState = state
        if (SIGN_IN_PATH.test(path)) return
        if (signedIn) {
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

/** Pages that are part of signing in (never a finished session), matched against the path only. */
const SIGN_IN_PATH = /^\/(login|login\.php|checkpoint|two_step_verification|two_factor|recover|challenge|accounts\/login|auth_platform|confirmemail)/i

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
  ipcMain.handle(IPC.accountsRemove, async (_e, id: string) => {
    await manager.remove(id)
    await pruneOrphanedSettings()
  })
  ipcMain.handle(IPC.accountsReconnect, async (_e, id: string) => {
    const web = id.startsWith('instagram:ig-') ? 'instagram' : id.startsWith('messenger:fb-') ? 'messenger' : undefined
    const account = manager.listAccounts().find((a) => a.id === id)
    if (web && account && account.status !== 'connected') {
      await manager.reauthWebSession(id, await captureWebSession(web, manager.storedCookies(id)))
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
    if ('zoom' in patch && window && !window.isDestroyed()) window.webContents.setZoomFactor(clampZoom(settings.zoom))
    if (patch.logo) {
      const icon = appIcon(settings.logo)
      if (icon && window && !window.isDestroyed()) window.setIcon(icon)
    }
    return settings
  })
  ipcMain.handle(IPC.aiStatus, () => ai.status())
  ipcMain.handle(IPC.aiPrepare, (_e, kind: AiKind) => ai.prepare(kind === 'translate' ? 'translate' : 'voice'))
  ipcMain.handle(IPC.aiRemove, (_e, kind: AiKind) => ai.remove(kind === 'translate' ? 'translate' : 'voice'))
  ipcMain.handle(IPC.aiReadMedia, (_e, url: string) => readMedia(String(url)))
  ipcMain.handle(IPC.aiTranscribe, (_e, key: string, pcm: Float32Array, language?: string) =>
    ai.transcribe(String(key), pcm, typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : undefined)
  )
  ipcMain.handle(IPC.aiTranslate, (_e, key: string, text: string) => ai.translate(String(key), String(text ?? '').slice(0, 5000)))
  ipcMain.handle(IPC.aiCached, () => ai.cached())
  ipcMain.handle(IPC.backupCreate, async (_e, input: { password: string; includeSessions: boolean }) => {
    const day = new Date().toISOString().slice(0, 10)
    const vi = storage.settings.language === 'vi'
    // Development only: UNISON_BACKUP_SAVE_PATH skips the dialog (automated tests).
    const testPath = !app.isPackaged ? process.env.UNISON_BACKUP_SAVE_PATH : undefined
    const picked = testPath ? { canceled: false, filePath: testPath } : await dialog.showSaveDialog(window!, {
      title: vi ? 'Lưu bản sao lưu Unison' : 'Save Unison backup',
      defaultPath: join(app.getPath('documents'), `Unison-backup-${day}.${BACKUP_EXTENSION}`),
      filters: [{ name: 'Unison backup', extensions: [BACKUP_EXTENSION] }]
    })
    if (picked.canceled || !picked.filePath) return null
    const result = await createBackup(storage, picked.filePath, String(input.password ?? ''), !!input.includeSessions)
    log('backup written:', result.bytes, 'bytes')
    return result
  })
  ipcMain.handle(IPC.backupPick, async () => {
    const vi = storage.settings.language === 'vi'
    const testPick = !app.isPackaged ? process.env.UNISON_BACKUP_OPEN_PATH : undefined
    const picked = testPick ? { canceled: false, filePaths: [testPick] } : await dialog.showOpenDialog(window!, {
      title: vi ? 'Chọn bản sao lưu Unison' : 'Choose a Unison backup',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Unison backup', extensions: [BACKUP_EXTENSION] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    return inspectBackup(picked.filePaths[0])
  })
  ipcMain.handle(IPC.backupRestore, async (_e, input: { path: string; password: string }) => {
    const { safetyCopy } = await restoreBackup(storage, String(input.path), String(input.password ?? ''), async () => {
      scheduler.stop()
      await manager.shutdown()
    })
    log('backup restored; previous data kept in', safetyCopy)
    // Start fresh with the restored data (in development, restart the dev server by hand).
    setTimeout(() => {
      if (!process.env.ELECTRON_RENDERER_URL) app.relaunch()
      app.exit(0)
    }, 600)
  })
  ipcMain.handle(IPC.backupReveal, (_e, path: string) => {
    if (typeof path === 'string' && path.toLowerCase().endsWith(`.${BACKUP_EXTENSION}`)) shell.showItemInFolder(path)
  })
  ipcMain.handle(IPC.scheduledAdd, (_e, input: { conversationId: string; text: string; sendAt: number; replyToId?: string }) => scheduler.add(input))
  ipcMain.handle(IPC.scheduledCancel, (_e, id: string) => scheduler.cancel(id))
  ipcMain.handle(IPC.scheduledSendNow, (_e, id: string) => scheduler.sendNow(id))
  ipcMain.handle(IPC.scheduledReschedule, (_e, id: string, sendAt: number) => scheduler.reschedule(id, sendAt))
  ipcMain.handle(IPC.appOpenExternal, (_e, url: string) => shell.openExternal(url))
  ipcMain.handle(IPC.appPickFiles, () => pickFiles())
  ipcMain.handle(IPC.appSticker, (_e, id: string) => stickerFile(id))
  ipcMain.handle(IPC.appLegal, (_e, name: string) => {
    const file = LEGAL_DOCS[name as keyof typeof LEGAL_DOCS]
    if (!file) throw new Error('Unknown document')
    const dir = app.isPackaged ? join(process.resourcesPath, 'legal') : join(__dirname, '../../resources/legal')
    // The GPL text lives at the repository root; the build copies it next to the other documents.
    const path = name === 'license' && !app.isPackaged ? join(__dirname, '../../LICENSE') : join(dir, file)
    return readFile(path, 'utf8')
  })
  ipcMain.handle(IPC.appGifSearch, (_e, query: string, page: number) => {
    const { gif, language } = storage.settings
    return searchGifs(gif?.provider ?? 'klipy', gif?.key ?? '', String(query ?? '').slice(0, 100), Math.max(1, Math.min(50, Number(page) || 1)), language)
  })
  ipcMain.handle(IPC.appGif, (_e, item: GifItem) => gifFile(item))
  ipcMain.handle(IPC.appSaveVoice, (_e, bytes: Uint8Array, duration: number, aac?: Uint8Array) => saveVoice(bytes, duration, aac))
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
    await pruneOrphanedSettings()
    void scheduler.start()
    void pruneSafetyCopies()
    nativeTheme.themeSource = storage.settings.theme
    nativeTheme.on('updated', () => applyTheme(storage.settings.theme))
    hardenSession()
    registerImageProxy()
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
    scheduler.stop()
    ai.stop()
    void manager.shutdown()
  })
}
