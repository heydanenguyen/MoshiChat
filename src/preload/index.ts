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
    syncHistory: (id) => ipcRenderer.invoke(IPC.accountsSyncHistory, id),
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
    acceptRequest: (id) => ipcRenderer.invoke(IPC.conversationsAcceptRequest, id),
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
    unsend: (id, messageId) => ipcRenderer.invoke(IPC.messagesUnsend, id, messageId),
    search: (query) => ipcRenderer.invoke(IPC.messagesSearch, query),
    loadAttachment: (id, messageId, attachmentId) => ipcRenderer.invoke(IPC.messagesLoadAttachment, id, messageId, attachmentId),
    openAttachment: (id, messageId, attachmentId) => ipcRenderer.invoke(IPC.messagesOpenAttachment, id, messageId, attachmentId),
    typing: (id) => ipcRenderer.invoke(IPC.messagesTyping, id)
  },
  auth: {
    respond: (requestId, value) => ipcRenderer.invoke(IPC.authRespond, requestId, value),
    cancel: (requestId) => ipcRenderer.invoke(IPC.authCancel, requestId),
    pending: () => ipcRenderer.invoke(IPC.authPending)
  },
  ai: {
    status: () => ipcRenderer.invoke(IPC.aiStatus),
    hardware: () => ipcRenderer.invoke(IPC.aiHardware),
    prepare: (kind, speakLang) => ipcRenderer.invoke(IPC.aiPrepare, kind, speakLang),
    speak: (text, speakLang) => ipcRenderer.invoke(IPC.aiSpeak, text, speakLang),
    remove: (kind) => ipcRenderer.invoke(IPC.aiRemove, kind),
    readMedia: (url) => ipcRenderer.invoke(IPC.aiReadMedia, url),
    transcribe: (key, pcm, language) => ipcRenderer.invoke(IPC.aiTranscribe, key, pcm, language),
    translate: (key, text) => ipcRenderer.invoke(IPC.aiTranslate, key, text),
    translateTo: (text, target) => ipcRenderer.invoke(IPC.aiTranslateTo, text, target),
    cached: () => ipcRenderer.invoke(IPC.aiCached),
    summarize: (key, lines) => ipcRenderer.invoke(IPC.aiSummarize, key, lines),
    suggest: (lines, context, auto) => ipcRenderer.invoke(IPC.aiSuggest, lines, context, auto),
    opener: (lines, silentDays, note, context) => ipcRenderer.invoke(IPC.aiOpener, lines, silentDays, note, context),
    warm: () => ipcRenderer.invoke(IPC.aiWarm),
    voiceInfo: () => ipcRenderer.invoke(IPC.aiVoiceInfo),
    voiceExport: () => ipcRenderer.invoke(IPC.aiVoiceExport),
    voiceInstall: () => ipcRenderer.invoke(IPC.aiVoiceInstall),
    voiceRemove: () => ipcRenderer.invoke(IPC.aiVoiceRemove)
  },
  insights: {
    backfill: (days) => ipcRenderer.invoke(IPC.insightsBackfill, days),
    records: () => ipcRenderer.invoke(IPC.insightsRecords),
    share: (card) => ipcRenderer.invoke(IPC.insightsShare, card),
    shareData: () => ipcRenderer.invoke(IPC.insightsShareData),
    shareReady: () => ipcRenderer.send(IPC.insightsShareReady)
  },
  stickers: {
    list: () => ipcRenderer.invoke(IPC.stickersList),
    pick: () => ipcRenderer.invoke(IPC.stickersPick),
    add: (path, cutout, name) => ipcRenderer.invoke(IPC.stickersAdd, path, cutout, name),
    fromFile: (path) => ipcRenderer.invoke(IPC.stickersFromFile, path),
    fromBytes: (bytes, mime) => ipcRenderer.invoke(IPC.stickersFromBytes, bytes, mime),
    source: (id) => ipcRenderer.invoke(IPC.stickersSource, id),
    rename: (id, name) => ipcRenderer.invoke(IPC.stickersRename, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.stickersRemove, id)
  },
  backup: {
    create: (input) => ipcRenderer.invoke(IPC.backupCreate, input),
    pick: () => ipcRenderer.invoke(IPC.backupPick),
    restore: (input) => ipcRenderer.invoke(IPC.backupRestore, input),
    reveal: (path) => ipcRenderer.invoke(IPC.backupReveal, path)
  },
  zaloShare: {
    status: () => ipcRenderer.invoke(IPC.zaloShareStatus),
    enable: (passphrase) => ipcRenderer.invoke(IPC.zaloShareEnable, passphrase),
    disable: () => ipcRenderer.invoke(IPC.zaloShareDisable)
  },
  sync: {
    status: () => ipcRenderer.invoke(IPC.syncStatus),
    choose: () => ipcRenderer.invoke(IPC.syncChoose),
    disable: () => ipcRenderer.invoke(IPC.syncDisable),
    now: () => ipcRenderer.invoke(IPC.syncNow)
  },
  lock: {
    state: () => ipcRenderer.invoke(IPC.lockState),
    unlock: (code) => ipcRenderer.invoke(IPC.lockUnlock, code),
    lockNow: () => ipcRenderer.invoke(IPC.lockNow),
    enable: (code) => ipcRenderer.invoke(IPC.lockEnable, code),
    change: (oldCode, code) => ipcRenderer.invoke(IPC.lockChange, oldCode, code),
    disable: (code) => ipcRenderer.invoke(IPC.lockDisable, code),
    setAutoLock: (minutes) => ipcRenderer.invoke(IPC.lockAutoLock, minutes),
    reset: () => ipcRenderer.invoke(IPC.lockReset)
  },
  later: {
    snooze: (id, until) => ipcRenderer.invoke(IPC.laterSnooze, id, until),
    unsnooze: (id) => ipcRenderer.invoke(IPC.laterUnsnooze, id),
    follow: (id, until) => ipcRenderer.invoke(IPC.laterFollow, id, until),
    unfollow: (id) => ipcRenderer.invoke(IPC.laterUnfollow, id),
    seen: (id) => ipcRenderer.invoke(IPC.laterSeen, id)
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
    describeFile: (file) => {
      // A real path only exists for a file the person dropped, pasted or picked; main may then send it.
      const path = webUtils.getPathForFile(file)
      if (path) ipcRenderer.send(IPC.appGrantFile, path)
      return { path, name: file.name, mime: file.type || 'application/octet-stream', size: file.size }
    },
    saveVoice: (bytes, durationSeconds, aac) => ipcRenderer.invoke(IPC.appSaveVoice, bytes, durationSeconds, aac),
    saveImage: (bytes, mime, name) => ipcRenderer.invoke(IPC.appSaveImage, bytes, mime, name),
    saveMedia: (url, name) => ipcRenderer.invoke(IPC.appSaveMedia, url, name),
    downloadFolder: () => ipcRenderer.invoke(IPC.appDownloadFolder),
    pickDownloadFolder: () => ipcRenderer.invoke(IPC.appPickDownloadFolder),
    openDownloadFolder: () => ipcRenderer.invoke(IPC.appOpenDownloadFolder),
    mediaData: (url) => ipcRenderer.invoke(IPC.appMediaData, url),
    copyImage: (bytes) => ipcRenderer.invoke(IPC.appCopyImage, bytes),
    setEditorKeys: (on) => ipcRenderer.send(IPC.appEditorKeys, on),
    sticker: (id) => ipcRenderer.invoke(IPC.appSticker, id),
    gifSearch: (query, page) => ipcRenderer.invoke(IPC.appGifSearch, query, page),
    stickerSearch: (query, page) => ipcRenderer.invoke(IPC.appStickerSearch, query, page),
    stickerTray: (conversationId, query) => ipcRenderer.invoke(IPC.appStickerTray, conversationId, query),
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
