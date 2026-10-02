import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, Notification, nativeImage, nativeTheme, protocol, session, shell } from 'electron'
import { join, basename, resolve } from 'path'
import { pathToFileURL } from 'url'
import { appendFile, mkdir, readFile, stat, writeFile } from 'fs/promises'
import { migrateLegacyProfile } from './profile-migration'
import type { AddAccountInput, AppCommand, BridgeEvent, Conversation, GifItem, MessagePreview, OutgoingAttachment, PageOption, SendOptions, Settings, SharedKind } from '@shared/types'
import type { WebCookie } from './adapters/facebook-personal'
import { browserUserAgent } from './user-agent'
import { isStickerId } from '@shared/stickers'
import { MITO_GIPHY, isMitoId, mitoSticker } from '@shared/mito'
import { IPC } from '@shared/bridge'
import { clampZoom, isMutedBy } from '@shared/types'
import { accountNames, isForMe, isPendingRequest, looksLikeCode } from '@shared/inbox'
import { memberIndex } from '@shared/people'
import { Storage, secretsProtected } from './storage'
import { AccountManager } from './adapters/manager'
import { mimeOf } from './adapters/types'
import { webmToOgg } from './media/webm-to-ogg'
import { getWeather } from './weather'
import { gifFile, giphyStickerFile, searchGifs, searchStickers } from './gifs'
import { isGiphyStickerId } from '@shared/giphy'
import { Scheduler } from './scheduler'
import { Reminders } from './reminders'
import { Later, type LaterDue } from './later'
import { Birthdays, type BirthdayDue } from './birthdays'
import { AppLock } from './lock'
import { previewOf, prunePreviews } from './media/preview'
import { pruneTemp } from './temp-cleanup'
import { imageTypeOf } from './media/image-type'
import { cutoutMemoryOk, nativeCutout, nativeCutoutAvailable, NativeCutoutError } from './media/mac-cutout'
import { freshPartition, legacyPartition, newPartition, partitionFor, sessionUser, USER_COOKIE, wipePartition, type WebPlatform } from './web-partitions'
import { givenName } from '@shared/extras'
import { addSticker, customStickerFile, describeSource, listStickers, pickStickerSource, removeSticker, renameSticker, sourceFromBytes, stickerSource, customStickerPath } from './stickers'
import { AiService, readMedia } from './ai/service'
import type { AiKind, SpeakLang } from '@shared/ai'
import type { ShareCardData } from '@shared/insights'
import type { ChatLine } from '@shared/ai-prompts'
import { createBackup, inspectBackup, pruneSafetyCopies, restoreBackup } from './backup'
import { Updater } from './updater'
import { SyncService } from './sync'
import { BACKUP_EXTENSION, LEGACY_BACKUP_EXTENSION } from './backup-format'

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

/** GIF library key shipped with this build (empty in a plain local build). */
const BUILT_IN_GIF = { key: typeof __MOSHI_GIF_KEY__ === 'string' ? __MOSHI_GIF_KEY__ : '', provider: typeof __MOSHI_GIF_PROVIDER__ === 'string' ? __MOSHI_GIF_PROVIDER__ : 'klipy' } as const

let window: BrowserWindow | undefined
/** Set once the app is really quitting, so closing the window on macOS stops hiding it. */
let quitting = false
/** The photo editor is open: its ⌘-shortcuts must reach it instead of the Edit/File menu. */
let editorKeys = false
const EDITOR_KEYS = new Set(['z', 'y', 'c', 's', 'w', 'enter'])

/** Bring the main window back (Dock icon, second launch), creating it again if it was closed. */
function showMain(): void {
  if (!window || window.isDestroyed()) {
    createWindow()
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
// Development only: keep a dev run's data (and its single-instance lock) apart from the installed app.
// On macOS the default folders "moshi" and "Moshi" are the same directory, so this matters there.
if (!app.isPackaged && process.env.MOSHI_USER_DATA) app.setPath('userData', process.env.MOSHI_USER_DATA)
// The app used to be called Unison: carry an existing profile over once, before anything in it is opened.
try {
  if (migrateLegacyProfile(app.getPath('appData'), app.getPath('userData')) === 'moved') console.log('[moshi] moved the Unison profile to', app.getPath('userData'))
} catch (err) {
  console.log('[moshi] could not move the Unison profile:', (err as Error).message)
}

const storage = new Storage()

/** Every log line also goes to <userData>/moshi.log (trimmed at 2 MB), so problems can be reported after the fact. */
const LOG_FILE = join(app.getPath('userData'), 'moshi.log')
let logQueue: Promise<void> = Promise.resolve()
function logToFile(line: string): void {
  logQueue = logQueue
    .then(async () => {
      const info = await stat(LOG_FILE).catch(() => undefined)
      if (info && info.size > 2 * 1024 * 1024) {
        const tail = (await readFile(LOG_FILE, 'utf8')).slice(-512 * 1024)
        await writeFile(LOG_FILE, tail)
      }
      await appendFile(LOG_FILE, line)
    })
    .catch(() => undefined)
}
const log = (...args: unknown[]): void => {
  console.log('[moshi]', ...args)
  const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(' ')
  logToFile(`${new Date().toISOString()} ${text}\n`)
}

// A library throwing from a callback (the messaging clients do, now and then) is logged, not left to crash the app.
process.on('unhandledRejection', (reason) => log('unhandled rejection:', reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)))
process.on('uncaughtException', (err) => log('uncaught exception:', err.stack ?? err.message))

const emit = (event: BridgeEvent): void => {
  if (window && !window.isDestroyed()) window.webContents.send(IPC.event, event)
  if (event.type === 'message:new') {
    // Snoozes and follow-ups are kept under the chat the list shows (a merged person's first chat).
    later?.onMessage(shownPerson(event.message.conversationId)?.anchor ?? event.message.conversationId, event.message)
    if (!event.message.isOutgoing) void notify(event)
  }
}

const manager = new AccountManager(storage, emit, log)

const appLock = new AppLock(storage, emit, log)

const ai = new AiService(
  () => storage.settings.voiceModel ?? 'turbo',
  () => storage.settings.chatModel ?? 'small',
  () => storage.settings.language,
  () => storage.settings.suggestLanguage ?? 'auto',
  (progress) => emit({ type: 'ai:progress', progress }),
  log
)

const sync = new SyncService(storage, emit, log)

const updater = new Updater(
  (state) => emit({ type: 'update:state', state }),
  log,
  () => storage.settings.autoUpdate !== false
)

const reminders = new Reminders(
  storage,
  emit,
  (todo) => {
    if (todo.conversationId) focusChat(todo.conversationId, todo.messageId)
    else {
      window?.show()
      window?.focus()
    }
  },
  log
)
// Declared before anything can emit (emit reads it); created once the helpers it needs exist (see below).
let later: Later | undefined

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
    n.on('click', () => focusChat(item.conversationId))
    n.show()
  },
  log
)

/**
 * The chat a new message belongs to. The first message from a stranger arrives before its adapter has looked the
 * chat up, so wait a moment for it: whether it is a message request decides whether it may notify at all.
 */
