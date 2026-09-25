import type {
  Account,
  AddAccountInput,
  BridgeEvent,
  Conversation,
  Message,
  OutgoingAttachment,
  SearchHit,
  SendOptions,
  Settings
} from './types'

/** The API exposed to the renderer through the preload script. */
export interface UnisonBridge {
  accounts: {
    list(): Promise<Account[]>
    add(input: AddAccountInput): Promise<Account>
    remove(accountId: string): Promise<void>
    reconnect(accountId: string): Promise<void>
    addDemo(): Promise<Account[]>
  }
  conversations: {
    list(): Promise<Conversation[]>
    markRead(conversationId: string): Promise<void>
  }
  messages: {
    list(conversationId: string, beforeId?: string): Promise<Message[]>
    send(conversationId: string, text: string, options?: SendOptions): Promise<Message>
    react(conversationId: string, messageId: string, emoji: string): Promise<void>
    search(query: string): Promise<SearchHit[]>
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
  conversationsList: 'conversations:list',
  conversationsMarkRead: 'conversations:markRead',
  messagesList: 'messages:list',
  messagesSend: 'messages:send',
  messagesReact: 'messages:react',
  messagesSearch: 'messages:search',
  messagesTyping: 'messages:typing',
  authRespond: 'auth:respond',
  authCancel: 'auth:cancel',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appOpenExternal: 'app:openExternal',
  appPickFiles: 'app:pickFiles',
  appWindowAction: 'app:windowAction',
  event: 'bridge:event'
} as const
