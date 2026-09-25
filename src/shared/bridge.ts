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
  WeatherInfo
} from './types'

/** The API exposed to the renderer through the preload script. */
export interface UnisonBridge {
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
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  app: {
    openExternal(url: string): Promise<void>
    pickFiles(): Promise<OutgoingAttachment[]>
    /** Resolve a dropped or pasted File to an OutgoingAttachment (the path is only known in the preload). */
    describeFile(file: File): OutgoingAttachment
    /** Persist a recorded voice note (WebM/Opus from MediaRecorder) as an OGG/Opus file ready to send. */
    saveVoice(bytes: Uint8Array, durationSeconds: number): Promise<OutgoingAttachment>
    /** Local weather for the greeting line; undefined when offline. */
    weather(force?: boolean): Promise<WeatherInfo | undefined>
    platform: NodeJS.Platform
    windowAction(action: 'minimize' | 'maximize' | 'close'): void
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
  conversationsProfile: 'conversations:profile',
  conversationsShared: 'conversations:shared',
  conversationsSearchIn: 'conversations:searchIn',
  conversationsStats: 'conversations:stats',
  messagesList: 'messages:list',
  messagesSend: 'messages:send',
  messagesForward: 'messages:forward',
  messagesReact: 'messages:react',
  messagesSearch: 'messages:search',
  messagesLoadAttachment: 'messages:loadAttachment',
  messagesOpenAttachment: 'messages:openAttachment',
  messagesTyping: 'messages:typing',
  authRespond: 'auth:respond',
  authCancel: 'auth:cancel',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appOpenExternal: 'app:openExternal',
  appPickFiles: 'app:pickFiles',
  appSaveVoice: 'app:saveVoice',
  appWeather: 'app:weather',
  appWindowAction: 'app:windowAction',
  event: 'bridge:event'
} as const