async function conversationOf(conversationId: string): Promise<Conversation | undefined> {
  for (let tries = 0; tries < 8; tries++) {
    const conversation = manager.listConversations().find((c) => c.id === conversationId)
    if (conversation) return conversation
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return undefined
}

/** The person a chat is merged into, when two or more of its chats are around: its anchor and name. */
function shownPerson(conversationId: string): { anchor: string; name?: string; request?: boolean } | undefined {
  const people = storage.settings.people
  const personId = peopleIndex().get(conversationId)
  const person = personId ? people?.[personId] : undefined
  if (!person) return undefined
  const known = new Map(manager.listConversations().map((c) => [c.id, c]))
  const members = person.members.filter((id) => known.has(id))
  if (members.length < 2) return undefined
  return { anchor: members[0], name: person.name?.trim() || undefined, request: members.every((id) => known.get(id)?.request) || undefined }
}

/** macOS lets you answer a notification in place; elsewhere a click opens the chat. */
const canReplyInline = process.platform === 'darwin'

/**
 * Notifications that can still be answered. macOS delivers a reply or a button press only to a notification
 * object that is still alive, so the newest few are kept (and dropped once dismissed).
 */
const liveNotifications = new Set<Notification>()
function keepAlive(n: Notification): void {
  liveNotifications.add(n)
  if (liveNotifications.size > 40) liveNotifications.delete(liveNotifications.values().next().value as Notification)
  n.on('close', () => liveNotifications.delete(n))
}

/** Bring Moshi to the front on a chat (and a message in it). */
function focusChat(conversationId: string, messageId?: string): void {
  window?.show()
  window?.focus()
  window?.webContents.send(IPC.event, { type: 'focus-conversation', conversationId, ...(messageId ? { messageId } : {}) })
}

/**
 * Chat id to person id, rebuilt only when the people change (settings.people is replaced on every edit). Every
 * message event asks it, including the thousands an account's first sync replays.
 */
let peopleIndexCache: { people?: Settings['people']; index: Map<string, string> } = { index: new Map() }
function peopleIndex(): Map<string, string> {
  const people = storage.settings.people
  if (peopleIndexCache.people !== people) peopleIndexCache = { people, index: memberIndex(people) }
  return peopleIndexCache.index
}

/** Send what was typed into a notification, as if from the composer; a failure gets its own notification. */
async function replyFromNotification(conversationId: string, text: string): Promise<void> {
  const body = text.trim()
  if (!body) return
  try {
    const message = await manager.sendMessage(conversationId, body)
    emit({ type: 'message:new', message })
    // Answering is reading (the read-receipt setting still decides whether the platform hears of it).
    void manager.markRead(conversationId).catch(() => undefined)
  } catch (err) {
    const vi = storage.settings.language === 'vi'
    const n = new Notification({
      title: vi ? 'Chưa gửi được tin trả lời' : "Your reply wasn't sent",
      body: `${body.slice(0, 80)} · ${(err as Error).message ?? ''}`.slice(0, 160),
      silent: false
    })
    n.on('click', () => focusChat(conversationId))
    keepAlive(n)
    n.show()
    log('[notify] reply failed', (err as Error).message)
  }
}

/** The newest message of each chat behind a shown chat id: a merged person's chats, or just the one. */
function latestOf(conversationId: string): Array<{ conversationId: string; message: MessagePreview }> {
  const people = storage.settings.people
  const personId = peopleIndex().get(conversationId)
  const ids = (personId && people?.[personId]?.members) || [conversationId]
  const known = new Map(manager.listConversations().map((c) => [c.id, c]))
  return ids.flatMap((id) => {
    const message = known.get(id)?.lastMessage
    return message ? [{ conversationId: id, message }] : []
  })
}

/** While Moshi is locked a notification says only that something came, never who or what (and cannot be answered). */
function lockedNotification(): void {
  const vi = storage.settings.language === 'vi'
  const n = new Notification({ title: 'Moshi', body: vi ? 'Có tin mới. Mở Moshi để xem.' : 'Something new. Open Moshi to see it.', silent: storage.settings.sound !== 'off' })
  n.on('click', () => {
    window?.show()
    window?.focus()
  })
  keepAlive(n)
  n.show()
}

/** Snoozes back and follow-ups unanswered: one notification each (three at most), answerable in place on macOS. */
function notifyLater(due: LaterDue[]): void {
  if (!storage.settings.notifications || !Notification.isSupported()) return
  if (appLock.isLocked()) return lockedNotification()
  const vi = storage.settings.language === 'vi'
  const known = new Map(manager.listConversations().map((c) => [c.id, c]))
  const shown = due.slice(0, 3)
  for (const item of shown) {
    const chat = known.get(item.conversationId)
    const name =
      shownPerson(item.conversationId)?.name || storage.settings.contactOverrides?.[item.conversationId]?.nickname?.trim() || chat?.title || (vi ? 'Một cuộc trò chuyện' : 'A conversation')
    const newest = latestOf(item.conversationId).sort((a, b) => b.message.sentAt - a.message.sentAt)[0]
    const preview = newest ? `${newest.message.isOutgoing ? (vi ? 'Bạn: ' : 'You: ') : ''}${newest.message.text || (vi ? 'Tệp đính kèm' : 'An attachment')}` : ''
    const more = due.length > shown.length && item === shown[shown.length - 1] ? `  (+${due.length - shown.length})` : ''
    const snooze = item.kind === 'snooze'
    const n = new Notification({
      title: snooze ? (vi ? `Đến giờ xem lại: ${name}` : `Back from snooze: ${name}`) : vi ? `${name} chưa trả lời` : `${name} hasn't replied`,
      body: `${preview.slice(0, 140)}${more}`,
      silent: false,
      ...(canReplyInline ? { hasReply: true, replyPlaceholder: snooze ? (vi ? 'Trả lời…' : 'Reply…') : vi ? 'Nhắn tiếp…' : 'Follow up…' } : {})
    })
    n.on('click', () => focusChat(item.conversationId))
    n.on('reply', (_e, reply: string) => {
      void replyFromNotification(newest?.conversationId ?? item.conversationId, reply)
      void later?.seen(item.conversationId)
    })
    keepAlive(n)
    n.show()
  }
}

async function notify(event: Extract<BridgeEvent, { type: 'message:new' }>): Promise<void> {
  if (!storage.settings.notifications || !Notification.isSupported()) return
  if (window?.isFocused()) return
  // Ignore history that is older than a minute (initial syncs replay old messages).
  if (Date.now() - event.message.sentAt > 60_000) return
  const found = await conversationOf(event.message.conversationId)
  // A merged person is muted, named and so on as a whole, under its first chat's id; a request only as a whole.
  const person = shownPerson(event.message.conversationId)
  const conversation = found && person ? { ...found, id: person.anchor, request: person.request } : found
  if (conversation?.muted) return
  if (conversation && isMutedBy(storage.settings, conversation)) return
  // Message requests wait silently, except a one-time code (a login or payment can hang on it).
  if (conversation && isPendingRequest(conversation, storage.settings.acceptedRequests) && !looksLikeCode(event.message.text)) return
  if (conversation && storage.settings.mentionsOnly?.[conversation.id]) {
    const account = storage.accounts.find((a) => a.id === conversation.accountId)
    if (!isForMe(event.message, accountNames(account), manager.ownMessageIds(event.message.conversationId))) return
  }
  const nickname = person?.name || storage.settings.contactOverrides?.[conversation?.id ?? event.message.conversationId]?.nickname?.trim()
  const title = conversation?.isGroup ? `${event.message.senderName} in ${nickname || conversation.title}` : nickname || event.message.senderName
  if (appLock.isLocked()) return lockedNotification()
  const vi = storage.settings.language === 'vi'
  // A message request is never answered from a notification: replying accepts it, which deserves a look first.
  const replyable = canReplyInline && !(conversation && isPendingRequest(conversation, storage.settings.acceptedRequests))
  const notification = new Notification({
    title,
    body: event.message.text || (vi ? 'Đã gửi một tệp đính kèm' : 'Sent an attachment'),
    // Moshi plays its own sound for new messages (renderer/src/sounds.ts) unless it is turned off.
    silent: storage.settings.sound !== 'off',
    ...(replyable ? { hasReply: true, replyPlaceholder: vi ? 'Trả lời…' : 'Reply…', actions: [{ type: 'button' as const, text: vi ? 'Đánh dấu đã đọc' : 'Mark as read' }] } : {})
  })
  notification.on('click', () => focusChat(event.message.conversationId))
  notification.on('reply', (_e, reply: string) => void replyFromNotification(event.message.conversationId, reply))
  notification.on('action', () => void manager.markRead(event.message.conversationId).catch(() => undefined))
  keepAlive(notification)
  notification.show()
}

later = new Later(storage, emit, notifyLater, (id) => latestOf(id).map((l) => l.message), log)

/** Today's birthdays: one notification each (three at most), with a box to send your wishes from on macOS. */
function notifyBirthdays(due: BirthdayDue[]): void {
  if (!Notification.isSupported()) return
  if (appLock.isLocked()) return lockedNotification()
  const vi = storage.settings.language === 'vi'
  const known = new Map(manager.listConversations().map((c) => [c.id, c]))
  for (const item of due.slice(0, 3)) {
    const override = storage.settings.contactOverrides?.[item.conversationId]
    const full = shownPerson(item.conversationId)?.name || override?.nickname?.trim() || known.get(item.conversationId)?.title || ''
    const name = givenName(full) || full
    // Your own note is the best reminder of what to say ("just moved to Đà Nẵng").
    const note = override?.note?.trim().split('\n')[0]
    const n = new Notification({
      title: vi ? `Hôm nay sinh nhật ${name} 🎂` : `It's ${name}'s birthday today 🎂`,
      body: (note ? `📝 ${note}` : vi ? 'Gửi một lời chúc nhé?' : 'Send them a few words?').slice(0, 160),
      silent: false,
      ...(canReplyInline ? { hasReply: true, replyPlaceholder: vi ? 'Gửi lời chúc…' : 'Send your wishes…' } : {})
    })
    n.on('click', () => focusChat(item.conversationId))
    n.on('reply', (_e, reply: string) => void replyFromNotification(item.conversationId, reply))
    keepAlive(n)
    n.show()
  }
}

const birthdays = new Birthdays(storage, emit, () => manager.listConversations(), notifyBirthdays, log)

function applyTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme
}

