import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useVirtualizer } from '@tanstack/react-virtual'
import { isPendingRequest } from '@shared/inbox'
import { BellOff, Check, ChevronDown, ChevronLeft, Columns2, Copy, File, Forward, Info, Languages, ListTodo, MoreHorizontal, Pause, Play, Plus, Reply, SmilePlus, Sparkles, Undo2, UserRoundPlus, Volume2, X } from 'lucide-react'
import type { Account, Attachment, BubbleAction, Conversation, Message, Platform } from '@shared/types'
import { BUBBLE_ACTIONS } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { anchorFor, bubbleVarsOf, useSendVia, useShownConversations, useStore, useT, useThread } from '../store'
import { PlatformIcon } from './PlatformIcon'
import { formatBytes, formatDayLabel, formatTime, jumboEmojiCount, personLook, sectionize, tip, withStickers, type MessageGroup } from '../utils'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { EmptyState } from './EmptyState'
import { GoneMedia, LinkCard, PostCard, StoryRef, SystemRow, VideoThumb } from './MessageParts'
import { BuddyLoader } from './BuddyLoader'
import { BirthdayBanner, EffectLayer, ScheduledStrip, useMessageEffects } from './ChatExtras'
import { useWallpaper } from './Wallpaper'
import { SummaryButton, SummaryCard, TranslationBlock, VoiceTranscript } from './AiParts'
import { LaterButton } from './LaterPicker'
import { ReactionGrid, ReactionPill } from './ReactionPill'
import { imageSrc, mediaSrc, previewSrc } from '@shared/media'
import { useAccountLabels } from '../accountLabels'
import { estimateRun } from '../rowEstimate'
import { isFresh } from '../fresh'
import { giphyIdOf } from '@shared/giphy'
import { rememberGiphySticker } from '../giphyStickers'
import { ZALO_ALL, ZALO_QUICK } from '@shared/reactions'
import { TodoPicker } from './TodoSheet'
import { textKey, useAi } from '../aiStore'
import { EmojiPicker } from './EmojiPicker'
import { PictureArt, StickerArt } from './StickerPicker'
import { isStickerId } from '@shared/stickers'
import { isPictureStickerId } from '@shared/picture-packs'
import { matchSticker } from '../stickerMatch'
import { isSplit, type PaneIndex } from '../panes'
import { CONVERSATION_DRAG } from './ConversationList'
import { modKey } from '../utils'
import { useScrollFade } from '../scrollFade'
import { Presence } from './Presence'
import { usePresence } from '../usePresence'
import { withViewTransition } from '../viewTransition'

const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏']

/**
 * The chat cell of the app: one pane, or two side by side (split chat). A split is only shown when
 * the window is wide enough; otherwise the active pane stands in for it and the split is kept.
 * Dragging a chat from the list over the area shows two landing zones, left and right.
 */
