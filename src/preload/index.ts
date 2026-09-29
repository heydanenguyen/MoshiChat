import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MoshiBridge } from '@shared/bridge'
import { IPC } from '@shared/bridge'
import type { BridgeEvent } from '@shared/types'

const bridge: MoshiBridge = {
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
  ai: {
    status: () => ipcRenderer.invoke(IPC.aiStatus),
    prepare: (kind, speakLang) => ipcRenderer.invoke(IPC.aiPrepare, kind, speakLang),
    speak: (text, speakLang) => ipcRenderer.invoke(IPC.aiSpeak, text, speakLang),
    remove: (kind) => ipcRenderer.invoke(IPC.aiRemove, kind),
    readMedia: (url) => ipcRenderer.invoke(IPC.aiReadMedia, url),
    transcribe: (key, pcm, language) => ipcRenderer.invoke(IPC.aiTranscribe, key, pcm, language),
    translate: (key, text) => ipcRenderer.invoke(IPC.aiTranslate, key, text),
    cached: () => ipcRenderer.invoke(IPC.aiCached),
    summarize: (key, lines) => ipcRenderer.invoke(IPC.aiSummarize, key, lines),
    suggest: (lines) => ipcRenderer.invoke(IPC.aiSuggest, lines)
  },
  insights: {
    backfill: (days) => ipcRenderer.invoke(IPC.insightsBackfill, days),
    records: () => ipcRenderer.invoke(IPC.insightsRecords)
  },
  stickers: {
    list: () => ipcRenderer.invoke(IPC.stickersList),
    pick: () => ipcRenderer.invoke(IPC.stickersPick),
    add: (path, cutout) => ipcRenderer.invoke(IPC.stickersAdd, path, cutout),
    remove: (id) => ipcRenderer.invoke(IPC.stickersRemove, id)
  },
  backup: {
    create: (input) => ipcRenderer.invoke(IPC.backupCreate, input),
    pick: () => ipcRenderer.invoke(IPC.backupPick),
    restore: (input) => ipcRenderer.invoke(IPC.backupRestore, input),
    reveal: (path) => ipcRenderer.invoke(IPC.backupReveal, path)
  },
  scheduled: {
    add: (input) => ipcRenderer.invoke(IPC.scheduledAdd, input),
    cancel: (id) => ipcRenderer.invoke(IPC.scheduledCancel, id),
    sendNow: (id) => ipcRenderer.invoke(IPC.scheduledSendNow, id),
    reschedule: (id, sendAt) => ipcRenderer.invoke(IPC.scheduledReschedule, id, sendAt)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  update: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    install: () => ipcRenderer.send(IPC.updateInstall)
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    legal: (name) => ipcRenderer.invoke(IPC.appLegal, name),
    pickFiles: () => ipcRenderer.invoke(IPC.appPickFiles),
    describeFile: (file) => ({
      path: webUtils.getPathForFile(file),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size
    }),
    saveVoice: (bytes, durationSeconds, aac) => ipcRenderer.invoke(IPC.appSaveVoice, bytes, durationSeconds, aac),
    saveImage: (bytes, mime, name) => ipcRenderer.invoke(IPC.appSaveImage, bytes, mime, name),
    sticker: (id) => ipcRenderer.invoke(IPC.appSticker, id),
    gifSearch: (query, page) => ipcRenderer.invoke(IPC.appGifSearch, query, page),
    gif: (item) => ipcRenderer.invoke(IPC.appGif, item),
    gifDefault: () => ipcRenderer.invoke(IPC.appGifDefault),
    weather: (force) => ipcRenderer.invoke(IPC.appWeather, force),
    platform: process.platform,
    version: () => ipcRenderer.invoke(IPC.appVersion),
    windowAction: (action) => ipcRenderer.send(IPC.appWindowAction, action),
    setBadge: (count) => ipcRenderer.send(IPC.appSetBadge, count)
  },
  onEvent: (listener) => {
    const handler = (_event: unknown, payload: BridgeEvent): void => listener(payload)
    ipcRenderer.on(IPC.event, handler)
    return () => ipcRenderer.removeListener(IPC.event, handler)
  }
}

contextBridge.exposeInMainWorld('unison', bridge)