/** The legal documents shipped next to the app (Vietnamese first, English below). */
const LEGAL_DOCS = { notice: 'NOTICE.md', license: 'LICENSE', terms: 'TERMS.md', privacy: 'PRIVACY.md', credits: 'CREDITS.md' } as const

const stickerDir = (): string => (app.isPackaged ? join(process.resourcesPath, 'stickers') : join(__dirname, '../../resources/stickers'))

/**
 * A sticker as an outgoing image: transparent PNG, plus a copy on white for platforms that flatten transparency,
 * and for an animated Mito sticker its looping WebP (Zalo sends that one, moving).
 */
async function stickerFile(id: string): Promise<OutgoingAttachment> {
  if (id.startsWith('custom:')) return customStickerFile(id.slice(7))
  if (isGiphyStickerId(id)) return giphyStickerFile(id.slice('giphy:'.length), giphyKey())
  const mito = isMitoId(id)
  if (!mito && !isStickerId(id)) throw new Error('Unknown sticker')
  const base = mito ? join(stickerDir(), 'mito', id.slice('mito:'.length)) : join(stickerDir(), id)
  const path = `${base}.png`
  const opaque = `${base}-white.png`
  const animated = mito && mitoSticker(id).loop ? `${base}.webp` : undefined
  const [data, opaqueInfo, animatedInfo] = await Promise.all([
    readFile(path),
    stat(opaque).catch(() => undefined),
    animated ? stat(animated).catch(() => undefined) : undefined
  ])
  const alternates: NonNullable<OutgoingAttachment['alternates']> = []
  if (opaqueInfo) alternates.push({ path: opaque, mime: 'image/png', size: opaqueInfo.size, role: 'opaque' })
  if (animated && animatedInfo) alternates.push({ path: animated, mime: 'image/webp', size: animatedInfo.size, role: 'animated' })
  return {
    path,
    name: `${basename(base)}.png`,
    mime: 'image/png',
    size: data.length,
    sticker: id,
    preview: `data:image/png;base64,${data.toString('base64')}`,
    alternates: alternates.length ? alternates : undefined,
    // A Mito sticker that is on GIPHY too reaches Instagram as a real, moving sticker.
    giphy: mito && MITO_GIPHY[id] ? { id: MITO_GIPHY[id], queries: [`mito ${mitoSticker(id).name.en.toLowerCase()}`, 'moshi mito'] } : undefined
  }
}

/** The GIPHY key for stickers: a GIPHY GIF key, else the one set just for stickers, else one built into the release. */
function giphyKey(): string {
  const { gif, giphyKey: own } = storage.settings
  if (gif?.provider === 'giphy' && gif.key) return gif.key
  if (own) return own
  return BUILT_IN_GIF.provider === 'giphy' ? BUILT_IN_GIF.key : ''
}

/**
 * Drop per-chat settings (tags, pins, hidden, marked-unread, archived, mentions-only and accepted-request chats, nicknames, saved messages, mutes) that belong to accounts
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
  const hidden = keep(settings.hidden)
  if (hidden && Object.keys(hidden).length !== Object.keys(settings.hidden ?? {}).length) patch.hidden = hidden
  // People are left as they are: another computer may have the accounts of the chats missing here (a person
  // with one chat around simply shows as that chat).
  for (const key of ['markedUnread', 'archived', 'mentionsOnly', 'acceptedRequests'] as const) {
    const kept = keep<number | boolean>(settings[key])
    if (kept && Object.keys(kept).length !== Object.keys(settings[key] ?? {}).length) Object.assign(patch, { [key]: kept })
  }
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
    // Not a deletion to sync: another computer may still have these accounts.
    await storage.setSettings(patch, 'tidy')
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

/**
 * The macOS menu bar. Without one Electron installs its own, whose View menu takes ⌘=, ⌘- and ⌘0
 * (zooming the page without saving it) and whose ⌘R reloads the app mid-conversation. This menu
 * hands those keys, ⌘N, ⌘K and ⌘, to the renderer as commands; Edit keeps the standard roles so
 * copy and paste keep working in every text field.
 */
function installMenu(): void {
  if (!isMac) return
  const vi = storage.settings.language === 'vi'
  const command = (command: AppCommand) => (): void => {
    if (!window || window.isDestroyed()) {
      createWindow()
      return
    }
    window.show()
    window.webContents.send(IPC.event, { type: 'app:command', command } satisfies BridgeEvent)
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Moshi',
      submenu: [
        { role: 'about', label: vi ? 'Giới thiệu Moshi' : 'About Moshi' },
        { type: 'separator' },
        { label: vi ? 'Cài đặt…' : 'Settings…', accelerator: 'Cmd+,', click: command('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: vi ? 'Ẩn Moshi' : 'Hide Moshi' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: vi ? 'Thoát Moshi' : 'Quit Moshi' }
      ]
    },
    {
      label: vi ? 'Tệp' : 'File',
      submenu: [
        { label: vi ? 'Tin nhắn mới' : 'New Message', accelerator: 'Cmd+N', click: command('new-chat') },
        { label: vi ? 'Nhảy tới hội thoại…' : 'Jump to Conversation…', accelerator: 'Cmd+K', click: command('command-palette') },
        { type: 'separator' },
        { label: vi ? 'Lưu trữ hội thoại' : 'Archive Conversation', accelerator: 'Cmd+E', click: command('archive') },
        { label: vi ? 'Hoãn hội thoại…' : 'Snooze Conversation…', accelerator: 'Cmd+Shift+H', click: command('snooze') },
        { label: vi ? 'Khoá Moshi' : 'Lock Moshi', accelerator: 'Cmd+Ctrl+L', click: () => appLock.lock() },
        { label: vi ? 'Đánh dấu chưa đọc / đã đọc' : 'Mark as Unread / Read', accelerator: 'Cmd+Shift+U', click: command('toggle-unread') },
        { label: vi ? 'Xem lưu trữ' : 'Show Archive', accelerator: 'Cmd+;', click: command('show-archive') },
        { type: 'separator' },
        // ⌘W closes what is on top first (a photo, a sheet), then hides the window.
        { label: vi ? 'Đóng' : 'Close', accelerator: 'Cmd+W', click: command('close') }
      ]
    },
    {
      label: vi ? 'Sửa' : 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: vi ? 'Đọc' : 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }
      ]
    },
    {
      label: vi ? 'Xem' : 'View',
      submenu: [
        { label: vi ? 'Phóng to' : 'Zoom In', accelerator: 'Cmd+=', click: command('zoom-in') },
        { label: vi ? 'Thu nhỏ' : 'Zoom Out', accelerator: 'Cmd+-', click: command('zoom-out') },
        { label: vi ? 'Cỡ chuẩn' : 'Actual Size', accelerator: 'Cmd+0', click: command('zoom-reset') },
        { type: 'separator' },
        { label: vi ? 'Chia đôi khung chat' : 'Split Chat', accelerator: 'Cmd+\\', click: command('toggle-split') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' } as const, { role: 'reload' } as const, { role: 'toggleDevTools' } as const])
      ]
    },
    {
      label: vi ? 'Cửa sổ' : 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      label: vi ? 'Trợ giúp' : 'Help',
      role: 'help',
      submenu: [{ label: vi ? 'Moshi trên GitHub' : 'Moshi on GitHub', click: () => void shell.openExternal('https://github.com/heydanenguyen/MoshiChat') }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * No system-drawn backdrop on Windows, for any style. Liquid Glass used an acrylic backdrop behind a
 * see-through page, but Chromium never cleared the transparent areas between frames: old text, sheets and a
 * white band from before a resize stayed on screen, and backdrop-filter had to be switched off. The glass is
 * now drawn by the page itself over the app's own backdrop (see the Liquid Glass rules in app.css).
 */
function backdropFor(): 'none' | undefined {
  return isMac ? undefined : 'none'
}

/** The window's own colour: the theme's base (the page paints over it straight away). */
function windowColorFor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff'
}

/** Re-applied when the style changes (clears an acrylic backdrop a window from an older build still has). */
function applyBackdrop(): void {
  if (isMac || !window || window.isDestroyed()) return
  window.setBackgroundMaterial(backdropFor() ?? 'none')
  window.setBackgroundColor(windowColorFor())
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 420,
    minHeight: 480,
    show: false,
    title: 'Moshi',
    icon: appIcon(),
    backgroundColor: windowColorFor(),
    // A thin custom title bar on every platform; macOS keeps its native traffic lights inset into it.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundMaterial: backdropFor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The preload only uses electron's ipcRenderer, contextBridge and webUtils, all available sandboxed.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      webSecurity: true,
      // Message sounds must play while the window is in the background.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  // Interface zoom from Settings (large/4K screens); re-applied after every load.
  window.webContents.on('did-finish-load', () => {
    window?.webContents.setZoomFactor(clampZoom(storage.settings.zoom))
    // No keyring (some Linux desktops): sessions would be stored merely encoded, so say so rather than stay quiet.
    if (storage.accounts.length && !secretsProtected()) setTimeout(() => emit({ type: 'app:notice', notice: 'insecure-secrets' }), 4000)
  })
  window.once('ready-to-show', () => window?.show())
  // Safety net: never leave the user with an invisible window if the first paint stalls.
  setTimeout(() => {
    if (window && !window.isDestroyed() && !window.isVisible()) window.show()
  }, 4000)
  window.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'warning' || level === 'error') log('renderer:', message, sourceId ? `(${sourceId}:${lineNumber})` : '')
  })
  window.webContents.on('preload-error', (_e, path, error) => log('preload error', path, error.message))
  // macOS: closing the window hides it, like other messengers; the Dock icon brings it back. (It
  // used to be destroyed while the app kept running, and the hidden Instagram/Zalo helper windows
  // stopped "activate" from ever making a new one, so the only way back was quitting.)
  window.on('close', (e) => {
    if (!isMac || quitting || !window) return
    e.preventDefault()
    const w = window
    if (w.isFullScreen()) {
      w.once('leave-full-screen', () => w.hide())
      w.setFullScreen(false)
    } else w.hide()
  })
  window.on('closed', () => (window = undefined))
  // Kept out of screen sharing and screenshots when asked; and hidden long enough counts as away for the lock.
  window.setContentProtection(!!storage.settings.hideFromScreenShare)
  window.on('hide', () => appLock.windowHidden(true))
  window.on('minimize', () => appLock.windowHidden(true))
  window.on('show', () => appLock.windowHidden(false))
  window.on('restore', () => appLock.windowHidden(false))
  window.webContents.on('before-input-event', (event, input) => {
    if (!editorKeys || input.type !== 'keyDown' || !(isMac ? input.meta : input.control)) return
    const key = input.key.toLowerCase()
    if (!EDITOR_KEYS.has(key)) return
    event.preventDefault()
    window?.webContents.send(IPC.event, { type: 'editor:key', key, shift: input.shift } satisfies BridgeEvent)
  })
  const sendState = (): void => {
    if (window && !window.isDestroyed()) window.webContents.send(IPC.event, { type: 'window:state', maximized: window.isMaximized() })
  }
  window.on('maximize', sendState)
  window.on('unmaximize', sendState)

  window.webContents.setWindowOpenHandler(({ url }) => {
    // Only web, mail and phone links leave the app; file: or ms-*: links from a message never reach the system.
    const safe = externalUrl(url)
    if (safe) void shell.openExternal(safe)
    return { action: 'deny' }
  })
  // The window only ever shows Moshi itself: a dropped link or a stray navigation must not load another page that
  // would then hold the full window.unison bridge.
  const contents = window.webContents
  contents.on('will-navigate', (event, url) => {
    const own = contents.getURL()
    if (!own || new URL(url).origin !== new URL(own).origin) event.preventDefault()
  })

  if (!app.isPackaged && process.env.MOSHI_UI_SCRIPT) installUiScript(window)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Development only: run a script inside the page (it can drive the store through window.__moshi) and
 * save a screenshot whenever it logs `MOSHI_SHOT:<name>`; `MOSHI_DONE` quits. Lets UI changes be
 * checked by eye without clicking through the app: MOSHI_UI_SCRIPT=steps.js MOSHI_SHOT_DIR=out npm run dev
 */
function installUiScript(win: BrowserWindow): void {
  const script = process.env.MOSHI_UI_SCRIPT
  const dir = process.env.MOSHI_SHOT_DIR ?? app.getPath('temp')
  if (!script) return
  win.webContents.on('console-message', ({ message }) => {
    if (message.startsWith('MOSHI_SHOT:')) {
      const name = message.slice(11).replace(/[^\w.-]/g, '_')
      void win.webContents
        .capturePage()
        .then((image) => writeFile(join(dir, `${name}.png`), image.toPNG()))
        .then(() => log('ui shot saved:', name))
    } else if (message === 'MOSHI_DONE') setTimeout(() => app.quit(), 800)
  })
  // MOSHI_UI_SIZE=900x700 checks narrow layouts.
  const size = /^(\d+)x(\d+)$/.exec(process.env.MOSHI_UI_SIZE ?? '')
  if (size) win.setSize(Number(size[1]), Number(size[2]))
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void readFile(script, 'utf8')
        .then((code) => win.webContents.executeJavaScript(code, true))
        .catch((err) => log('ui script failed:', (err as Error).message))
    }, 1500)
  })
}