export function ChatView(): JSX.Element {
  const t = useT()
  const layout = useStore((s) => s.layout)
  const shown = useShownConversations()
  // A pane may still hold a chat that has since been merged: show its person.
  const conversationFor = (id: string): Conversation | undefined => shown[id] ?? shown[anchorFor(useStore.getState(), id)]
  const canSplit = useStore((s) => s.wide && !s.narrow)
  const openInPane = useStore((s) => s.openInPane)
  const [dragOver, setDragOver] = useState<0 | 1 | undefined>()
  const dragDepth = useRef(0)
  const split = isSplit(layout) && canSplit

  const isChatDrag = (e: React.DragEvent): boolean => canSplit && e.dataTransfer.types.includes(CONVERSATION_DRAG)
  const zoneAt = (e: React.DragEvent): 0 | 1 => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? 0 : 1
  }

  let body: JSX.Element
  if (!split) {
    const id = layout.panes[layout.active]
    const conversation = id ? conversationFor(id) : undefined
    body = !id || !conversation ? <EmptyState kind="no-selection" /> : <Thread key={conversation.id} conversation={conversation} pane={layout.active} split={false} active />
  } else {
    body = (
      <>
        {layout.panes.map((id, index) => {
          const pane = index as PaneIndex
          const conversation = id ? conversationFor(id) : undefined
          if (!id || !conversation) return <EmptyPane key={`empty-${pane}`} pane={pane} active={layout.active === pane} />
          return <Thread key={`${pane}:${conversation.id}`} conversation={conversation} pane={pane} split active={layout.active === pane} />
        })}
      </>
    )
  }

  return (
    <div
      className={`chat-area ${split ? 'split' : ''}`}
      onDragEnter={(e) => {
        if (!isChatDrag(e)) return
        e.preventDefault()
        dragDepth.current += 1
        setDragOver(zoneAt(e))
      }}
      onDragOver={(e) => {
        if (!isChatDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const zone = zoneAt(e)
        if (zone !== dragOver) setDragOver(zone)
      }}
      onDragLeave={(e) => {
        if (!isChatDrag(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragOver(undefined)
      }}
      onDrop={(e) => {
        if (!isChatDrag(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDragOver(undefined)
        const id = e.dataTransfer.getData(CONVERSATION_DRAG)
        if (id && conversationFor(id)) openInPane(id, zoneAt(e))
      }}
    >
      {body}
      {dragOver !== undefined && (
        <div className="split-drop" aria-hidden>
          <div className={`split-drop-zone ${dragOver === 0 ? 'over' : ''}`}>{t('dropOpenLeft')}</div>
          <div className={`split-drop-zone ${dragOver === 1 ? 'over' : ''}`}>{t('dropOpenRight')}</div>
        </div>
      )}
    </div>
  )
}

/** A pane with nothing in it yet: the next chat picked from the list (or dropped here) fills it. */
function EmptyPane({ pane, active }: { pane: PaneIndex; active: boolean }): JSX.Element {
  const t = useT()
  const activatePane = useStore((s) => s.activatePane)
  const closePane = useStore((s) => s.closePane)
  return (
    <section className={`chat-col chat-pane empty ${active ? 'active' : ''}`} onMouseDownCapture={() => !active && activatePane(pane)}>
      <header className="chat-header drag">
        <div className="chat-header-info" />
        <div className="chat-header-actions no-drag">
          <button className="icon-btn" onClick={() => closePane(pane)} title={t('closePane')}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
      </header>
      <div className="pane-empty">
        <span className="pane-empty-icon">
          <Columns2 size={30} strokeWidth={2} />
        </span>
        <div className="pane-empty-title">{t('emptyPaneTitle')}</div>
        <div className="pane-empty-hint">{t('emptyPaneHint')}</div>
      </div>
    </section>
  )
}

/** Re-renders for its own chat, not whenever the list around it changes (the props are a chat, a pane and two flags). */
const Thread = memo(ThreadPane)

function ThreadPane({ conversation, pane, split, active }: { conversation: Conversation; pane: PaneIndex; split: boolean; active: boolean }): JSX.Element {
  const t = useT()
  const activatePane = useStore((s) => s.activatePane)
  const closePane = useStore((s) => s.closePane)
  const laterOn = useStore((s) => s.settings.laterTools !== false)
  const toggleSplit = useStore((s) => s.toggleSplit)
  const canSplit = useStore((s) => s.wide && !s.narrow)
  const thread = useThread(conversation.id)
  const stored = thread.messages
  const sentStickers = useStore((s) => s.settings.sentStickers)
  const members = conversation.members
  // Only the chats and accounts this thread shows: subscribing to all of them re-rendered the open thread (and every
  // bubble in it) whenever any other chat in the app changed.
  const via = useSendVia(conversation.id)
  const rawConversations = useStore(
    useShallow((s) => {
      const picked: Record<string, Conversation> = {}
      for (const id of [...(members ?? []), via]) if (s.conversations[id]) picked[id] = s.conversations[id]
      return picked
    })
  )
  const accounts = useStore(
    useShallow((s) => {
      const picked: Record<string, Account> = {}
      for (const c of [conversation, ...Object.values(rawConversations)]) if (s.accounts[c.accountId]) picked[c.accountId] = s.accounts[c.accountId]
      return picked
    })
  )
  // Our own stickers come back from the platforms as photos: show them as stickers again (per app, for a person).
  const messages = useMemo(() => {
    if (!stored) return stored
    if (!members) return withStickers(stored, sentStickers, conversation.id, conversation.platform)
    return members
      .flatMap((id) => withStickers(stored.filter((m) => m.conversationId === id), sentStickers, id, rawConversations[id]?.platform ?? conversation.platform))
      .sort((a, b) => a.sentAt - b.sentAt)
  }, [stored, sentStickers, conversation.id, conversation.platform, members, rawConversations])
  const loading = thread.loading
  const hasMore = thread.hasMore
  const typing = useStore((s) => (members ?? [conversation.id]).map((id) => s.typing[id]).find(Boolean))
  // A merged person writes through one of its chats: that chat's account decides what the composer can do.
  const viaConversation = rawConversations[via] ?? conversation
  const account = accounts[viaConversation.accountId]
  const memberOf = useCallback((m: Message): Conversation => rawConversations[m.conversationId] ?? conversation, [rawConversations, conversation])
  // Every chat of a merged person loads, also when it joined while the thread was open.
  const prefetch = useStore((s) => s.prefetch)
  const memberKey = members?.join('\n')
  useEffect(() => {
    for (const id of memberKey?.split('\n') ?? []) void prefetch(id, false)
  }, [memberKey, prefetch])
  const platformOf = useCallback((m: Message): Platform => memberOf(m).platform, [memberOf])
  const featuresOf = useCallback(
    (m: Message): Account['features'] => accounts[memberOf(m).accountId]?.features ?? NO_FEATURES,
    [accounts, memberOf]
  )
  const detailsOpen = useStore((s) => s.detailsOpen)
  const toggleDetails = useStore((s) => s.toggleDetails)
  const loadMore = useStore((s) => s.loadMore)
  const language = useStore((s) => s.settings.language)
  const bubbleChoice = useStore((s) => s.settings.contactOverrides?.[conversation.id]?.bubble)
  const customAccents = useStore((s) => s.settings.customAccents)
  const bubbleVars = useMemo(() => bubbleVarsOf(bubbleChoice, customAccents), [bubbleChoice, customAccents])
  const highlightId = useStore((s) => s.highlightIds[conversation.id])
  const addDroppedFiles = useStore((s) => s.addDroppedFiles)
  const narrow = useStore((s) => s.narrow)
  const select = useStore((s) => s.select)

  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollFade(scrollRef)
  const stickToBottom = useRef(true)
  // Messages that arrived while the thread was scrolled up (the "N new messages" pill), and where the thread ended.
  const [unseen, setUnseen] = useState(0)
  const lastSeen = useRef<{ conversationId: string; id?: string }>({ conversationId: conversation.id })
  const prevHeight = useRef(0)
  const prevFirstId = useRef<string | undefined>(undefined)
  const [dragging, setDragging] = useState(0)
  const [effect, setEffect] = useMessageEffects(messages)
  const wallpaper = useWallpaper(conversation.id)
  const celebrate = useCallback(() => setEffect({ kind: 'birthday', key: `bday-${conversation.id}` }), [setEffect, conversation.id])

  const isTyping = !!typing && typing.until > Date.now()
  const sections = useMemo(() => sectionize(messages ?? []), [messages])
  const lastOutgoing = useMemo(() => {
    for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) if (messages![i].isOutgoing) return messages![i]
    return undefined
  }, [messages])
  const features = account?.features ?? NO_FEATURES

  // The thread as rows (a day label, where a merged person switches app, a sender's run of messages), of which only
  // the ones on screen and a few around them exist: a long history used to keep every bubble in the page, and each
  // new message then laid all of them out again.
  const rows = useMemo(() => {
    const out: ChatRow[] = []
    for (const section of sections) {
      out.push({ key: `day:${section.day}`, kind: 'day', day: section.day })
      section.groups.forEach((group, index) => {
        if (members && (index === 0 || section.groups[index - 1].messages[0].conversationId !== group.messages[0].conversationId)) {
          out.push({ key: `via:${group.key}`, kind: 'via', conversation: memberOf(group.messages[0]) })
        }
        out.push({ key: group.key, kind: 'group', group })
      })
    }
    return out
  }, [sections, members, memberOf])
  const rowsRef = useRef<HTMLDivElement>(null)
  const [rowsOffset, setRowsOffset] = useState(0)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const row = rows[i]
      return row?.kind === 'group' ? estimateRun(row.group.messages) : row?.kind === 'day' ? 45 : 40
    },
    overscan: 6,
    getItemKey: (i) => rows[i]?.key ?? i,
    // The loader and "load more" above the rows push them down inside the scroller.
    scrollMargin: rowsOffset,
    // A thread opens on its newest message (the virtualizer would otherwise start by scrolling to the top).
    initialOffset: () => (stickToBottom.current ? Number.MAX_SAFE_INTEGER : 0),
    // Rows are measured as they appear and photos finish loading: while pinned, follow the bottom as it moves.
    onChange: () => {
      if (!stickToBottom.current) return
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
      })
    }
  })
  // While pinned to the newest message the thread keeps itself at the bottom (below); the virtualizer's own
  // correction for rows that grow above the view (a photo finishing loading) would scroll away from it, and that
  // scroll would read as the person scrolling up. Scrolled up, its correction keeps what is on screen in place.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => !stickToBottom.current && item.start < (instance.scrollOffset ?? 0)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const top = rowsRef.current
    if (!el || !top) return
    const offset = Math.round(top.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop)
    if (offset !== rowsOffset) setRowsOffset(offset)
    // What sits above the rows: the loader and the "load more" button.
  }, [rowsOffset, loading, hasMore, messages])

  // The row at the top of the view and how far into it the view starts: older messages load above, and the view is
  // put back on that same row (sizes above are only estimates until measured, so a height difference would drift).
  const anchor = useRef<{ key: React.Key; within: number } | undefined>(undefined)
  const rememberAnchor = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop - virtualizer.options.scrollMargin
    const first = virtualizer.getVirtualItems().find((item) => item.end > top)
    anchor.current = first ? { key: first.key, within: top - first.start } : undefined
  }, [virtualizer])

  // New messages at the end while the person reads further up: count them for the pill (and start over in another chat).
  useEffect(() => {
    const last = messages?.[messages.length - 1]
    const before = lastSeen.current
    lastSeen.current = { conversationId: conversation.id, id: last?.id }
    if (before.conversationId !== conversation.id) return setUnseen(0)
    if (!messages || !last || !before.id || last.id === before.id || stickToBottom.current) return
    const at = messages.findIndex((m) => m.id === before.id)
    // Older messages loading above, or the old end gone, is not news.
    if (at < 0) return
    const fresh = messages.slice(at + 1).filter((m) => !m.isOutgoing).length
    if (fresh) setUnseen((n) => n + fresh)
  }, [messages, conversation.id])
  const jumpToLatest = (): void => {
    stickToBottom.current = true
    setUnseen(0)
    if (rows.length) virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }
  const pill = usePresence(unseen > 0)
  const pillCount = useRef(unseen)
  if (unseen > 0) pillCount.current = unseen

  // Keep the viewport pinned to the newest message unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const firstId = messages?.[0]?.id
    if (prevFirstId.current && firstId !== prevFirstId.current && !stickToBottom.current) {
      const kept = anchor.current
      const index = kept ? rows.findIndex((row) => row.key === kept.key) : -1
      const start = index >= 0 ? virtualizer.measurementsCache[index]?.start : undefined
      if (kept && start !== undefined) {
        el.scrollTop = start + virtualizer.options.scrollMargin + kept.within
        // Rows measured in this same commit are not in those offsets yet: once the anchor row is drawn, put it
        // back exactly where it was (twice, as the rows around it settle).
        // The offsets above still hold estimates for rows measured in this commit, so the anchor can land some way
        // off. Over the next frames, once the virtualizer has redrawn with those sizes: go by its updated offsets
        // until they stop moving, then, with the anchor row on screen, by where it really is.
        const settle = (frames: number): void => {
          requestAnimationFrame(() => {
            if (stickToBottom.current) return
            const row = rowsRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
            const target = (virtualizer.measurementsCache[index]?.start ?? 0) + virtualizer.options.scrollMargin + kept.within
            const off = row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top + kept.within : target - el.scrollTop
            if (Math.abs(off) >= 1) el.scrollTop += off
            // Keep watching for a few frames: rows just above the view are measured late and move it again.
            if (frames > 1) settle(frames - 1)
          })
        }
        settle(16)
      } else if (prevHeight.current) el.scrollTop += el.scrollHeight - prevHeight.current
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
    prevFirstId.current = firstId
    prevHeight.current = el.scrollHeight
    rememberAnchor()
    // rows follow messages; the virtualizer is one object for the thread's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isTyping])

  // Rows are measured as they appear, so the thread's height settles after a render: stay on the newest message
  // meanwhile (opening a chat, a photo that finished loading).
  useEffect(() => {
    const el = scrollRef.current
    const inner = rowsRef.current
    if (!el || !inner) return
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight
      prevHeight.current = el.scrollHeight
    })
    observer.observe(inner)
    // the thread itself shrinks when the composer grows to several lines: keep the newest message in view then too
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Jump to a search hit: bring its row into the window, then centre the bubble itself.
  useEffect(() => {
    if (!highlightId || !messages) return
    const index = rows.findIndex((row) => row.kind === 'group' && row.group.messages.some((m) => m.id === highlightId))
    if (index < 0) return
    stickToBottom.current = false
    virtualizer.scrollToIndex(index, { align: 'center' })
    const timer = setTimeout(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(highlightId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 120)
    return () => clearTimeout(timer)
    // The virtualizer object is stable; the rows decide where the message is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, rows])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Only the person leaves the bottom: a wheel, a touch, a key or the scrollbar. Rows growing as they are measured
    // (or as photos load) also move the bottom away, and that must not unpin the thread.
    let lastInput = 0
    let held = false
    const input = (): void => {
      lastInput = Date.now()
    }
    const down = (): void => {
      held = true
      input()
    }
    const up = (): void => {
      held = false
    }
    const onScroll = (): void => {
      rememberAnchor()
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      if (nearBottom) {
        stickToBottom.current = true
        setUnseen((n) => (n ? 0 : n))
      } else if (held || Date.now() - lastInput < 600) stickToBottom.current = false
      if (el.scrollTop < 60 && hasMore && !loading) void loadMore(conversation.id)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', input, { passive: true })
    el.addEventListener('touchmove', input, { passive: true })
    el.addEventListener('keydown', input)
    el.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', input)
      el.removeEventListener('touchmove', input)
      el.removeEventListener('keydown', input)
      el.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
    }
  }, [conversation.id, hasMore, loading, loadMore, rememberAnchor])

  // The account this chat is on, where its app has more than one: so a reply never goes out from the wrong one.
  const accountLabel = useAccountLabels()[conversation.accountId]
  const base = isTyping
    ? conversation.isGroup
      ? t('typingIn', { name: typing.name })
      : t('typing')
    : members
      ? members.map((id) => PLATFORMS[rawConversations[id]?.platform ?? conversation.platform].name).join(' · ')
      : conversation.isGroup
        ? t('members', { count: conversation.participants.length })
        : (conversation.participants.find((p) => !p.isMe)?.handle ?? PLATFORMS[conversation.platform].name)
  const subtitle = accountLabel && !isTyping && !members ? `${base} · ${t('viaAccount', { account: accountLabel })}` : base

  // Only real files light up the drop overlay; a chat dragged from the list is handled by the chat area.
  const isFileDrag = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')
  const onDrop = (e: React.DragEvent): void => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    setDragging(0)
    if (!features.attachments) return
    const files = [...e.dataTransfer.files]
    if (files.length) addDroppedFiles(conversation.id, files)
  }

  return (
    <section
      className={`chat-col chat-pane ${active ? 'active' : ''} ${wallpaper.attr ? 'has-wallpaper' : ''}`}
      style={{ ...bubbleVars, ...wallpaper.style }}
      onMouseDownCapture={() => !active && activatePane(pane)}
      onFocusCapture={() => !active && activatePane(pane)}
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        if (features.attachments) setDragging((d) => d + 1)
      }}
      onDragLeave={(e) => isFileDrag(e) && setDragging((d) => Math.max(0, d - 1))}
      onDragOver={(e) => isFileDrag(e) && e.preventDefault()}
      onDrop={onDrop}
    >
      {wallpaper.attr && <div className="chat-wallpaper" data-wallpaper={wallpaper.attr} aria-hidden />}
      <header className="chat-header drag">
        {narrow && (
          <button className="icon-btn no-drag" onClick={() => withViewTransition('to-list', () => select(undefined))} title={t('back')}>
            <ChevronLeft size={20} strokeWidth={2.4} />
          </button>
        )}
        <Avatar name={conversation.title} url={conversation.avatarUrl} size={34} onClick={() => withViewTransition('details', () => toggleDetails('info'))} />
        <div className="chat-header-info">
          <div className="chat-header-title">
            {conversation.title}
            {conversation.muted && <BellOff size={13} strokeWidth={2.2} style={{ opacity: 0.5 }} />}
          </div>
          <div className={`chat-header-sub ${isTyping ? 'typing' : ''}`}>{subtitle}</div>
        </div>
        <div className="chat-header-actions no-drag">
          {canSplit && !split && (
            <button className="icon-btn" onClick={() => toggleSplit()} title={`${t('splitView')} (${modKey} \\)`}>
              <Columns2 size={18} strokeWidth={2} />
            </button>
          )}
          {laterOn && <LaterButton conversationId={conversation.id} />}
          <SummaryButton conversationId={conversation.id} />
          <button className={`icon-btn ${detailsOpen && active ? 'active' : ''}`} onClick={() => withViewTransition('details', () => toggleDetails())} title={t('details')}>
            <Info size={18} strokeWidth={2} />
          </button>
          {split && (
            <button className="icon-btn" onClick={() => closePane(pane)} title={t('closePane')}>
              <X size={18} strokeWidth={2} />
            </button>
          )}
        </div>
      </header>

      <SummaryCard conversationId={conversation.id} />
      <BirthdayBanner conversation={conversation} canSendStickers={features.attachments} onCelebrate={celebrate} />
      <div className="chat-scroll scroll edge-fade" ref={scrollRef}>
        <div className="chat-scroll-inner">
          {loading && !messages && <BuddyLoader size={56} label={t('loadingMessages')} className="chat-loading" />}
          {!hasMore && !loading && messages && messages.length > 0 && conversation.platform === 'zalo' && <div className="history-start">{t('zaloOlderOnPhone')}</div>}
          {hasMore && messages && (
            <button className="load-more" onClick={() => loadMore(conversation.id)} disabled={loading}>
              {loading ? <BuddyLoader size={20} inline /> : t('loadMore')}
            </button>
          )}
          <div ref={rowsRef} className="chat-rows" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index]
              return (
                // Placed with top, not a transform: a transform would make each row its own layer, and a bubble's
                // emoji or action popover would then slip under the row below it.
                <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className="chat-row" style={{ top: v.start - virtualizer.options.scrollMargin }}>
                  {row.kind === 'day' ? (
                    <div className="day-sep">{formatDayLabel(row.day, language)}</div>
                  ) : row.kind === 'via' ? (
                    <ViaSeparator conversation={row.conversation} />
                  ) : (
                    <Group
                      group={row.group}
                      conversation={conversation}
                      features={features}
                      featuresOf={members ? featuresOf : undefined}
                      platformOf={members ? platformOf : undefined}
                      lastOutgoingId={lastOutgoing?.id}
                      highlightId={highlightId}
                      language={language}
                    />
                  )}
                </div>
              )
            })}
          </div>
          {isTyping && (
            <div className="msg-group in">
              <div className="msg-avatar-slot">
                <Avatar {...personLook(conversation, { name: typing.name })} size={28} />
              </div>
              <div className="typing-bubble" aria-label={t('typing')}>
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>
      </div>

      {pill.mounted && (
        <div className="jump-anchor">
          <button className="jump-pill" data-state={pill.state} onClick={jumpToLatest} aria-live="polite">
            <ChevronDown size={14} strokeWidth={2.6} aria-hidden />
            {pillCount.current === 1 ? t('jumpNewMessageOne') : t('jumpNewMessages', { count: pillCount.current })}
          </button>
        </div>
      )}
      {dragging > 0 && <div className="drop-overlay">{t('dropHint')}</div>}
      {account && account.status !== 'connected' && <ReconnectBanner accountId={account.id} status={account.status} reason={account.error} />}
      {effect && <EffectLayer key={effect.key} kind={effect.kind} seed={effect.key} onDone={() => setEffect(undefined)} />}
      <RequestBanner conversation={conversation} />
      <ScheduledStrip conversationId={conversation.id} members={members} />
      {members && <SendViaChip conversation={conversation} via={via} />}
      <Composer conversationId={conversation.id} active={active} disabled={account?.status !== 'connected'} canAttach={features.attachments} canVoice={features.voice ?? features.attachments} />
    </section>
  )
}

