import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { UnisonBridge } from '@shared/bridge'
import { IPC } from '@shared/bridge'
import type { BridgeEvent } from '@shared/types'

const bridge: UnisonBridge = {
  accounts: {
    list: () => ipcRenderer.invoke(IPC.accountsList),
    add: (input) => ipcRenderer.invoke(IPC.accountsAdd, input),
    remove: (id) => ipcRenderer.invoke(IPC.accountsRemove, id),
    reconnect: (id) => ipcRenderer.invoke(IPC.accountsReconnect, id),
    addDemo: () => ipcRenderer.invoke(IPC.accountsAddDemo),
    connectWeb: (platform) => ipcRenderer.invoke(IPC.accountsConnectWeb, platform),
    listPages: (appId) => ipcRenderer.invoke(IPC.accountsListPages, appId),
    addPages: (pages, includeInstagram) => ipcRenderer.invoke(IPC.accountsAddPages, pages, includeInstagram)
  },
  contacts: {
    list: (query) => ipcRenderer.invoke(IPC.contactsList, query),
    open: (accountId, peerId) => ipcRenderer.invoke(IPC.contactsOpen, accountId, peerId)
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC.conversationsList),
    markRead: (id) => ipcRenderer.invoke(IPC.conversationsMarkRead, id),
    profile: (id) => ipcRenderer.invoke(IPC.conversationsProfile, id),
    shared: (id, kind) => ipcRenderer.invoke(IPC.conversationsShared, id, kind),
    searchIn: (id, query) => ipcRenderer.invoke(IPC.conversationsSearchIn, id, query),
    stats: (id) => ipcRenderer.invoke(IPC.conversationsStats, id)
  },
  messages: {
    list: (id, beforeId) => ipcRenderer.invoke(IPC.messagesList, id, beforeId),
    send: (id, text, options) => ipcRenderer.invoke(IPC.messagesSend, id, text, options),
    forward: (fromId, messageId, toId) => ipcRenderer.invoke(IPC.messagesForward, fromId, messageId, toId),
    react: (id, messageId, emoji) => ipcRenderer.invoke(IPC.messagesReact, id, messageId, emoji),
    search: (query) => ipcRenderer.invoke(IPC.messagesSearch, query),
    loadAttachment: (id, messageId, attachmentId) => ipcRenderer.invoke(IPC.messagesLoadAttachment, id, messageId, attachmentId),
    openAttachment: (id, messageId, attachmentId) => ipcRenderer.invoke(IPC.messagesOpenAttachment, id, messageId, attachmentId),
    typing: (id) => ipcRenderer.invoke(IPC.messagesTyping, id)
  },
  auth: {
    respond: (requestId, value) => ipcRenderer.invoke(IPC.authRespond, requestId, value),
    cancel: (requestId) => ipcRenderer.invoke(IPC.authCancel, requestId)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    pickFiles: () => ipcRenderer.invoke(IPC.appPickFiles),
    describeFile: (file) => ({
      path: webUtils.getPathForFile(file),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size
    }),
    saveVoice: (bytes, durationSeconds) => ipcRenderer.invoke(IPC.appSaveVoice, bytes, durationSeconds),
    platform: process.platform,
    windowAction: (action) => ipcRenderer.send(IPC.appWindowAction, action)
  },
  onEvent: (listener) => {
    const handler = (_event: unknown, payload: BridgeEvent): void => listener(payload)
    ipcRenderer.on(IPC.event, handler)
    return () => ipcRenderer.removeListener(IPC.event, handler)
  }
}

contextBridge.exposeInMainWorld('unison', bridge)