/**
 * unison-img://img/?u=<https url> re-fetches a profile picture through the platform's own session.
 * Some Instagram/Facebook CDN links only load inside the signed-in site. Only image CDNs are allowed.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'unison-img', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'unison-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

/**
 * unison-media://v/?u=<https url> plays a platform's video or voice file through Moshi. Zalo's file host answers a
 * page's own referer with 403 (and labels downloads as attachments), so the player never got the video; here the
 * request carries the platform's referer and passes range requests through, so seeking works.
 */
function registerMediaProxy(): void {
  protocol.handle('unison-media', async (request) => {
    try {
      const target = new URL(new URL(request.url).searchParams.get('u') ?? '')
      if (!proxyAllowed(target, IMAGE_HOSTS)) return new Response('blocked', { status: 403 })
      const zalo = /zdn\.vn|zadn\.vn|dlfl\.vn|zaloapp\.com/.test(target.hostname)
      const range = request.headers.get('range')
      const res = await session.defaultSession.fetch(target.toString(), {
        headers: { Referer: zalo ? 'https://chat.zalo.me/' : 'https://www.facebook.com/', ...(range ? { Range: range } : {}) }
      })
      if (!res.ok) return new Response('unavailable', { status: res.status })
      const headers = new Headers()
      for (const name of ['content-length', 'content-range', 'accept-ranges']) {
        const value = res.headers.get(name)
        if (value) headers.set(name, value)
      }
      const type = res.headers.get('content-type') ?? ''
      // A file served as a download (octet-stream) is still a video to the player.
      headers.set('content-type', /^(video|audio)\//.test(type) ? type : /\.webm(\?|$)/i.test(target.pathname) ? 'video/webm' : 'video/mp4')
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return new Response('error', { status: 502 })
    }
  })
}

import { IMAGE_HOSTS } from '@shared/media'
import { externalUrl, fileInside, isPrivateHost, proxyAllowed } from './safety'

/**
 * A sticker's background taken away: macOS lifts the subject itself when it can (fast and light); otherwise, or for
 * "Cut more precisely", the BiRefNet model, which needs ~6 GB of memory and is refused on a computer without it.
 */
async function cutOut(png: Buffer, precise: boolean): Promise<Buffer> {
  const vi = storage.settings.language !== 'en'
  if (!precise && nativeCutoutAvailable()) {
    try {
      return await nativeCutout(png)
    } catch (err) {
      log('[cutout] macOS could not lift the subject:', (err as Error).message)
      // Nothing to lift, and no model here to try harder: say so instead of downloading 115 MB unasked.
      if (!(await ai.cutoutModelReady())) {
        const message = err instanceof NativeCutoutError && err.noSubject ? (vi ? 'Không tìm thấy chủ thể trong ảnh' : 'No subject found in the picture') : (err as Error).message
        throw new Error(message, { cause: err })
      }
    }
  }
  if (!cutoutMemoryOk()) {
    throw new Error(vi ? 'Máy không đủ bộ nhớ trống để tách nền (cần khoảng 6 GB). Đóng bớt ứng dụng rồi thử lại.' : 'Not enough free memory to cut out the background (about 6 GB). Close some apps and try again.')
  }
  return Buffer.from(await ai.cutout(new Uint8Array(png)))
}

function registerImageProxy(): void {
  protocol.handle('unison-img', async (request) => {
    // unison-img://sticker/mito/<id>.png|webp: the Mito pack's pictures, straight from the app's resources.
    const url = new URL(request.url)
    // unison-img://custom-sticker/<file>: your own stickers, from the stickers folder (only names Moshi gives them).
    if (url.hostname === 'custom-sticker') {
      const path = customStickerPath(decodeURIComponent(url.pathname.slice(1)))
      if (!path) return new Response('blocked', { status: 403 })
      try {
        const data = await readFile(path)
        const ext = path.split('.').pop()!.toLowerCase()
        const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'apng' ? 'image/apng' : `image/${ext}`
        return new Response(new Uint8Array(data), { status: 200, headers: { 'content-type': type, 'cache-control': 'max-age=31536000', 'access-control-allow-origin': '*' } })
      } catch {
        return new Response('missing', { status: 404 })
      }
    }
    if (url.hostname === 'sticker') {
      const m = /^\/mito\/([a-z]+)\.(png|webp)$/.exec(url.pathname)
      if (!m || !isMitoId(`mito:${m[1]}`)) return new Response('blocked', { status: 403 })
      try {
        const data = await readFile(join(stickerDir(), 'mito', `${m[1]}.${m[2]}`))
        return new Response(new Uint8Array(data), { status: 200, headers: { 'content-type': `image/${m[2]}`, 'cache-control': 'max-age=31536000', 'access-control-allow-origin': '*' } })
      } catch {
        return new Response('missing', { status: 404 })
      }
    }
    try {
      const target = new URL(new URL(request.url).searchParams.get('u') ?? '')
      if (!proxyAllowed(target, IMAGE_HOSTS)) return new Response('blocked', { status: 403 })
      const instagram = /instagram|cdninstagram/.test(target.hostname) || target.searchParams.has('_nc_cat')
      const zalo = /zdn\.vn|zadn\.vn|dlfl\.vn|zaloapp\.com/.test(target.hostname)
      const ses = /fbcdn|cdninstagram|instagram/.test(target.hostname)
        ? session.fromPartition(partitionFor(instagram ? 'instagram' : 'messenger'))
        : /facebook|fbsbx/.test(target.hostname)
          ? session.fromPartition(partitionFor('messenger'))
          : session.defaultSession
      const get = (): Promise<Response> =>
        ses.fetch(target.toString(), { headers: { Referer: zalo ? 'https://chat.zalo.me/' : instagram ? 'https://www.instagram.com/' : 'https://www.facebook.com/' } })
      // ?w=960: a light copy sized for the bubble, made once and kept (see media/preview.ts).
      const width = Number(url.searchParams.get('w'))
      if (width > 0) {
        const preview = await previewOf(target.toString(), width, async () => {
          const res = await get()
          const type = res.headers.get('content-type') ?? ''
          return res.ok && type.startsWith('image/') ? { type, body: Buffer.from(await res.arrayBuffer()) } : undefined
        })
        if (!preview) return new Response('unavailable', { status: 404 })
        return new Response(new Uint8Array(preview.body), { status: 200, headers: { 'content-type': preview.type, 'cache-control': 'max-age=604800' } })
      }
      const res = await get()
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && type.startsWith('image/')) return new Response(res.body, { status: 200, headers: { 'content-type': type, 'cache-control': 'max-age=86400' } })
      // Zalo's file store serves everything as application/octet-stream (photo stickers live there): tell by the bytes.
      if (!res.ok || !/octet-stream/.test(type)) return new Response('unavailable', { status: 404 })
      const body = Buffer.from(await res.arrayBuffer())
      const sniffed = imageTypeOf(body)
      if (!sniffed) return new Response('unavailable', { status: 404 })
      return new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': sniffed, 'cache-control': 'max-age=86400' } })
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
    "media-src 'self' data: https: file: unison-media:",
    "connect-src 'self'"
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
}

/**
 * Files the renderer may send or turn into stickers: ones the person picked in a dialog or dropped/pasted (the preload
 * grants a dropped file's real path, which a page cannot fake), and Moshi's own (its data, temp files, bundled
 * stickers). Anything else is refused, so a compromised page cannot attach an arbitrary file from this computer.
 */
const grantedFiles = new Set<string>()
const fileKey = (path: string): string => {
  const full = resolve(path)
  return process.platform === 'win32' ? full.toLowerCase() : full
}
function grantFile(path: string): void {
  if (path) grantedFiles.add(fileKey(path))
}
function fileAllowed(path: unknown): boolean {
  if (typeof path !== 'string' || !path) return false
  if (grantedFiles.has(fileKey(path))) return true
  return fileInside(pathToFileURL(resolve(path)), [app.getPath('userData'), app.getPath('temp'), stickerDir()])
}
function requireFiles(options: SendOptions | undefined): void {
  for (const a of options?.attachments ?? []) {
    for (const path of [a.path, ...(a.alternates ?? []).map((alt) => alt.path)]) {
      if (!fileAllowed(path)) throw new Error('This file cannot be sent from here')
    }
  }
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
    grantFile(path)
    const info = await stat(path)
    const mime = mimeOf(path)
    const preview = mime.startsWith('image/') && info.size < 60_000_000 ? imagePreview(await readFile(path), mime) : undefined
    files.push({ path, name: basename(path), mime, size: info.size, preview })
  }
  return files
}

/** A pasted image (screenshot from the clipboard) as a file the adapters can send. */
/**
 * A data URL the chat can show at once while a photo is sent: the file itself when it is small, else a
 * copy scaled to 1600 px. Big photos and Retina screenshots used to get no preview at all, and platforms
 * that do not echo your own photo back (Zalo) then showed a grey "Photo" box.
 */
function imagePreview(data: Buffer, mime: string): string | undefined {
  if (!mime.startsWith('image/')) return undefined
  if (data.length < 1_500_000) return `data:${mime};base64,${data.toString('base64')}`
  const image = nativeImage.createFromBuffer(data)
  if (image.isEmpty()) return undefined
  const { width, height } = image.getSize()
  const scale = Math.min(1, 1600 / Math.max(width, height))
  const small = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : image
  if (mime === 'image/png') {
    // Screenshots stay crisp as PNG; a photo saved as PNG can still be huge, so it falls back to JPEG.
    const png = small.toPNG()
    if (png.length < 2_500_000) return `data:image/png;base64,${png.toString('base64')}`
  }
  return `data:image/jpeg;base64,${small.toJPEG(85).toString('base64')}`
}

const MEDIA_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm'
}

/** Folders whose files the renderer may have read back (its own data, and the temporary files Moshi makes). */
function ownFolders(): string[] {
  return [app.getPath('userData'), app.getPath('temp')]
}

/** The bytes behind a photo or video shown in the app (a platform CDN, a local file, a data URL). */
async function mediaBytes(url: string): Promise<{ data: Buffer; type: string }> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    const meta = url.slice(5, comma)
    const body = url.slice(comma + 1)
    return { data: meta.endsWith(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body)), type: meta.split(';')[0] }
  }
  let target = new URL(url)
  if (target.protocol === 'unison-img:') target = new URL(target.searchParams.get('u') ?? '')
  if (target.protocol === 'file:') {
    if (!fileInside(target, ownFolders())) throw new Error('This file cannot be opened from here')
    return { data: await readFile(target), type: '' }
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('This file cannot be saved')
  if (isPrivateHost(target.hostname)) throw new Error('This address cannot be downloaded from')
  // facebook.com and instagram.com are fetched signed in: only their static pictures, never a page or an action URL.
  if (/(^|\.)(facebook|instagram)\.com$/i.test(target.hostname) && !proxyAllowed(target, IMAGE_HOSTS)) throw new Error('This address cannot be downloaded from')
  const host = target.hostname
  const instagram = /instagram|cdninstagram/.test(host) || target.searchParams.has('_nc_cat')
  const zalo = /zdn\.vn|zadn\.vn|zaloapp\.com/.test(host)
  const ses = /fbcdn|cdninstagram|instagram/.test(host)
    ? session.fromPartition(partitionFor(instagram ? 'instagram' : 'messenger'))
    : /facebook|fbsbx/.test(host)
      ? session.fromPartition(partitionFor('messenger'))
      : session.defaultSession
  const referer = zalo ? 'https://chat.zalo.me/' : instagram ? 'https://www.instagram.com/' : /fbcdn|facebook|fbsbx/.test(host) ? 'https://www.facebook.com/' : undefined
  const res = await ses.fetch(target.toString(), referer ? { headers: { Referer: referer } } : undefined)
  if (!res.ok) throw new Error(`Could not download the file (${res.status})`)
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > 500 * 1024 * 1024) throw new Error('This file is too large')
  return { data, type: (res.headers.get('content-type') ?? '').split(';')[0].trim() }
}