/** Where a merged person's thread switches app: a quiet label with the app and account. */
function ViaSeparator({ conversation }: { conversation: Conversation }): JSX.Element {
  const t = useT()
  const account = useStore((s) => s.accounts[conversation.accountId])
  return (
    <div className="via-sep">
      <PlatformIcon platform={conversation.platform} size={12} />
      <span>{t('viaLabel', { app: PLATFORMS[conversation.platform].name })}</span>
      {account?.handle && <span className="via-sep-account">{account.handle}</span>}
    </div>
  )
}

/**
 * Which app a merged person's message goes out on, always in sight above the composer. It follows the app they
 * last wrote on (pulsing when it switches by itself); a click lists their chats to pick another.
 */
function SendViaChip({ conversation, via }: { conversation: Conversation; via: string }): JSX.Element {
  const t = useT()
  const rawConversations = useStore((s) => s.conversations)
  const accounts = useStore((s) => s.accounts)
  const pickSendVia = useStore((s) => s.pickSendVia)
  const replyingFrom = useStore((s) => s.replyTos[conversation.id]?.conversationId)
  const [open, setOpen] = useState(false)
  const [pulse, setPulse] = useState(0)
  const previous = useRef(via)
  useEffect(() => {
    if (previous.current !== via) setPulse((n) => n + 1)
    previous.current = via
  }, [via])
  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const current = rawConversations[via]
  if (!current) return <></>
  const locked = replyingFrom === via && (conversation.members?.length ?? 0) > 1
  const label = (c: Conversation): string => accounts[c.accountId]?.handle ?? accounts[c.accountId]?.displayName ?? ''
  return (
    <div className="send-via" onMouseDown={(e) => e.stopPropagation()}>
      <button
        key={pulse}
        type="button"
        className={`send-via-chip ${pulse ? 'pulse' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={locked ? t('sendViaReply') : t('sendViaHint')}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
      >
        <PlatformIcon platform={current.platform} size={13} />
        <span>{t('sendVia', { app: PLATFORMS[current.platform].name })}</span>
        <span className="send-via-account">{label(current)}</span>
        {!locked && <ChevronDown size={13} strokeWidth={2.4} aria-hidden />}
      </button>
      {open && (
        <div className="send-via-menu" role="listbox" aria-label={t('sendVia', { app: '' }).trim()}>
          {(conversation.members ?? []).map((id) => {
            const member = rawConversations[id]
            if (!member) return null
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={id === via}
                className={`send-via-option ${id === via ? 'active' : ''}`}
                onClick={() => {
                  pickSendVia(conversation.id, id)
                  setOpen(false)
                }}
              >
                <PlatformIcon platform={member.platform} size={15} />
                <span className="send-via-option-text">
                  <strong>{PLATFORMS[member.platform].name}</strong>
                  <span>{label(member)}</span>
                </span>
                {id === via && <Check size={14} strokeWidth={2.6} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Above the composer of a message request: who this is, that reading stays private, and the two ways out.
 * Replying accepts it too.
 */
function RequestBanner({ conversation }: { conversation: Conversation }): JSX.Element | null {
  const t = useT()
  const accepted = useStore((s) => s.settings.acceptedRequests)
  const acceptRequest = useStore((s) => s.acceptRequest)
  const hideConversation = useStore((s) => s.hideConversation)
  const showToast = useStore((s) => s.showToast)
  if (!isPendingRequest(conversation, accepted)) return null
  return (
    <div className="request-banner" role="region" aria-label={t('requestBannerTitle')}>
      <span className="request-banner-icon" aria-hidden>
        <UserRoundPlus size={18} strokeWidth={2.2} />
      </span>
      <span className="request-banner-text">
        <strong>{t('requestBannerTitle')}</strong>
        <span>{t('requestBannerBody', { name: conversation.title })}</span>
      </span>
      <span className="request-banner-actions">
        <button className="btn secondary" onClick={() => void hideConversation(conversation.id)}>
          {t('requestHide')}
        </button>
        <button
          className="btn primary"
          onClick={() => {
            void acceptRequest(conversation.id)
            showToast(t('requestAcceptedToast', { name: conversation.title }))
          }}
        >
          {t('requestAccept')}
        </button>
      </span>
    </div>
  )
}

export function ReconnectBanner({ accountId, status, reason, label }: { accountId: string; status: string; reason?: string; label?: string }): JSX.Element {
  const t = useT()
  const reconnect = useStore((s) => s.reconnect)
  const showToast = useStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)
  const text =
    status === 'connecting'
      ? t('connecting')
      : reason === 'checkpoint'
        ? t('sessionCheckpoint')
        : status === 'needs_auth'
          ? t('sessionExpired')
          : (reason ?? t('disconnected'))
  return (
    <div className={`reconnect-banner ${status}`}>
      <span className={`status-dot ${status}`} />
      <span className="reconnect-text">
        {label && <strong>{label} · </strong>}
        {text}
      </span>
      {status !== 'connecting' && (
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await reconnect(accountId)
            } catch (err) {
              showToast((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? t('waitingLogin') : t('signInAgain')}
        </button>
      )}
    </div>
  )
}

/** A sender's run of messages: redrawn when the run, or how it is shown, changes (not on every scroll of the list). */
const Group = memo(GroupView)

function GroupView({
  group,
  conversation,
  features: chatFeatures,
  featuresOf,
  platformOf,
  lastOutgoingId,
  highlightId,
  language
}: {
  group: MessageGroup
  conversation: Conversation
  features: Account['features']
  /** A merged person: each message's own app decides what it can do and how it looks. */
  featuresOf?: (message: Message) => Account['features']
  platformOf?: (message: Message) => Platform
  lastOutgoingId?: string
  highlightId?: string
  language: 'vi' | 'en'
}): JSX.Element {
  const t = useT()
  const showSender = !group.isOutgoing && conversation.isGroup
  // A group never mixes apps (sectionize splits them), so its first message speaks for it.
  const features = featuresOf?.(group.messages[0]) ?? chatFeatures
  const platform = platformOf?.(group.messages[0]) ?? conversation.platform
  // Kept per run so a memoised album sees the same messages until the run changes.
  const items = useMemo(() => groupItems(group.messages), [group.messages])
  if (group.system) return <SystemRow message={group.messages[0]} platform={platform} />
  return (
    <div className={`msg-group ${group.isOutgoing ? 'out' : 'in'}`}>
      {!group.isOutgoing && (
        <div className="msg-avatar-slot">
          <Avatar {...personLook(conversation, { id: group.senderId, name: group.senderName, avatarUrl: group.senderAvatarUrl })} size={28} />
        </div>
      )}
      <div className="msg-group-body">
        {showSender && <div className="msg-sender">{group.senderName}</div>}
        {items.map((item, index) => {
          const position = items.length === 1 ? 'single' : index === 0 ? 'first' : index === items.length - 1 ? 'last' : 'middle'
          if (item.type === 'album') {
            const reacted = item.messages.flatMap((m) => m.reactions)
            return (
              <div key={item.messages[0].id} style={{ display: 'contents' }}>
                <Album messages={item.messages} outgoing={group.isOutgoing} highlightId={highlightId} language={language} />
                {platform === 'zalo' && (() => {
                  const reactedMessage = item.messages.find((m) => m.reactions.length)
                  return reactedMessage ? <ReactionPill message={reactedMessage} outgoing={group.isOutgoing} canReact={features.react} /> : null
                })()}
                {platform !== 'zalo' && reacted.length > 0 && (
                  <div className="reactions">
                    {reacted.slice(0, 6).map((r, i) => (
                      <span key={i} className={`reaction-chip ${r.byMe ? 'mine' : ''}`}>
                        {r.emoji}
                      </span>
                    ))}
                  </div>
                )}
                {item.messages.some((m) => m.id === lastOutgoingId) && <div className="status-line">{t('delivered')}</div>}
              </div>
            )
          }
          const message = item.message
          return (
            <div key={message.id} style={{ display: 'contents' }}>
              {/* the bubble draws its own reactions, wherever Settings > Chat puts them */}
              <Bubble message={message} position={position} language={language} features={features} highlighted={message.id === highlightId} platform={platform} />
              {/* every failed bubble gets its line (with Send again / Delete), not only the last one */}
              {message.status === 'failed' ? (
                <div className="status-line failed">
                  {t('failed')}
                  <FailedActions message={message} />
                </div>
              ) : (
                message.id === lastOutgoingId && (
                  <div className="status-line">{message.status === 'read' ? t('read') : message.status === 'sending' ? t('sending') : t('delivered')}</div>
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Under a bubble that did not go out: send it again as it was, or take it away. */
function FailedActions({ message }: { message: Message }): JSX.Element {
  const t = useT()
  const retrySend = useStore((s) => s.retrySend)
  const discardFailed = useStore((s) => s.discardFailed)
  // Only a send from this session can go again (what went out is kept in memory, not with the message).
  const canRetry = useStore((s) => !!s.failedSends[message.id])
  return (
    <span className="status-actions">
      {canRetry && (
        <button type="button" className="status-action" onClick={() => void retrySend(message.conversationId, message.id)}>
          {t('sendAgain')}
        </button>
      )}
      <button type="button" className="status-action" onClick={() => discardFailed(message.conversationId, message.id)}>
        {t('delete')}
      </button>
    </span>
  )
}

type GroupItem = { type: 'one'; message: Message } | { type: 'album'; messages: Message[] }

/** A photo or video with nothing else (no text, no reply) can join an album. */
function albumable(m: Message): boolean {
  const a = m.attachments[0]
  return (
    m.attachments.length === 1 &&
    !m.text.trim() &&
    !m.replyTo &&
    !m.system &&
    m.status !== 'failed' &&
    (a.kind === 'image' || a.kind === 'video') &&
    !a.expired &&
    !!(a.thumbnailUrl || a.url)
  )
}

/** Consecutive photos/videos sent within three minutes of each other become one album (like Instagram / Messenger). */
function groupItems(messages: Message[]): GroupItem[] {
  const items: GroupItem[] = []
  for (const m of messages) {
    const last = items[items.length - 1]
    if (albumable(m) && last?.type === 'album' && m.sentAt - last.messages[last.messages.length - 1].sentAt < 180_000) {
      last.messages.push(m)
      continue
    }
    items.push(albumable(m) ? { type: 'album', messages: [m] } : { type: 'one', message: m })
  }
  // A lone photo keeps the normal bubble (bigger, natural aspect ratio).
  return items.map((item) => (item.type === 'album' && item.messages.length === 1 ? { type: 'one', message: item.messages[0] } : item))
}

const Album = memo(AlbumView)

function AlbumView({
  messages,
  outgoing,
  highlightId,
  language
}: {
  messages: Message[]
  outgoing: boolean
  highlightId?: string
  language: 'vi' | 'en'
}): JSX.Element {
  const [fresh] = useState(() => isFresh(messages[messages.length - 1].sentAt))
  const highlighted = messages.some((m) => m.id === highlightId)
  return (
    <div className={`bubble-row album-row ${fresh ? 'fresh' : ''} ${highlighted ? 'highlight' : ''}`} data-message-id={messages[0].id}>
      <MediaGrid conversationId={messages[0]?.conversationId} tiles={messages.map((m) => ({ id: m.id, messageId: m.id, attachment: m.attachments[0] }))} className={outgoing ? 'out' : 'in'} />
      <span className="bubble-time">{formatTime(messages[messages.length - 1].sentAt, language)}</span>
    </div>
  )
}

type Tile = { id: string; messageId: string; attachment: Attachment }

/** Photos/videos with a playable or viewable source. */
function gridable(a: Attachment): boolean {
  return (a.kind === 'image' || a.kind === 'video') && !a.expired && !!(a.thumbnailUrl || a.url)
}

/**
 * Several photos/videos as one tidy grid (like Messenger / iMessage): 2 side by side, 3 as one big
 * plus two, 4 as 2×2, 5 as 2 + 3, more in rows of three (the 9th tile shows "+N").
 * Clicking opens a gallery you can arrow through.
 */
function MediaGrid({ tiles, className = '', conversationId }: { tiles: Tile[]; className?: string; conversationId?: string }): JSX.Element {
  const openLightbox = useStore((s) => s.openLightbox)
  const shown = tiles.slice(0, 9)
  const extra = tiles.length - shown.length
  const layout = tiles.length >= 6 ? 'many' : `n${tiles.length}`
  const gallery = tiles.map(({ attachment: a }) => ({ url: (a.kind === 'video' ? a.url : (a.url ?? a.thumbnailUrl)) ?? a.thumbnailUrl ?? '', video: a.kind === 'video' && !!a.url, poster: a.thumbnailUrl }))
  return (
    <div className={`album grid-${layout} ${className}`}>
      {shown.map((tile, i) => {
        const a = tile.attachment
        const original = a.thumbnailUrl ?? a.url
        const src = previewSrc(original, 640)
        return (
          <button key={tile.id} className="album-tile" data-message-id={tile.messageId} onClick={() => openLightbox({ ...gallery[i], gallery, index: i, conversationId })}>
            {a.kind === 'video' && !a.thumbnailUrl ? (
              // A video with no poster from the platform: its own first frame (never the video file in an <img>).
              <video src={`${mediaSrc(a.url)}#t=0.1`} preload="metadata" muted playsInline />
            ) : (
              <img
                src={src}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                // The preview could not be made: the picture as it is.
                onError={(e) => {
                  if (original && e.currentTarget.src !== original) e.currentTarget.src = original
                }}
              />
            )}
            {a.kind === 'video' && (
              <span className="album-play">
                <Play size={16} fill="currentColor" />
              </span>
            )}
            {i === shown.length - 1 && extra > 0 && <span className="album-more">+{extra}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** One row of a thread as drawn: a day label, where a merged person switches app, or a sender's run of messages. */
type ChatRow = { key: string; kind: 'day'; day: number } | { key: string; kind: 'via'; conversation: Conversation } | { key: string; kind: 'group'; group: MessageGroup }

/** No account (or an unknown one): nothing can be done; one shared object so memoised bubbles see it unchanged. */
const NO_FEATURES: Account['features'] = { reply: false, react: false, attachments: false }

/** Saved messages as a set of "chat|message" keys, built once per list (every bubble asks). */
const savedSets = new WeakMap<object, Set<string>>()
function savedSetOf(list: Array<{ conversationId: string; messageId: string }> | undefined): Set<string> | undefined {
  if (!list) return undefined
  let set = savedSets.get(list)
  if (!set) {
    set = new Set(list.map((m) => `${m.conversationId}|${m.messageId}`))
    savedSets.set(list, set)
  }
  return set
}

/** A bubble re-renders only when its own message (or how it is shown) changes, not for every message in the thread. */
const Bubble = memo(BubbleView)

function BubbleView({
  message,
  position,
  language,
  features,
  highlighted,
  platform
}: {
  message: Message
  position: 'single' | 'first' | 'middle' | 'last'
  language: 'vi' | 'en'
  features: Account['features']
  highlighted: boolean
  platform: Platform
}): JSX.Element {
  const t = useT()
  // The store's actions are stable functions: one shallow-compared pick instead of a subscription each.
  const { setReplyTo, startForward, react, toggleSaved, showToast, unsend, rememberSticker } = useStore(
    useShallow((s) => ({
      setReplyTo: s.setReplyTo,
      startForward: s.startForward,
      react: s.react,
      toggleSaved: s.toggleSaved,
      showToast: s.showToast,
      unsend: s.unsend,
      rememberSticker: s.rememberSticker
    }))
  )
  const saved = useStore((s) => !!savedSetOf(s.settings.savedMessages)?.has(`${message.conversationId}|${message.id}`))
  // Slides in only when it is new, not each time scrolling remounts its row (decided once, at mount).
  const [fresh] = useState(() => isFresh(message.sentAt))
  const [picker, setPicker] = useState(false)
  const [moreEmoji, setMoreEmoji] = useState(false)
  const [todoOpen, setTodoOpen] = useState(false)
  // The bar's "…": everything but reacting and replying, in a menu (like Instagram), so the bar stays short.
  const [moreOpen, setMoreOpen] = useState(false)
  const { translate, speak, translated, speaking } = useAi(
    useShallow((s) => ({
      translate: s.translate,
      speak: s.speak,
      translated: !!s.results[`t:${textKey(message)}`]?.text && !s.results[`t:${textKey(message)}`]?.hidden,
      speaking: s.speaking === textKey(message)
    }))
  )
  const [confirmUnsend, setConfirmUnsend] = useState(false)
  // tips: small labels on the bar's buttons (Settings > Chat > Message actions); on by default.
  // placement: where reactions sit (Settings > Chat): the lower edge (default), the top corner, a row below, or beside the end.
  // bubbleActions: which buttons the bar shows (Settings > Chat > Message actions); everything is on by default.
  const { tips, placement, todosOn, bubbleActions } = useStore(
    useShallow((s) => ({
      tips: s.settings.actionLabels !== false,
      placement: s.settings.reactionPlacement ?? 'overlap',
      todosOn: s.settings.todosOn !== false,
      bubbleActions: s.settings.bubbleActions
    }))
  )
  const wants = (action: BubbleAction): boolean => bubbleActions?.[action] !== false
  // Keep the full emoji sheet inside the chat column, whichever side the bubble is on.
  const fitInChat = useCallback((anchor: HTMLSpanElement | null) => {
    const sheet = anchor?.firstElementChild as HTMLElement | null
    const bounds = anchor?.closest('.chat-scroll')?.getBoundingClientRect()
    if (!sheet || !bounds) return
    const r = sheet.getBoundingClientRect()
    const dx = Math.min(0, bounds.right - 8 - r.right) || Math.max(0, bounds.left + 8 - r.left)
    const dy = Math.max(0, bounds.top + 8 - r.top)
    sheet.style.translate = `${dx}px ${dy}px`
  }, [])
  const [burst, setBurst] = useState(0)
  // Double-click a message to heart it (like Instagram).
  const heart = (e: React.MouseEvent): void => {
    if (!features.react || message.status === 'sending' || message.status === 'failed') return
    if ((e.target as HTMLElement).closest('a, button, img, video, audio, .album, .link-card, .post-card')) return
    window.getSelection()?.removeAllRanges()
    if (mine !== '❤️') setBurst(Date.now())
    void react(message.conversationId, message.id, '❤️')
  }
  const direction = message.isOutgoing ? 'out' : 'in'
  // A sticker without a link (WhatsApp, Telegram) is one too: StickerImage fetches its picture.
  const tagged = message.attachments.find((a) => a.kind === 'sticker')
  // A photo tagged as a sticker only by timing or size is checked against the pack's pictures; a
  // pasted screenshot that happened to go out right after a sticker turns back into a photo.
  const guessedUrl = tagged?.guessed && tagged.url && !tagged.sticker?.startsWith('custom:') ? tagged.url : undefined
  const [verified, setVerified] = useState<{ url: string; sticker?: string } | undefined>()
  useEffect(() => {
    if (!guessedUrl) return
    let live = true
    void matchSticker(guessedUrl).then((id) => live && setVerified({ url: guessedUrl, sticker: id }))
    return () => {
      live = false
    }
  }, [guessedUrl])
  const checked = guessedUrl && verified?.url === guessedUrl ? verified : undefined
  const demoted = !!(guessedUrl && checked && !checked.sticker)
  const sticker = demoted ? undefined : tagged && checked?.sticker ? { ...tagged, sticker: checked.sticker } : tagged
  // The demoted one is shown as the photo it is.
  const attachments = demoted ? message.attachments.map((a) => (a === tagged ? { ...a, kind: 'image' as const, sticker: undefined, flattened: undefined, guessed: undefined } : a)) : message.attachments
  // A stable selector (zustand v5): the array itself, not a fresh closure per render.
  const customStickers = useStore((s) => s.customStickers)
  const customUrl = (id: string): string | undefined => customStickers.find((c) => c.id === id)?.url
  // An older sticker the platform gave back as a photo: find out which one it is, once, and remember it.
  const unknownSticker = sticker && !sticker.sticker && message.isOutgoing ? sticker.url : undefined
  useEffect(() => {
    if (!unknownSticker) return
    let live = true
    void matchSticker(unknownSticker).then((id) => {
      if (live && id) rememberSticker({ conversationId: message.conversationId, messageId: message.id, sticker: id, sentAt: message.sentAt })
    })
    return () => {
      live = false
    }
  }, [unknownSticker, message.conversationId, message.id, message.sentAt, rememberSticker])
  // A GIPHY sticker a friend sent (Instagram's tray is GIPHY): kept in the sticker picker to send back.
  const receivedGiphy = sticker && !message.isOutgoing ? giphyIdOf(sticker.url) : undefined
  const receivedUrl = receivedGiphy ? sticker?.url : undefined
  useEffect(() => {
    if (receivedGiphy && receivedUrl) rememberGiphySticker('received', { id: receivedGiphy, url: receivedUrl })
  }, [receivedGiphy, receivedUrl])
  const story = attachments.find((a) => a.kind === 'story')
  const inline = attachments.filter((a) => a.kind !== 'story')
  const media = inline.find((a) => ((a.kind === 'image' || a.kind === 'video') && (a.url || a.thumbnailUrl)) || a.kind === 'post')
  // Several photos in one message (Instagram, Messenger, Telegram albums) become a grid.
  const grid = inline.filter(gridable)
  const gridded = grid.length > 1 ? new Set(grid.map((a) => a.id)) : undefined
  // A story reaction is just the emoji on the story card; a share without words needs no bubble either.
  const bubbleless = !!story && (story.label === 'story_reaction' || !message.text.trim()) && inline.length === 0
  // Emoji-only messages render large without a bubble (like Instagram / iMessage).
  const jumbo = !message.attachments.length && !message.replyTo ? jumboEmojiCount(message.text) : 0
  const classes = ['bubble', direction, position]
  if (jumbo) classes.push('jumbo', `e${jumbo}`)
  if (sticker) classes.push('sticker')
  else if (media) classes.push('media')
  // Only photos, no words: the grid stands on its own like an album (no bubble frame).
  if (gridded && !sticker && !message.text.trim() && !message.replyTo && inline.length === grid.length) classes.push('grid-only')
  if (message.status === 'failed') classes.push('failed')
  const mine = message.reactions.find((r) => r.byMe)?.emoji

  useEffect(() => {
    if (!picker && !confirmUnsend && !moreOpen) return
    const close = (): void => {
      setPicker(false)
      setConfirmUnsend(false)
      setMoreOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [picker, confirmUnsend, moreOpen])

  const settled = message.status !== 'sending' && message.status !== 'failed'
  const showActions = settled && !message.unsent && BUBBLE_ACTIONS.some(wants)

  // Taken back: only a faint line where it was, like Messenger and Zalo show it.
  if (message.unsent) {
    return (
      <div className={`bubble-row ${fresh ? 'fresh' : ''}`} data-message-id={message.id}>
        <div className="bubble-stack">
          <div className={`bubble ${direction} ${position} unsent`}>
            <Undo2 size={13} strokeWidth={2.2} aria-hidden />
            {message.isOutgoing ? t('unsentMine') : t('unsentTheirs')}
          </div>
        </div>
        <span className="bubble-time">{formatTime(message.sentAt, language)}</span>
      </div>
    )
  }

  // The More menu: what is switched on in Settings > Chat > Message actions, and possible for this message.
  const hasText = !!message.text.trim()
  const moreItems: Array<{ key: string; icon: JSX.Element; label: string; run(): void; danger?: boolean }> = []
  // Reply is in the bar too; in the menu as well, so everything is in one place once it is open.
  if (features.reply && wants('reply')) moreItems.push({ key: 'reply', icon: <Reply size={15} strokeWidth={2} />, label: t('reply'), run: () => setReplyTo(message.conversationId, message) })
  const canReact = features.react && wants('react')
  if (wants('forward')) moreItems.push({ key: 'forward', icon: <Forward size={15} strokeWidth={2} />, label: t('forward'), run: () => startForward(message) })
  if (hasText)
    moreItems.push({
      key: 'copy',
      icon: <Copy size={15} strokeWidth={2} />,
      label: t('copyText'),
      run: () => void navigator.clipboard.writeText(message.text).then(() => showToast(t('textCopied')))
    })
  if (wants('translate') && hasText) moreItems.push({ key: 'translate', icon: <Languages size={15} strokeWidth={2} />, label: translated ? t('aiShowOriginal') : t('aiTranslate'), run: () => void translate(message) })
  if (wants('speak') && hasText) moreItems.push({ key: 'speak', icon: <Volume2 size={15} strokeWidth={2} />, label: speaking ? t('aiSpeakStop') : t('aiSpeak'), run: () => void speak(message) })
  if (wants('todo') && todosOn) moreItems.push({ key: 'todo', icon: <ListTodo size={15} strokeWidth={2} />, label: t('todoFromMessage'), run: () => setTodoOpen(true) })
  if (wants('save'))
    moreItems.push({ key: 'save', icon: <Sparkles size={15} strokeWidth={2} fill={saved ? 'currentColor' : 'none'} />, label: saved ? t('unsaveAction') : t('saveAction'), run: () => void toggleSaved(message) })
  if (message.isOutgoing && features.unsend && wants('unsend')) moreItems.push({ key: 'unsend', icon: <Undo2 size={15} strokeWidth={2} />, label: t('unsend'), run: () => setConfirmUnsend(true), danger: true })

  // The time: after the actions when they show (bubble, actions, then time, like Instagram), else beside the bubble.
  const time = (
    <span className={`bubble-time ${showActions ? 'in-bar' : ''}`}>
      {saved && <Sparkles className="saved-mark" size={11} strokeWidth={2.4} fill="currentColor" />}
      {formatTime(message.sentAt, language)}
    </span>
  )

  // Zalo keeps one reaction per person and shows them as one pill; others get a chip per emoji.
  const reactionSlot =
    platform === 'zalo' ? (
      message.reactions.length > 0 ? (
        <div className={`react-slot at-${placement}`}>
          <ReactionPill message={message} outgoing={message.isOutgoing} canReact={features.react} />
        </div>
      ) : null
    ) : message.reactions.length > 0 ? (
      <div className={`react-slot at-${placement}`}>
        <div className="reactions">
          {message.reactions.map((r) => (
            <button
              key={r.emoji}
              className={`reaction-chip ${r.byMe ? 'mine' : ''}`}
              onClick={() => features.react && void react(message.conversationId, message.id, r.emoji)}
              title={r.byMe ? t('removeReaction') : t('react')}
            >
              {r.emoji}
              {r.count > 1 && <span>{r.count}</span>}
            </button>
          ))}
        </div>
      </div>
    ) : null

  return (
    <div
      className={`bubble-row ${fresh ? 'fresh' : ''} ${highlighted ? 'highlight' : ''} ${reactionSlot && placement === 'top' ? 'react-top' : ''}`}
      data-message-id={message.id}
    >
      <div className="bubble-stack">
        {story && <StoryRef attachment={story} message={message} platform={platform} />}
        {!bubbleless && (
          <div className={classes.join(' ')} onDoubleClick={heart}>
            {burst > 0 && (
              <span key={burst} className="heart-burst" aria-hidden onAnimationEnd={() => setBurst(0)}>
                ❤️
              </span>
            )}
            {message.replyTo && (message.replyTo.text || message.replyTo.senderName) && (
              <div className="reply-quote">
                <strong>{message.replyTo.senderName}</strong>
                {message.replyTo.text}
              </div>
            )}
            {sticker &&
              (sticker.sticker?.startsWith('custom:') && customUrl(sticker.sticker.slice(7)) ? (
                <StickerImage src={customUrl(sticker.sticker.slice(7))} attachment={sticker} message={message} />
              ) : sticker.sticker && isStickerId(sticker.sticker) ? (
                <span className="attachment-sticker" role="img" aria-label={t('sticker')}>
                  <StickerArt id={sticker.sticker} play="auto" />
                </span>
              ) : sticker.sticker && isPictureStickerId(sticker.sticker) ? (
                <span className="attachment-sticker" role="img" aria-label={t('sticker')}>
                  <PictureArt id={sticker.sticker} size={120} play="auto" />
                </span>
              ) : sticker.frames && sticker.frames > 1 && sticker.url ? (
                <span
                  className="attachment-sticker sprite"
                  role="img"
                  aria-label={sticker.name || t('sticker')}
                  style={{ backgroundImage: `url("${imageSrc(sticker.url)}")`, '--frames': sticker.frames, '--loop': `${sticker.duration ?? sticker.frames * 0.25}s` } as CSSProperties}
                />
              ) : (
                <StickerImage src={imageSrc(sticker.url)} attachment={sticker} message={message} flattened={sticker.flattened} />
              ))}
            {!sticker && gridded && <MediaGrid conversationId={message.conversationId} tiles={grid.map((attachment) => ({ id: attachment.id, messageId: message.id, attachment }))} />}
            {!sticker &&
              inline
                .filter((attachment) => !gridded?.has(attachment.id))
                .map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} message={message} platform={platform} />)}
            {message.text && (media ? <div className="bubble-caption"><Linkify text={message.text} /></div> : <Linkify text={message.text} />)}
            {message.text && !message.system && <TranslationBlock message={message} />}
            {!message.text && !message.attachments.length && <span style={{ opacity: 0.6 }}>…</span>}
            {message.edited && <span style={{ opacity: 0.6, fontSize: 11 }}> · {t('edited')}</span>}
          </div>
        )}
        {placement !== 'side' && reactionSlot}
      </div>
      {placement === 'side' && reactionSlot}
      {showActions && (
        <div className={`bubble-actions ${picker || moreEmoji || todoOpen || confirmUnsend || moreOpen ? 'open' : ''} ${tips ? 'tips' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
          {features.react && wants('react') && (
            <button className="icon-btn" {...tip(t('react'))} onClick={() => setPicker((p) => !p)}>
              <SmilePlus size={15} strokeWidth={2} />
            </button>
          )}
          {features.reply && wants('reply') && (
            <button className="icon-btn" {...tip(t('reply'))} onClick={() => setReplyTo(message.conversationId, message)}>
              <Reply size={15} strokeWidth={2} />
            </button>
          )}
          {(moreItems.length > 0 || canReact) && (
            <button className={`icon-btn ${moreOpen ? 'active' : ''}`} {...tip(t('moreActions'))} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} aria-haspopup="menu">
              <MoreHorizontal size={16} strokeWidth={2} />
            </button>
          )}
          <Presence modal={false}>
            {moreOpen && (
              <span className="bubble-more-anchor" ref={fitInChat}>
                <div className="context-menu bubble-more-menu" role="menu">
                  {canReact && (
                    <div className="bubble-more-reacts">
                      {(platform === 'zalo' ? ZALO_QUICK : QUICK_REACTIONS).map((emoji) => (
                        <button
                          key={emoji}
                          className={mine === emoji ? 'active' : ''}
                          title={mine === emoji ? t('removeReaction') : undefined}
                          onClick={() => {
                            setMoreOpen(false)
                            void react(message.conversationId, message.id, emoji)
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                      <button
                        className="reaction-more"
                        title={t('moreReactions')}
                        onClick={() => {
                          setMoreOpen(false)
                          setMoreEmoji(true)
                        }}
                      >
                        <Plus size={15} strokeWidth={2.4} />
                      </button>
                    </div>
                  )}
                  {moreItems.map((item) => (
                    <button
                      key={item.key}
                      className={`context-menu-item ${item.danger ? 'danger' : ''}`}
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false)
                        item.run()
                      }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </span>
            )}
          </Presence>
          {todoOpen && <TodoPicker message={message} onClose={() => setTodoOpen(false)} />}
          {time}
          {confirmUnsend && (
            <div className="unsend-confirm" role="dialog" aria-label={t('unsend')}>
              <span>{t('unsendConfirm')}</span>
              <div className="unsend-confirm-buttons">
                <button className="btn ghost small" onClick={() => setConfirmUnsend(false)}>
                  {t('cancel')}
                </button>
                <button
                  className="btn danger small"
                  onClick={() => {
                    setConfirmUnsend(false)
                    void unsend(message.conversationId, message.id)
                  }}
                >
                  {t('unsend')}
                </button>
              </div>
            </div>
          )}
          {picker && (
            <div className="emoji-picker reaction-bar">
              {(platform === 'zalo' ? ZALO_QUICK : QUICK_REACTIONS).map((emoji) => (
                <button
                  key={emoji}
                  className={mine === emoji ? 'active' : ''}
                  title={mine === emoji ? t('removeReaction') : undefined}
                  onClick={() => {
                    setPicker(false)
                    void react(message.conversationId, message.id, emoji)
                  }}
                >
                  {emoji}
                </button>
              ))}
              <button
                className="reaction-more"
                title={t('moreReactions')}
                onClick={() => {
                  setPicker(false)
                  setMoreEmoji(true)
                }}
              >
                <Plus size={16} strokeWidth={2.4} />
              </button>
            </div>
          )}
          <Presence modal={false}>
            {moreEmoji && (
              <span className="reaction-emoji-anchor" ref={fitInChat}>
                {platform === 'zalo' ? (
                  // Zalo only takes its own reactions: offer those, never an emoji it would refuse.
                  <ReactionGrid
                    emojis={ZALO_ALL}
                    current={mine}
                    onPick={(emoji) => {
                      setMoreEmoji(false)
                      void react(message.conversationId, message.id, emoji)
                    }}
                    onClose={() => setMoreEmoji(false)}
                  />
                ) : (
                  <EmojiPicker
                    onPick={(emoji) => {
                      setMoreEmoji(false)
                      void react(message.conversationId, message.id, emoji)
                    }}
                    onClose={() => setMoreEmoji(false)}
                  />
                )}
              </span>
            )}
          </Presence>
        </div>
      )}
      {!showActions && time}
    </div>
  )
}

/** Stickers that would not load this session: not asked for again every time their row scrolls back in. */
const unloadableStickers = new Set<string>()

/**
 * A sticker picture. WhatsApp and Telegram send stickers without a link: the file is fetched through the platform
 * (like a voice note), with a placeholder meanwhile. One that will not show (a dead link, a Telegram animated
 * .tgs) becomes a placeholder with its name instead of a broken image.
 */
function StickerImage({ src, attachment, message, flattened }: { src?: string; attachment: Attachment; message: Message; flattened?: boolean }): JSX.Element {
  const t = useT()
  const loadAttachment = useStore((s) => s.loadAttachment)
  const [loaded, setLoaded] = useState<string>()
  const [broken, setBroken] = useState<string>()
  const key = `${message.conversationId}/${message.id}/${attachment.id}`
  // Nothing to fetch: a bubble still being sent (no platform id yet), or one of your stickers that was deleted.
  const sending = message.id.startsWith('temp-')
  const gone = !!attachment.sticker?.startsWith('custom:')
  const [unloadable, setUnloadable] = useState(() => gone || unloadableStickers.has(key))
  const url = src ?? loaded
  useEffect(() => {
    if (src || sending || gone || unloadableStickers.has(key)) return
    let live = true
    void loadAttachment(message.conversationId, message.id, attachment.id, { quiet: true }).then((next) => {
      if (!next) unloadableStickers.add(key)
      if (!live) return
      if (next) setLoaded(next)
      else setUnloadable(true)
    })
    return () => {
      live = false
    }
  }, [src, sending, gone, key, loadAttachment, message.conversationId, message.id, attachment.id])
  const label = attachment.name || t('sticker')
  if (!url || url === broken) {
    const failed = unloadable || url === broken
    return (
      <span className={`attachment-sticker sticker-placeholder ${failed ? 'failed' : ''}`} role="img" aria-label={label}>
        {failed && label}
      </span>
    )
  }
  return <img className={`attachment-sticker ${flattened ? 'flattened' : ''}`} src={url} alt={label} draggable={false} onError={() => setBroken(url)} />
}

function AttachmentView({ attachment, message, platform }: { attachment: Attachment; message: Message; platform: Platform }): JSX.Element {
  const t = useT()
  // A photo the CDN refuses to serve straight to <img> is fetched again through the app's own
  // session with the platform's referer; if that fails too, a placeholder instead of a broken icon.
  // A picture is tried as a light preview first (made once in the background), then as it is, then through the
  // app's session; only after all three a placeholder.
  const [imageLoad, setImageLoad] = useState<'preview' | 'direct' | 'proxy' | 'failed'>('preview')
  const openLightbox = useStore((s) => s.openLightbox)
  const loadAttachment = useStore((s) => s.loadAttachment)
  const openAttachment = useStore((s) => s.openAttachment)
  const openExternal = (url?: string): void => {
    if (url && /^https?:/.test(url)) void window.unison.app.openExternal(url)
  }
  const viewImage = async (): Promise<void> => {
    const url = attachment.url ?? (await loadAttachment(message.conversationId, message.id, attachment.id)) ?? attachment.thumbnailUrl
    if (url) openLightbox({ url, name: attachment.name, conversationId: message.conversationId })
  }
  switch (attachment.kind) {
    case 'post':
      return <PostCard attachment={attachment} platform={platform} />
    case 'image': {
      if (attachment.expired) return <GoneMedia />
      const direct = attachment.url ?? attachment.thumbnailUrl
      const preview = previewSrc(direct, 960)
      const stage = imageLoad === 'preview' && preview === direct ? 'direct' : imageLoad
      const src = stage === 'preview' ? preview : stage === 'proxy' && direct && /^https:/.test(direct) ? `unison-img://img/?u=${encodeURIComponent(direct)}` : direct
      return src && stage !== 'failed' ? (
        <img
          className="attachment-image"
          src={src}
          alt={t('photo')}
          draggable={false}
          decoding="async"
          onError={() => setImageLoad(stage === 'preview' ? 'direct' : stage === 'direct' && /^https:/.test(direct ?? '') ? 'proxy' : 'failed')}
          onClick={() => void viewImage()}
          style={attachment.width && attachment.height ? ({ ['--ar' as string]: attachment.width / attachment.height } as CSSProperties) : undefined}
        />
      ) : (
        <div className="attachment-image placeholder">{t('photo')}</div>
      )
    }
    case 'video':
      return <VideoThumb attachment={attachment} onFallback={() => (attachment.url && /^https?:/.test(attachment.url) ? openExternal(attachment.url) : void openAttachment(message.conversationId, message.id, attachment.id))} />
    case 'audio':
      return (
        <>
          <AudioPlayer attachment={attachment} message={message} />
          <VoiceTranscript message={message} attachment={attachment} />
        </>
      )
    case 'link':
      return <LinkCard attachment={attachment} />
    case 'sticker':
      return (
        <span>
          {attachment.name} {t('sticker')}
        </span>
      )
    default:
      return (
        <button
          type="button"
          className="attachment-file"
          title={t('openFile')}
          onClick={() => (attachment.url && /^https?:/.test(attachment.url) ? openExternal(attachment.url) : void openAttachment(message.conversationId, message.id, attachment.id))}
        >
          <span className="attachment-file-icon">
            <File size={18} />
          </span>
          <span>
            <span className="attachment-file-name">{attachment.name ?? t('file')}</span>
            <span className="attachment-file-meta">{formatBytes(attachment.size) || attachment.kind}</span>
          </span>
        </button>
      )
  }
}

const LINK_RE = /https?:\/\/[^\s<>"')\]]+/g

/** Plain text with clickable URLs. */
function Linkify({ text }: { text: string }): JSX.Element {
  const parts: Array<string | JSX.Element> = []
  let last = 0
  for (const match of text.matchAll(LINK_RE)) {
    const start = match.index ?? 0
    if (start > last) parts.push(text.slice(last, start))
    const url = match[0]
    parts.push(
      <a key={start} className="attachment-link" href={url} onClick={(e) => (e.preventDefault(), void window.unison.app.openExternal(url))}>
        {url}
      </a>
    )
    last = start + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

const BAR_COUNT = 28
/** Deterministic pseudo-waveform so every voice note has its own shape. */
function barsFor(seed: string): number[] {
  let hash = 7
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff
    return 5 + ((hash >> 8) % 14) + (i % 5 === 0 ? 3 : 0)
  })
}

/** Resample a platform waveform (0..1) to the bar count, 4..22px tall. */
function barsFromWaveform(waveform: number[]): number[] {
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const from = Math.floor((i * waveform.length) / BAR_COUNT)
    const to = Math.max(from + 1, Math.floor(((i + 1) * waveform.length) / BAR_COUNT))
    const slice = waveform.slice(from, to)
    const peak = slice.length ? Math.max(...slice) : 0
    return Math.round(4 + peak * 18)
  })
}

function AudioPlayer({ attachment, message }: { attachment: Attachment; message: Message }): JSX.Element {
  const t = useT()
  const loadAttachment = useStore((s) => s.loadAttachment)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
  const [duration, setDuration] = useState(attachment.duration ?? 0)
  const bars = attachment.waveform?.length ? barsFromWaveform(attachment.waveform) : barsFor(attachment.id)

  const toggle = async (): Promise<void> => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      return
    }
    if (!audio.src || audio.src === window.location.href) {
      if (!attachment.url) {
        setLoading(true)
        const url = await loadAttachment(message.conversationId, message.id, attachment.id)
        setLoading(false)
        if (!url) return
        audio.src = url
      } else {
        audio.src = attachment.url
      }
    }
    try {
      await audio.play()
    } catch {
      /* format not supported */
    }
  }

  const format = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  const shown = playing && duration ? progress * duration : duration

  return (
    <div className="audio-player">
      <button className="audio-play" onClick={() => void toggle()} title={playing ? t('pause') : t('play')}>
        {loading ? <span className="spinner" /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <div className="audio-track">
        <div className="audio-bars">
          {bars.map((h, i) => (
            <span key={i} style={{ height: h }} className={i / BAR_COUNT < progress ? 'played' : ''} />
          ))}
        </div>
        <span className="audio-time">{format(shown)}</span>
      </div>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setProgress(0)
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setDuration(d)
        }}
        onTimeUpdate={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setProgress(e.currentTarget.currentTime / d)
          else if (duration) setProgress(Math.min(1, e.currentTarget.currentTime / duration))
        }}
      />
    </div>
  )
}
