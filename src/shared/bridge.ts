import type { AiKind, AiStatus, SpeakLang } from './ai'
import type { ChatLine } from './ai-prompts'
import type { InsightRecord, ShareCardData } from './insights'

/** A sticker the user made (see main/stickers.ts). */
export interface CustomSticker {
  id: string
  name: string
  mime: string
  animated: boolean
  createdAt: number
  url: string
}
import type {
  Account,
  AddAccountInput,
  BridgeEvent,
  Contact,
  Conversation,
  ConversationStats,
  Message,
  PageOption,
  Platform,
  OutgoingAttachment,
  PeerProfile,
  SearchHit,
  SharedKind,
  SendOptions,
  Settings,
  WeatherInfo,
  BackupInfo,
  SyncStatus,
  GifItem,
  GifPage,
  GifProvider,
  UpdateState
} from './types'

/** The API exposed to the renderer through the preload script. */
export interface MoshiBridge {
  accounts: {
    list(): Promise<Account[]>
    add(input: AddAccountInput): Promise<Account>
    remove(accountId: string): Promise<void>
    reconnect(accountId: string): Promise<void>
    addDemo(): Promise<Account[]>
    /**
     * Open the platform's own login page in an app window and turn the
     * resulting session into an account (personal Facebook / Instagram).
     */
    connectWeb(platform: Extract<Platform, 'messenger' | 'instagram'>): Promise<Account>
    /** Facebook Login (OAuth) with the user's app id; resolves with the Pages they manage. */
    listPages(appId: string): Promise<PageOption[]>
    /** Turn picked Pages (and linked Instagram accounts) into accounts. */
    addPages(pages: PageOption[], includeInstagram: boolean): Promise<Account[]>
  }
  contacts: {
    /** People across every connected account, optionally filtered by name or handle. */
    list(query: string): Promise<Contact[]>
    /** Open (or create) the direct conversation with a contact. */
    open(accountId: string, peerId: string): Promise<Conversation>
  }
  conversations: {
    list(): Promise<Conversation[]>
    markRead(conversationId: string): Promise<void>
    /** Accept a message request on the platform (where it has that step). */
    acceptRequest(conversationId: string): Promise<void>
    /** Profile of the other side (or the group). */
    profile(conversationId: string): Promise<PeerProfile | undefined>
    /** Messages carrying photos/videos, links or files, newest first. */
    shared(conversationId: string, kind: SharedKind): Promise<Message[]>
    /** Search inside one conversation, newest first. */
    searchIn(conversationId: string, query: string): Promise<Message[]>
    /** Talking since / message count / last activity. */
    stats(conversationId: string): Promise<ConversationStats>
  }
  messages: {
    list(conversationId: string, beforeId?: string): Promise<Message[]>
    send(conversationId: string, text: string, options?: SendOptions): Promise<Message>
    forward(fromConversationId: string, messageId: string, toConversationId: string): Promise<Message>
    react(conversationId: string, messageId: string, emoji: string): Promise<void>
    /** Take one of my messages back for everyone (where the platform allows it). */
    unsend(conversationId: string, messageId: string): Promise<void>
    search(query: string): Promise<SearchHit[]>
    /** Fetch the full media of an attachment on demand. Resolves to a data URL, or undefined when unavailable. */
    loadAttachment(conversationId: string, messageId: string, attachmentId: string): Promise<string | undefined>
    /** Open an attachment with the OS (downloads it first when needed). */
    openAttachment(conversationId: string, messageId: string, attachmentId: string): Promise<void>
    typing(conversationId: string): Promise<void>
  }
  auth: {
    respond(requestId: string, value: string): Promise<void>
    cancel(requestId: string): Promise<void>
  }
  ai: {
    status(): Promise<AiStatus>
    /** Download (first time) and load a model; progress arrives as ai:progress events. */
    prepare(kind: AiKind, speakLang?: SpeakLang): Promise<boolean>
    /** PCM audio for a text, from the on-device reading voice of that language. */
    speak(text: string, speakLang: SpeakLang): Promise<{ audio: Float32Array; rate: number }>
    remove(kind: AiKind): Promise<void>
    /** Raw bytes of a voice note (decoded to 16 kHz in the renderer). */
    readMedia(url: string): Promise<Uint8Array>
    /** `language`: ISO code of what is probably spoken (Whisper otherwise assumes English). */
    transcribe(key: string, pcm: Float32Array, language?: string): Promise<string>
    translate(key: string, text: string): Promise<{ text: string; from: string; same?: boolean }>
    /** Translate typed text into `target` (ISO code) before sending. */
    translateTo(text: string, target: string): Promise<{ text: string; from: string; same?: boolean }>
    cached(): Promise<{ transcripts: Record<string, string>; translations: Record<string, string>; summaries: Record<string, string> }>
    /** Bullet points about these lines (cached by `key`). */
    summarize(key: string, lines: ChatLine[]): Promise<string[]>
    /** Three short replies to the newest line. */
    suggest(lines: ChatLine[]): Promise<string[]>
  }
  insights: {
    /** Walk the last `days` days of every active chat into the insight store (progress arrives as insights:progress events). */
    backfill(days: number): Promise<void>
    /** Light records of the messages on this computer, for insights and memories. */
    records(): Promise<InsightRecord[]>
    /** Draws the 9:16 share image off screen, saves it (download folder) and copies it; resolves with where it went. */
    share(card: ShareCardData): Promise<{ path?: string }>
    /** In the share window only: the card to draw, and the signal that it has finished drawing. */
    shareData(): Promise<ShareCardData | undefined>
    shareReady(): void
  }
  stickers: {
    /** The user's own stickers, image inline as a data URL, newest first. */
    list(): Promise<CustomSticker[]>
    /** Ask for an image file; null when cancelled. */
    pick(): Promise<{ path: string; animated: boolean; name: string } | null>
    /** Add it (cut the background out of still images when asked). */
    add(path: string, cutout: boolean): Promise<CustomSticker>
    remove(id: string): Promise<void>
  }
  backup: {
    /** Ask where to save, then write an encrypted backup. Null when the user cancels. */
    create(input: { password: string; includeSessions: boolean }): Promise<{ path: string; bytes: number } | null>
    /** Pick a backup file and read its header. Null when the user cancels. */
    pick(): Promise<BackupInfo | null>
    /** Replace this device's data with the backup, then Moshi restarts. Rejects with BACKUP_PASSWORD on a wrong password. */
    restore(input: { path: string; password: string }): Promise<void>
    reveal(path: string): Promise<void>
  }
  sync: {
    status(): Promise<SyncStatus>
    /** Ask for a folder a cloud drive syncs (OneDrive, Google Drive, Dropbox...) and start syncing there. Null when cancelled. */
    choose(): Promise<SyncStatus | null>
    disable(): Promise<SyncStatus>
    now(): Promise<SyncStatus>
  }
  scheduled: {
    add(input: { conversationId: string; text: string; sendAt: number; replyToId?: string }): Promise<Settings>
    cancel(id: string): Promise<Settings>
    sendNow(id: string): Promise<Settings>
    reschedule(id: string, sendAt: number): Promise<Settings>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  update: {
    state(): Promise<UpdateState>
    /** Ask GitHub Releases now (background checks run on their own). */
    check(): Promise<void>
    /** Download the new version, or open the download page when this build cannot install itself. */
    download(): Promise<void>
    /** Quit and install a downloaded update. */
    install(): void
  }
  app: {
    openExternal(url: string): Promise<void>
    /** A bundled legal document (Markdown): terms, privacy policy or third-party notices. */
    legal(name: 'notice' | 'license' | 'terms' | 'privacy' | 'credits'): Promise<string>
    pickFiles(): Promise<OutgoingAttachment[]>
    /** Resolve a dropped or pasted File to an OutgoingAttachment (the path is only known in the preload). */
    describeFile(file: File): OutgoingAttachment
    /** Persist a recorded voice note (WebM/Opus from MediaRecorder) as an OGG/Opus file ready to send. */
    saveVoice(bytes: Uint8Array, durationSeconds: number, aac?: Uint8Array): Promise<OutgoingAttachment>
    /** An image pasted from the clipboard (no file behind it yet): written to a temp file, ready to send. */
    saveImage(bytes: Uint8Array, mime: string, name?: string): Promise<OutgoingAttachment>
    /** Save a photo or video shown in the app to a place the user picks; the path, or undefined if cancelled. */
    saveMedia(url: string, name?: string): Promise<string | undefined>
    /** The folder Download saves into, with a short label for Settings (~ for the home folder). */
    downloadFolder(): Promise<{ path: string; label: string; custom: boolean }>
    /** Let the user choose a folder; its path, or undefined if cancelled. */
    pickDownloadFolder(): Promise<string | undefined>
    openDownloadFolder(): Promise<void>
    /** A photo shown in the app as a data URL (the editor needs the bytes, not a cross-origin link). */
    mediaData(url: string): Promise<string>
    copyImage(bytes: Uint8Array): Promise<void>
    /** While true, ⌘Z/⌘C/⌘S/⌘W/⌘↵ go to the photo editor instead of the menu. */
    setEditorKeys(on: boolean): void
    /** A Moshi sticker as a ready-to-send image file. */
    sticker(id: string): Promise<OutgoingAttachment>
    /** GIF search (trending when the query is empty); rejects with GIF_KEY when no valid key is set. */
    gifSearch(query: string, page: number): Promise<GifPage>
    /** Download a picked GIF as a ready-to-send file. */
    gif(item: GifItem): Promise<OutgoingAttachment>
    /** The GIF library whose key is built into this release, or null when users must bring their own. */
    gifDefault(): Promise<GifProvider | null>
    /** Local weather for the greeting line; undefined when offline. */
    weather(force?: boolean): Promise<WeatherInfo | undefined>
    platform: NodeJS.Platform
    version(): Promise<string>
    windowAction(action: 'minimize' | 'maximize' | 'close'): void
    /** Unread count on the Dock icon (macOS) or taskbar (Windows); 0 clears it. */
    setBadge(count: number): void
  }
  onEvent(listener: (event: BridgeEvent) => void): () => void
}

export const IPC = {
  accountsList: 'accounts:list',
  accountsAdd: 'accounts:add',
  accountsRemove: 'accounts:remove',
  accountsReconnect: 'accounts:reconnect',
  accountsAddDemo: 'accounts:addDemo',
  accountsConnectWeb: 'accounts:connectWeb',
  accountsListPages: 'accounts:listPages',
  accountsAddPages: 'accounts:addPages',
  contactsList: 'contacts:list',
  contactsOpen: 'contacts:open',
  conversationsList: 'conversations:list',
  conversationsMarkRead: 'conversations:markRead',
  conversationsAcceptRequest: 'conversations:acceptRequest',
  conversationsProfile: 'conversations:profile',
  conversationsShared: 'conversations:shared',
  conversationsSearchIn: 'conversations:searchIn',
  conversationsStats: 'conversations:stats',
  messagesList: 'messages:list',
  messagesSend: 'messages:send',
  messagesForward: 'messages:forward',
  messagesReact: 'messages:react',
  messagesUnsend: 'messages:unsend',
  messagesSearch: 'messages:search',
  messagesLoadAttachment: 'messages:loadAttachment',
  messagesOpenAttachment: 'messages:openAttachment',
  messagesTyping: 'messages:typing',
  authRespond: 'auth:respond',
  authCancel: 'auth:cancel',
  aiStatus: 'ai:status',
  aiPrepare: 'ai:prepare',
  aiRemove: 'ai:remove',
  aiReadMedia: 'ai:readMedia',
  aiTranscribe: 'ai:transcribe',
  aiTranslate: 'ai:translate',
  aiTranslateTo: 'ai:translateTo',
  aiCached: 'ai:cached',
  aiSummarize: 'ai:summarize',
  aiSuggest: 'ai:suggest',
  aiSpeak: 'ai:speak',
  backupCreate: 'backup:create',
  backupPick: 'backup:pick',
  backupRestore: 'backup:restore',
  backupReveal: 'backup:reveal',
  syncStatus: 'sync:status',
  syncChoose: 'sync:choose',
  syncDisable: 'sync:disable',
  syncNow: 'sync:now',
  scheduledAdd: 'scheduled:add',
  scheduledCancel: 'scheduled:cancel',
  scheduledSendNow: 'scheduled:sendNow',
  scheduledReschedule: 'scheduled:reschedule',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appOpenExternal: 'app:openExternal',
  appLegal: 'app:legal',
  appPickFiles: 'app:pickFiles',
  appSaveVoice: 'app:saveVoice',
  appSticker: 'app:sticker',
  insightsRecords: 'insights:records',
  insightsBackfill: 'insights:backfill',
  insightsShare: 'insights:share',
  insightsShareData: 'insights:shareData',
  insightsShareReady: 'insights:shareReady',
  appSaveImage: 'app:saveImage',
  appSaveMedia: 'app:saveMedia',
  appDownloadFolder: 'app:downloadFolder',
  appPickDownloadFolder: 'app:pickDownloadFolder',
  appOpenDownloadFolder: 'app:openDownloadFolder',
  appMediaData: 'app:mediaData',
  appCopyImage: 'app:copyImage',
  appEditorKeys: 'app:editorKeys',
  stickersList: 'stickers:list',
  stickersPick: 'stickers:pick',
  stickersAdd: 'stickers:add',
  stickersRemove: 'stickers:remove',
  appGifSearch: 'app:gifSearch',
  appGif: 'app:gif',
  appGifDefault: 'app:gifDefault',
  appWeather: 'app:weather',
  appWindowAction: 'app:windowAction',
  appSetBadge: 'app:setBadge',
  appVersion: 'app:version',
  updateState: 'update:state',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  event: 'bridge:event'
} as const