/** The folder chosen in Settings if it still exists, else the system Downloads folder. */
async function downloadDir(): Promise<string> {
  const custom = storage.settings.downloadDir
  if (custom && (await stat(custom).catch(() => undefined))?.isDirectory()) return custom
  return app.getPath('downloads')
}

/** photo.jpg, or photo (1).jpg, photo (2).jpg… when the name is taken. */
async function freePath(dir: string, file: string): Promise<string> {
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const ext = dot > 0 ? file.slice(dot) : ''
  for (let i = 0; i < 1000; i++) {
    const candidate = join(dir, i ? `${stem} (${i})${ext}` : file)
    if (!(await stat(candidate).catch(() => undefined))) return candidate
  }
  return join(dir, `${stem}-${Date.now()}${ext}`)
}

/** The share image being drawn: its data for the share window, and how that window says it is done. */
let sharing: { card: ShareCardData; ready(): void } | undefined

/**
 * Close friends as a 9:16 story image (1080 × 1920): the renderer draws the card in a hidden off-screen window
 * (#share), main captures it, saves it like a download and puts it on the clipboard, ready to paste into a story.
 */
async function shareCard(card: ShareCardData): Promise<{ path?: string }> {
  if (sharing) throw new Error('Already making a picture')
  const W = 1080
  const H = 1920
  // Windows keeps even a hidden window within the screen (1920 px rarely fits), so the card is captured in
  // slices: the window is one slice tall and the card moves up under it.
  const SLICE = 640
  const canvas = new BrowserWindow({
    show: false,
    width: W,
    height: SLICE,
    frame: false,
    useContentSize: true,
    backgroundColor: '#0b0720',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true }
  })
  try {
    const drawn = new Promise<void>((resolve) => {
      sharing = { card, ready: resolve }
      setTimeout(resolve, 8000)
    })
    if (process.env.ELECTRON_RENDERER_URL) await canvas.loadURL(`${process.env.ELECTRON_RENDERER_URL}#share`)
    else await canvas.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'share' })
    await drawn
    const slices: Buffer[] = []
    for (let y = 0; y < H; y += SLICE) {
      // The app's root does not scroll, so the card itself moves up under the window, one slice at a time.
      await canvas.webContents.executeJavaScript(
        `document.querySelector('.share-card').style.translate = '0 -${y}px'; new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`
      )
      canvas.webContents.invalidate()
      await new Promise((r) => setTimeout(r, 80))
      const shot = await canvas.webContents.capturePage({ x: 0, y: 0, width: W, height: SLICE })
      slices.push(shot.resize({ width: W, height: SLICE }).toBitmap())
    }
    const png = nativeImage.createFromBitmap(Buffer.concat(slices), { width: W, height: H }).toPNG()
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]).catch(() => undefined)
    const name = card.language === 'vi' ? 'Moshi - Thân thiết.png' : 'Moshi - Close friends.png'
    const dir = await downloadDir()
    if (storage.settings.askWhereToSave) {
      const options = { defaultPath: join(dir, name), filters: [{ name: 'PNG', extensions: ['png'] }] }
      const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      if (picked.canceled || !picked.filePath) return {}
      await writeFile(picked.filePath, png)
      return { path: picked.filePath }
    }
    const path = await freePath(dir, name)
    await writeFile(path, png)
    return { path }
  } finally {
    sharing = undefined
    canvas.destroy()
  }
}

/** Download in the photo viewer: straight into the download folder, or wherever the user picks when Settings asks for that. */
async function saveMedia(url: string, name?: string): Promise<string | undefined> {
  const { data, type } = await mediaBytes(url)
  let base = (name && !/^https?:/.test(name) ? name : '') || decodeURIComponent(new URL(url.startsWith('data:') ? 'https://x/photo' : url).pathname.split('/').pop() || '') || 'photo'
  base = base.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120)
  const ext = MEDIA_EXT[type]
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += `.${ext ?? 'jpg'}`
  const dir = await downloadDir()
  if (!storage.settings.askWhereToSave) {
    const path = await freePath(dir, base)
    await writeFile(path, data)
    return path
  }
  const options = { defaultPath: join(dir, base) }
  const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return undefined
  await writeFile(picked.filePath, data)
  return picked.filePath
}

async function saveImage(bytes: Uint8Array, mime: string, name?: string): Promise<OutgoingAttachment> {
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : mime.startsWith('video/') ? 'mp4' : 'png'
  if (!/^(image|video)\//.test(mime)) throw new Error('Only images and videos can be pasted')
  if (bytes.length > 40 * 1024 * 1024) throw new Error('This image is too large to send')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(app.getPath('temp'), 'unison-paste')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `paste-${stamp}.${ext}`)
  await writeFile(path, bytes)
  const clean = (name ?? '').replace(/[\\/:*?"<>|]/g, '_').trim()
  return {
    path,
    name: clean && clean !== 'image.png' ? clean : `screenshot-${stamp.slice(0, 19)}.${ext}`,
    mime,
    size: bytes.length,
    preview: imagePreview(Buffer.from(bytes), mime)
  }
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
    await shell.openExternal(externalUrl(url) ?? 'about:blank')
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
 * typed into the platform's page only; Moshi never sees them.
 */
const openLogins = new Map<string, BrowserWindow>()

/**
 * A personal Facebook / Instagram account signs in again in its own browser session. If that session is now signed
 * in to somebody else (another account of yours), it gets a fresh one instead, so the sign-in page shows and the
 * other account is left alone; and a sign-in as the wrong person is refused rather than attached to this account.
 */
async function signInAgain(id: string, web: WebPlatform): Promise<void> {
  const expected = id.slice(id.indexOf('-') + 1)
  const stored = manager.storedPartition(id, web)
  const owner = await sessionUser(web, stored)
  const partition = owner && owner !== expected ? newPartition(web) : stored
  log(`[web login] ${id} signs in again in ${partition}${partition !== stored ? ` (${stored} is signed in to another account)` : ''}`)
  let cookies: WebCookie[]
  try {
    cookies = await captureWebSession(web, manager.storedCookies(id), partition)
  } catch (err) {
    if (partition !== stored) void wipePartition(web, partition)
    throw err
  }
  const signedIn = cookies.find((c) => c.name === USER_COOKIE[web])?.value
  if (signedIn !== expected) {
    if (partition !== stored) void wipePartition(web, partition)
    const vi = storage.settings.language !== 'en'
    throw new Error(vi ? 'Bạn vừa đăng nhập một tài khoản khác. Hãy đăng nhập đúng tài khoản này, hoặc dùng "Thêm tài khoản" cho tài khoản mới.' : 'You signed in to a different account. Sign in to this one, or use "Add account" for a new one.')
  }
  // A new session means a new adapter around it (Instagram works inside its session); the old one is let go.
  if (partition !== stored) await manager.addWebSession(web, cookies, partition)
  else await manager.reauthWebSession(id, cookies)
}

/**
 * Open the platform's own sign-in page in an app window and return its cookies once the
 * user is signed in. `dead` are cookies known to be rejected: only those exact values are
 * dropped first, so a newer session already in the window (for example one the user just
 * completed) is reused instead of forcing another sign-in.
 */
async function captureWebSession(platform: 'messenger' | 'instagram', dead: WebCookie[] = [], partition = legacyPartition(platform)): Promise<WebCookie[]> {
  const existing = openLogins.get(platform)
  if (existing && !existing.isDestroyed()) {
    // Already waiting on this platform (for example a two-factor step): bring it back instead of opening another.
    existing.show()
    existing.focus()
    throw new Error('Finish signing in in the Instagram/Facebook window that is already open')
  }
  const spec = WEB_LOGIN[platform]
  // The account's own browser session (a new account gets an empty one, so the sign-in page shows).
  const ses = session.fromPartition(partition)
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
  // Every channel answers only Moshi's own page (the main window and the share picture window). Login windows and
  // the hidden Instagram pages have no preload, but a frame that is not the app must never reach these either.
  const appPage = process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : pathToFileURL(join(__dirname, '../renderer/index.html')).href
  const fromApp = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => !!event.senderFrame?.url.startsWith(appPage)
  type Handler = Parameters<typeof ipcMain.handle>[1]
  type Listener = Parameters<typeof ipcMain.on>[1]
  const handle = (channel: string, fn: Handler): void =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromApp(event)) throw new Error('Not allowed')
      return fn(event, ...args)
    })
  const on = (channel: string, fn: Listener): void => {
    ipcMain.on(channel, (event, ...args) => {
      if (fromApp(event)) fn(event, ...args)
    })
  }
  handle(IPC.accountsList, () => manager.listAccounts())
  handle(IPC.accountsAdd, (_e, input: AddAccountInput) => manager.add(input))
  handle(IPC.accountsRemove, async (_e, id: string) => {
    await manager.remove(id)
    await pruneOrphanedSettings()
  })
  handle(IPC.accountsReconnect, async (_e, id: string) => {
    const web = id.startsWith('instagram:ig-') ? 'instagram' : id.startsWith('messenger:fb-') ? 'messenger' : undefined
    const account = manager.listAccounts().find((a) => a.id === id)
    if (web && account && account.status !== 'connected') {
      await signInAgain(id, web)
      return
    }
    await manager.reconnect(id)
  })
  handle(IPC.accountsAddDemo, () => manager.addDemo())
  handle(IPC.accountsConnectWeb, async (_e, platform: 'messenger' | 'instagram') => {
    // A second account signs in in a session of its own, leaving the first one signed in.
    const partition = freshPartition(platform)
    log(`[web login] a new ${platform} account signs in in ${partition}`)
    try {
      return await manager.addWebSession(platform, await captureWebSession(platform, [], partition), partition)
    } catch (err) {
      void wipePartition(platform, partition)
      throw err
    }
  })
  handle(IPC.accountsListPages, (_e, appId: string) => listPages(appId))
  handle(IPC.accountsAddPages, (_e, pages: PageOption[], includeInstagram: boolean) => manager.addPages(pages, includeInstagram))
  handle(IPC.contactsList, (_e, query: string) => manager.contacts(query))
  handle(IPC.contactsOpen, (_e, accountId: string, peerId: string) => manager.openConversation(accountId, peerId))
  handle(IPC.conversationsList, () => manager.listConversations())
  handle(IPC.conversationsMarkRead, (_e, id: string) => manager.markRead(id))
  handle(IPC.conversationsAcceptRequest, (_e, id: string) => manager.acceptRequest(id))
  handle(IPC.conversationsProfile, (_e, id: string) => manager.profile(id))
  handle(IPC.conversationsShared, (_e, id: string, kind: SharedKind) => manager.shared(id, kind))
  handle(IPC.conversationsSearchIn, (_e, id: string, query: string) => manager.searchIn(id, query))
  handle(IPC.conversationsStats, (_e, id: string) => manager.stats(id))
  handle(IPC.messagesOpenAttachment, (_e, id: string, messageId: string, attachmentId: string) => openAttachment(id, messageId, attachmentId))
  handle(IPC.messagesList, (_e, id: string, beforeId?: string) => manager.fetchMessages(id, beforeId))
  handle(IPC.messagesSend, (_e, id: string, text: string, options?: SendOptions) => {
    requireFiles(options)
    return manager.sendMessage(id, text, options)
  })
  on(IPC.appGrantFile, (_e, path: unknown) => {
    if (typeof path === 'string') grantFile(path)
  })
  handle(IPC.messagesForward, (_e, fromId: string, messageId: string, toId: string) => manager.forward(fromId, messageId, toId))
  handle(IPC.messagesLoadAttachment, (_e, id: string, messageId: string, attachmentId: string) => manager.loadAttachment(id, messageId, attachmentId))
  handle(IPC.messagesReact, (_e, id: string, messageId: string, emoji: string) => manager.react(id, messageId, emoji))
  handle(IPC.messagesUnsend, (_e, id: string, messageId: string) => manager.unsend(id, messageId))
  handle(IPC.messagesSearch, (_e, query: string) => manager.search(query))
  handle(IPC.messagesTyping, (_e, id: string) => manager.setTyping(id))
  handle(IPC.authRespond, (_e, requestId: string, value: string) => manager.respondAuth(requestId, value))
  handle(IPC.authCancel, (_e, requestId: string) => manager.cancelAuth(requestId))
  handle(IPC.settingsGet, () => storage.settings)
  handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    const settings = await storage.setSettings(patch)
    if (patch.theme) applyTheme(settings.theme)
    if ('style' in patch) applyBackdrop()
    if (patch.language) installMenu()
    if ('zoom' in patch && window && !window.isDestroyed()) window.webContents.setZoomFactor(clampZoom(settings.zoom))
    if (patch.logo) {
      const icon = appIcon(settings.logo)
      if (icon && window && !window.isDestroyed()) window.setIcon(icon)
    }
    return settings
  })
  handle(IPC.appVersion, () => app.getVersion())
  handle(IPC.updateState, () => updater.current())
  handle(IPC.updateCheck, () => updater.check(false))
  handle(IPC.updateDownload, () => updater.download())
  on(IPC.updateInstall, () => updater.install())
  handle(IPC.aiStatus, () => ai.status())
  handle(IPC.aiPrepare, (_e, kind: AiKind, speakLang?: SpeakLang) => ai.prepare(kind === 'translate' || kind === 'chat' || kind === 'speak' || kind === 'cutout' ? kind : 'voice', speakLang === 'en' ? 'en' : speakLang === 'vi' ? 'vi' : undefined))
  handle(IPC.aiRemove, (_e, kind: AiKind) => ai.remove(kind === 'translate' || kind === 'chat' || kind === 'speak' || kind === 'cutout' ? kind : 'voice'))
  handle(IPC.aiSpeak, (_e, text: string, speakLang: SpeakLang) => ai.speak(String(text ?? '').slice(0, 1200), speakLang === 'en' ? 'en' : 'vi'))
  handle(IPC.aiReadMedia, (_e, url: string) => readMedia(String(url)))
  handle(IPC.aiTranscribe, (_e, key: string, pcm: Float32Array, language?: string) =>
    ai.transcribe(String(key), pcm, typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : undefined)
  )
  handle(IPC.aiTranslate, (_e, key: string, text: string) => ai.translate(String(key), String(text ?? '').slice(0, 5000)))
  handle(IPC.aiTranslateTo, (_e, text: string, target: string) => ai.translateTo(String(text ?? '').slice(0, 5000), /^[a-z]{2}$/.test(String(target)) ? String(target) : 'en'))
  handle(IPC.aiCached, () => ai.cached())
  // Chat lines come from the renderer already trimmed; bound them again here.
  const cleanLines = (lines: unknown): ChatLine[] =>
    (Array.isArray(lines) ? lines : [])
      .slice(-80)
      .map((l) => ({ who: String((l as ChatLine).who ?? '').slice(0, 60), text: String((l as ChatLine).text ?? '').slice(0, 500), at: Number((l as ChatLine).at) || 0, mine: !!(l as ChatLine).mine }))
  handle(IPC.aiSummarize, (_e, key: string, lines: unknown) => ai.summarize(String(key).slice(0, 200), cleanLines(lines)))
  handle(IPC.aiSuggest, (_e, lines: unknown) => ai.suggest(cleanLines(lines)))
  handle(IPC.aiOpener, (_e, lines: unknown, silentDays: unknown, note: unknown) =>
    ai.opener(cleanLines(lines), Math.max(0, Math.round(Number(silentDays) || 0)), typeof note === 'string' ? note.slice(0, 300) : undefined)
  )
  handle(IPC.backupCreate, async (_e, input: { password: string; includeSessions: boolean }) => {
    const day = new Date().toISOString().slice(0, 10)
    const vi = storage.settings.language === 'vi'
    // Development only: UNISON_BACKUP_SAVE_PATH skips the dialog (automated tests).
    const testPath = !app.isPackaged ? process.env.UNISON_BACKUP_SAVE_PATH : undefined
    const picked = testPath ? { canceled: false, filePath: testPath } : await dialog.showSaveDialog(window!, {
      title: vi ? 'Lưu bản sao lưu Moshi' : 'Save Moshi backup',
      defaultPath: join(app.getPath('documents'), `Moshi-backup-${day}.${BACKUP_EXTENSION}`),
      filters: [{ name: 'Moshi backup', extensions: [BACKUP_EXTENSION] }]
    })
    if (picked.canceled || !picked.filePath) return null
    const result = await createBackup(storage, picked.filePath, String(input.password ?? ''), !!input.includeSessions)
    log('backup written:', result.bytes, 'bytes')
    return result
  })
  handle(IPC.backupPick, async () => {
    const vi = storage.settings.language === 'vi'
    const testPick = !app.isPackaged ? process.env.UNISON_BACKUP_OPEN_PATH : undefined
    const picked = testPick ? { canceled: false, filePaths: [testPick] } : await dialog.showOpenDialog(window!, {
      title: vi ? 'Chọn bản sao lưu Moshi' : 'Choose a Moshi backup',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Moshi backup', extensions: [BACKUP_EXTENSION, LEGACY_BACKUP_EXTENSION] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    return inspectBackup(picked.filePaths[0])
  })
  handle(IPC.backupRestore, async (_e, input: { path: string; password: string }) => {
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
  handle(IPC.backupReveal, (_e, path: string) => {
    if (typeof path === 'string' && path.toLowerCase().endsWith(`.${BACKUP_EXTENSION}`)) shell.showItemInFolder(path)
  })
  handle(IPC.syncStatus, () => sync.status())
  handle(IPC.syncChoose, async () => {
    const vi = storage.settings.language === 'vi'
    const options: Electron.OpenDialogOptions = {
      title: vi ? 'Chọn thư mục đồng bộ (OneDrive, Google Drive, Dropbox...)' : 'Choose a sync folder (OneDrive, Google Drive, Dropbox...)',
      properties: ['openDirectory', 'createDirectory']
    }
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return null
    return sync.enable(picked.filePaths[0])
  })
  handle(IPC.syncDisable, () => sync.disable())
  handle(IPC.syncNow, async () => {
    await sync.syncNow()
    return sync.status()
  })
  handle(IPC.lockState, () => appLock.state())
  handle(IPC.lockUnlock, (_e, code: unknown) => appLock.unlock(code))
  handle(IPC.lockNow, () => appLock.lock())
  handle(IPC.lockEnable, (_e, code: unknown) => appLock.enable(code))
  handle(IPC.lockChange, (_e, oldCode: unknown, code: unknown) => appLock.change(oldCode, code))
  handle(IPC.lockDisable, (_e, code: unknown) => appLock.disable(code))
  handle(IPC.lockAutoLock, (_e, minutes: unknown) => appLock.setAutoLock(Number(minutes) || 0))
  handle(IPC.lockReset, () =>
    appLock.reset(async () => {
      for (const account of [...storage.accounts]) await manager.remove(account.id).catch((err) => log('[lock] sign out failed', (err as Error).message))
    })
  )
  handle(IPC.laterSnooze, (_e, id: string, until: number) => later!.snooze(String(id), Number(until)))
  handle(IPC.laterUnsnooze, (_e, id: string) => later!.unsnooze(String(id)))
  handle(IPC.laterFollow, (_e, id: string, until: number) => later!.follow(String(id), Number(until)))
  handle(IPC.laterUnfollow, (_e, id: string) => later!.unfollow(String(id)))
  handle(IPC.laterSeen, (_e, id: string) => later!.seen(String(id)))
  handle(IPC.scheduledAdd, (_e, input: { conversationId: string; text: string; sendAt: number; replyToId?: string }) => scheduler.add(input))
  handle(IPC.scheduledCancel, (_e, id: string) => scheduler.cancel(id))
  handle(IPC.scheduledSendNow, (_e, id: string) => scheduler.sendNow(id))
  handle(IPC.scheduledReschedule, (_e, id: string, sendAt: number) => scheduler.reschedule(id, sendAt))
  handle(IPC.appOpenExternal, (_e, url: unknown) => {
    const safe = externalUrl(url)
    if (!safe) throw new Error('This link cannot be opened')
    return shell.openExternal(safe)
  })
  handle(IPC.appPickFiles, () => pickFiles())
  handle(IPC.appSticker, (_e, id: string) => stickerFile(id))
  handle(IPC.insightsRecords, () => manager.insightRecords())
  handle(IPC.insightsBackfill, (_e, days: number) => manager.backfillInsights(Math.max(1, Math.min(365, Number(days) || 30))))
  handle(IPC.insightsShare, (_e, card: ShareCardData) => shareCard(card))
  handle(IPC.insightsShareData, () => sharing?.card)
  on(IPC.insightsShareReady, () => sharing?.ready())
  handle(IPC.appSaveImage, (_e, bytes: Uint8Array, mime: string, name?: string) => saveImage(bytes, String(mime ?? ''), name))
  handle(IPC.appSaveMedia, (_e, url: string, name?: string) => saveMedia(String(url ?? ''), typeof name === 'string' ? name : undefined))
  // The photo editor draws on a canvas; remote images would taint it, so it gets the bytes as a data URL.
  handle(IPC.appMediaData, async (_e, url: string) => {
    const { data, type } = await mediaBytes(String(url ?? ''))
    if (data.length > 80 * 1024 * 1024) throw new Error('This image is too large to edit')
    const mime = type.startsWith('image/') ? type : 'image/png'
    return `data:${mime};base64,${data.toString('base64')}`
  })
  on(IPC.appEditorKeys, (_e, on: unknown) => {
    editorKeys = on === true
  })
  handle(IPC.appCopyImage, async (_e, bytes: Uint8Array) => {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (image.isEmpty()) throw new Error('Could not copy this image')
    // Electron 44's clipboard follows the W3C API: one item carrying the picture as a PNG blob.
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
  })
  handle(IPC.appDownloadFolder, async () => {
    const path = await downloadDir()
    const home = app.getPath('home')
    return { path, label: path.startsWith(home) ? '~' + path.slice(home.length) : path, custom: path !== app.getPath('downloads') }
  })
  handle(IPC.appPickDownloadFolder, async () => {
    const options: Electron.OpenDialogOptions = { defaultPath: await downloadDir(), properties: ['openDirectory', 'createDirectory'] }
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return picked.canceled ? undefined : picked.filePaths[0]
  })
  handle(IPC.appOpenDownloadFolder, async () => {
    await shell.openPath(await downloadDir())
  })
  handle(IPC.stickersList, () => listStickers())
  handle(IPC.stickersPick, async () => {
    const picked = await pickStickerSource(window)
    if (picked) grantFile(picked.path)
    return picked
  })
  handle(IPC.stickersAdd, (_e, path: string, cutout: boolean | 'precise', name?: string) => {
    if (!fileAllowed(path)) throw new Error('This file cannot be used here')
    return addSticker(String(path), cutout ? (png) => cutOut(png, cutout === 'precise') : undefined, typeof name === 'string' ? name : undefined)
  })
  handle(IPC.stickersFromFile, (_e, path: string) => {
    if (!fileAllowed(path)) throw new Error('This file cannot be used here')
    return describeSource(String(path))
  })
  handle(IPC.stickersFromBytes, (_e, bytes: Uint8Array, mime: string) => sourceFromBytes(bytes, String(mime ?? '')))
  handle(IPC.stickersSource, (_e, id: string) => stickerSource(String(id)))
  handle(IPC.stickersRename, (_e, id: string, name: string) => renameSticker(String(id), String(name ?? '')))
  handle(IPC.stickersRemove, (_e, id: string) => removeSticker(String(id)))
  handle(IPC.appLegal, (_e, name: string) => {
    const file = LEGAL_DOCS[name as keyof typeof LEGAL_DOCS]
    if (!file) throw new Error('Unknown document')
    const dir = app.isPackaged ? join(process.resourcesPath, 'legal') : join(__dirname, '../../resources/legal')
    // The GPL text lives at the repository root; the build copies it next to the other documents.
    const path = name === 'license' && !app.isPackaged ? join(__dirname, '../../LICENSE') : join(dir, file)
    return readFile(path, 'utf8')
  })
  handle(IPC.appGifSearch, (_e, query: string, page: number) => {
    const { gif, language } = storage.settings
    // The user's own key wins; otherwise the key built into this release (if any).
    const provider = gif?.key ? gif.provider : BUILT_IN_GIF.provider
    const key = gif?.key || BUILT_IN_GIF.key
    return searchGifs(provider, key, String(query ?? '').slice(0, 100), Math.max(1, Math.min(50, Number(page) || 1)), language)
  })
  handle(IPC.appStickerSearch, (_e, query: string, page: number) =>
    searchStickers(giphyKey(), String(query ?? '').slice(0, 100), Math.max(1, Math.min(50, Number(page) || 1)), storage.settings.language)
  )
  handle(IPC.appGifDefault, () => (BUILT_IN_GIF.key ? BUILT_IN_GIF.provider : null))
  handle(IPC.appGif, (_e, item: GifItem) => gifFile(item))
  handle(IPC.appSaveVoice, (_e, bytes: Uint8Array, duration: number, aac?: Uint8Array) => saveVoice(bytes, duration, aac))
  // No location lookup unless the person turned the weather on.
  handle(IPC.appWeather, (_e, force?: boolean) => (storage.settings.greetings && storage.settings.weather ? getWeather(!!force) : undefined))
  on(IPC.appSetBadge, (_e, count: unknown) => {
    // Dock badge on macOS (taskbar overlay on Windows); the renderer already leaves out muted chats.
    app.setBadgeCount(Math.max(0, Math.min(9999, Math.floor(Number(count) || 0))))
  })
  on(IPC.appWindowAction, (_e, action: 'minimize' | 'maximize' | 'close') => {
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
    if (app.isReady()) showMain()
  })

  app.whenReady().then(async () => {
    if (isWindows) app.setAppUserModelId('com.danenguyen.moshi')
    await storage.load()
    // Before any window exists: a locked Moshi must open locked.
    await appLock.load()
    appLock.start()
    storage.onSettingsChanged((before, after) => {
      if (!!before.hideFromScreenShare !== !!after.hideFromScreenShare) window?.setContentProtection(!!after.hideFromScreenShare)
    })
    await pruneOrphanedSettings()
    await sync.start()
    void scheduler.start()
    reminders.start()
    later.start()
    birthdays.start()
    void pruneSafetyCopies()
    void prunePreviews()
    // Scratch files (converted GIFs and stickers, pasted and opened files, recordings) older than a week, now and daily.
    const tidyTemp = (): void => void pruneTemp(app.getPath('temp'), 7 * 24 * 3600_000).then((n) => n && log('temp files removed:', n))
    setTimeout(tidyTemp, 60_000).unref()
    setInterval(tidyTemp, 24 * 3600_000).unref()
    nativeTheme.themeSource = storage.settings.theme
    nativeTheme.on('updated', () => applyTheme(storage.settings.theme))
    hardenSession()
    registerImageProxy()
    registerMediaProxy()
    registerIpc()
    installMenu()
    createWindow()
    await manager.restore()
    void updater.start()

    app.on('activate', showMain)
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    updater.stop()
    scheduler.stop()
    later?.stop()
    appLock.stop()
    birthdays.stop()
    sync.stop()
    ai.stop()
    void manager.shutdown()
  })
}
