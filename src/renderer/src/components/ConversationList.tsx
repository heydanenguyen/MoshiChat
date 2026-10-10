import { memo, useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createPortal } from 'react-dom'
import { useScrollFade } from '../scrollFade'
import {
  AlarmClock,
  AlarmClockOff,
  Archive,
  ArchiveRestore,
  AtSign,
  BellOff,
  BellRing,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Columns2,
  EyeOff,
  Heart,
  MoreHorizontal,
  Pin,
  PinOff,
  Search,
  Link2,
  SquarePen,
  UserRoundPlus,
  X
} from 'lucide-react'
import { PLATFORMS, type Conversation, type Language, type MessageStatus, type Platform, type TagMeta } from '@shared/types'
import { isPinned, useChatList, useShowPlatformBadge, useShownConversations, useStore, useT, useTagDefs } from '../store'
import { PlatformIcon } from './PlatformIcon'
import { formatBadge, isUnread } from '../quickFilter'
import { formatListTime, modKey, shortcutLabel } from '../utils'
import { openIds } from '../panes'
import { popoverShift } from '../popover'
import { usePresence } from '../usePresence'
import { withViewTransition } from '../viewTransition'
import { flipMoves, reordered } from '../flip'
import { icon } from '../icons'
import { isQuietStyle, rowState } from '../rowState'

/** Drag payload type for a chat row (dropped onto a pane of the chat area). */
export const CONVERSATION_DRAG = 'application/x-moshi-conversation'
import { Avatar } from './Avatar'
import { PreviewText } from './MessageParts'
import { TagChip } from './Tag'
import { ReconnectBanner } from './ChatView'
import { ActiveCallStrip } from './IncomingCallBanner'
import { isBirthdayToday } from '@shared/extras'
import { ListEmpty, QuickFilterEmpty, QuickFilters } from './QuickFilters'
import { AccountFilters } from './AccountFilters'
import { useAccountLabels } from '../accountLabels'
import { isArchived, isChatMuted, isPendingRequest, maskCode } from '@shared/inbox'
import { followState, formatLaterTime, isSnoozed, isWoken } from '@shared/later'
import { Pal } from './Pals'
import { castById, specOf } from '@shared/pals-art'

/** In the Pals style, strangers knocking: the ghost, peeking in with a wink. */
const KNOCKING = specOf(castById('ma'), 'wink')

interface TagMenuState {
  conversationId: string
  x: number
  y: number
  /** Opened from the keyboard: the first item takes focus (otherwise the menu itself does). */
  keyboard?: boolean
}

interface ConversationRowProps {
  c: Conversation
  t: ReturnType<typeof useT>
  language: Language
  selected: boolean
  beside: boolean
  unread: boolean
  muted: boolean
  pinned: boolean
  isTyping: boolean
  typingName: string | undefined
  draft: string | undefined
  /** The Moshi look (UI direction A): the row has its own anatomy; the other styles keep theirs. */
  quiet: boolean
  /** How my last message in this chat stands (only known for chats that were opened); undefined for theirs. */
  lastStatus: MessageStatus | undefined
  timeLabel: string
  /** The app badge on the avatar, if any. */
  badge: Platform | undefined
  /** A merged person: the apps it is on, as 'zalo,telegram' (a string so the row can be compared by value). */
  appsKey: string | undefined
  birthday: boolean
  tagIds: string[] | undefined
  tagById: Record<string, TagMeta>
  accountLabel: string | undefined
  menuOpen: boolean
  later: 'snoozed' | 'back' | 'due' | undefined
  snoozeUntil: number | undefined
  follow: 'waiting' | 'due' | undefined
  followUntil: number | undefined
  mentionsOnly: boolean
  archivedMark: boolean
  requestMark: boolean
  canSplit: boolean
  onOpen: (id: string, beside: boolean) => void
  onHover: (id: string) => void
  onLeave: () => void
  /** `keyboard`: opened with the ContextMenu key (focus goes into the menu). */
  onContext: (id: string, x: number, y: number, keyboard?: boolean) => void
  onMore: (el: HTMLElement, id: string, keyboard?: boolean) => void
}

/**
 * One chat in the list. Everything it shows arrives as a plain value or a stable function, so a row is redrawn only
 * when its own chat changes, not for each typing event, draft or incoming message elsewhere in the list.
 */
const ConversationRow = memo(function ConversationRow({
  c,
  t,
  language,
  selected,
  beside,
  unread,
  muted,
  pinned,
  isTyping,
  typingName,
  draft,
  quiet,
  lastStatus,
  timeLabel,
  badge,
  appsKey,
  birthday,
  tagIds,
  tagById,
  accountLabel,
  menuOpen,
  later,
  snoozeUntil,
  follow,
  followUntil,
  mentionsOnly,
  archivedMark,
  requestMark,
  canSplit,
  onOpen,
  onHover,
  onLeave,
  onContext,
  onMore
}: ConversationRowProps): JSX.Element {
  const preview = c.lastMessage
  const prefix = preview && !isTyping && (preview.isOutgoing || c.isGroup) ? `${preview.isOutgoing ? t('you') : preview.senderName.split(' ')[0]}: ` : ''
  const convTags = (tagIds ?? []).filter((tag) => tagById[tag])
  const apps = appsKey?.split(',') as Platform[] | undefined
  const state = rowState({ unread, muted, isTyping, draft, selected, lastOutgoing: !!preview?.isOutgoing, status: lastStatus, tagIds: convTags })
  // Quiet: one tag chip, the rest are in Details. Other styles: two and a "+n".
  const shownTags = quiet ? (state.chip ? [state.chip] : []) : convTags.slice(0, 2)
  return (
    <>
      <button
        className={`conv-item ${selected ? 'selected' : ''} ${beside ? 'beside' : ''} ${unread ? 'unread' : ''} ${muted ? 'muted' : ''} ${quiet ? 'quiet' : ''}`}
        data-id={c.id}
        aria-haspopup="menu"
        onClick={(e) => onOpen(c.id, canSplit && (e.metaKey || e.ctrlKey))}
        draggable={canSplit}
        onDragStart={(e) => {
          e.dataTransfer.setData(CONVERSATION_DRAG, c.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        // Resting on a chat for a moment starts loading it, so opening feels instant.
        onMouseEnter={() => onHover(c.id)}
        onMouseLeave={onLeave}
        onContextMenu={(e) => {
          e.preventDefault()
          onContext(c.id, e.clientX, e.clientY)
        }}
        onKeyDown={(e) => {
          // The ContextMenu key and Shift+F10 open the same menu as a right-click.
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault()
            onMore(e.currentTarget, c.id, true)
          }
        }}
      >
        {quiet && state.dot && (c.unreadCount > 0 ? <i className="conv-dot" aria-hidden /> : <i className="conv-dot" role="img" aria-label={t('markedUnread')} title={t('markedUnread')} />)}
        <Avatar name={c.title} url={c.avatarUrl} size={quiet ? 40 : 44} platform={badge} />
        <span className="conv-body">
          <span className="conv-top">
            <span className="conv-title">
              <span className="conv-name">{c.title}</span>
              {apps && (
                <span className="conv-apps" title={apps.map((p) => PLATFORMS[p].name).join(' · ')}>
                  {[...new Set(apps)].map((p) => (
                    <PlatformIcon key={p} platform={p} size={12} />
                  ))}
                </span>
              )}
              {birthday && (
                <span className="conv-birthday" title={t('birthdayToday', { name: c.title })}>
                  🎂
                </span>
              )}
              {convTags.length > 0 && (
                <span className="conv-tags" title={convTags.map((tag) => tagById[tag].name[language]).join(', ')}>
                  {shownTags.map((tag) => (
                    <TagChip key={tag} tag={tagById[tag]} size="xs" iconOnly />
                  ))}
                  {!quiet && convTags.length > 2 && <span className="conv-tags-more">+{convTags.length - 2}</span>}
                </span>
              )}
            </span>
            {accountLabel && (
              <span className="conv-account" title={t('viaAccount', { account: accountLabel })}>
                {accountLabel}
              </span>
            )}
            <span className="conv-corner">
              <span className="conv-time">{timeLabel}</span>
            </span>
          </span>
          <span className="conv-bottom">
            {later === 'snoozed' ? (
              <span className="later-chip snoozed" title={t('laterSnoozedUntil', { time: formatLaterTime(snoozeUntil!, language) })}>
                <AlarmClock size={11} strokeWidth={2.6} aria-hidden />
                {formatLaterTime(snoozeUntil!, language)}
              </span>
            ) : later === 'back' ? (
              <span className="later-chip back">
                <AlarmClock size={11} strokeWidth={2.6} aria-hidden />
                {t('laterBack')}
              </span>
            ) : later === 'due' ? (
              <span className="later-chip due">
                <BellRing size={11} strokeWidth={2.6} aria-hidden />
                {t('laterNoReply')}
              </span>
            ) : null}
            <span className={`conv-preview ${isTyping ? 'typing' : ''}`}>
              {!isTyping && draft && !selected ? (
                <>
                  <span className="conv-draft">{t('draft')}</span> {draft}
                </>
              ) : isTyping ? (
                <>
                  {quiet && (
                    <span className="typing-dots" aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  {c.isGroup ? t('typingIn', { name: typingName ?? '' }) : t('typing')}
                </>
              ) : (
                <>
                  {quiet && state.receipt && (
                    <span className={`conv-receipt ${state.receipt}`} role="img" aria-label={state.receipt === 'read' ? t('read') : t('delivered')}>
                      {state.receipt === 'read' ? <CheckCheck {...icon(16)} /> : <Check {...icon(16)} />}
                    </span>
                  )}
                  {prefix}
                  <PreviewText kind={preview?.kind} text={maskCode(preview?.text ?? '')} />
                </>
              )}
            </span>
            <span className="conv-meta">
              {follow === 'waiting' && (
                <span
                  className="conv-follow-mark"
                  role="img"
                  title={t('laterFollowingUntil', { time: formatLaterTime(followUntil!, language) })}
                  aria-label={t('laterFollowingUntil', { time: formatLaterTime(followUntil!, language) })}
                >
                  <BellRing size={12} strokeWidth={2.2} />
                </span>
              )}
              {pinned && <Pin size={12} strokeWidth={2.2} className="conv-pinned-mark" />}
              {muted ? <BellOff size={12} strokeWidth={2.2} /> : mentionsOnly && <AtSign size={12} strokeWidth={2.4} aria-label={t('mentionsOnly')} />}
              {quiet && state.close && (
                <span className="conv-close-mark" role="img" title={t('insights')} aria-label={t('insights')}>
                  <Heart {...icon(15)} />
                </span>
              )}
              {archivedMark && <Archive size={12} strokeWidth={2.2} aria-label={t('archivedMark')} />}
              {requestMark && <UserRoundPlus size={12} strokeWidth={2.2} aria-label={t('requestsTitle')} />}
              {c.unreadCount > 0 ? (
                <span className="unread-pill">{formatBadge(c.unreadCount)}</span>
              ) : (
                !quiet && unread && <span className="unread-pill dot" role="img" aria-label={t('markedUnread')} title={t('markedUnread')} />
              )}
            </span>
          </span>
        </span>
      </button>
      {/* A sibling of the row, not inside it: a button in a button is not valid and a screen reader cannot reach it. */}
      <button
        type="button"
        className={`conv-more ${menuOpen ? 'open' : ''}`}
        // Only the open chat's button is a tab stop (every row would add one); the other rows use the ContextMenu key.
        tabIndex={selected || menuOpen ? 0 : -1}
        title={t('moreActions')}
        aria-label={t('moreActions')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => onMore(e.currentTarget, c.id, e.detail === 0)}
      >
        <MoreHorizontal size={15} strokeWidth={2.4} />
      </button>
    </>
  )
})

export function ConversationList(): JSX.Element {
  const t = useT()
  const { conversations, counts, archivedCount, requestCount, snoozedCount } = useChatList()
  const listView = useStore((s) => s.listView)
  const setListView = useStore((s) => s.setListView)
  const acceptedRequests = useStore((s) => s.settings.acceptedRequests)
  const archived = useStore((s) => s.settings.archived)
  const archive = useStore((s) => s.archive)
  const unarchive = useStore((s) => s.unarchive)
  const snoozed = useStore((s) => s.settings.snoozed)
  const followUps = useStore((s) => s.settings.followUps)
  const unsnooze = useStore((s) => s.unsnooze)
  const cancelFollowUp = useStore((s) => s.cancelFollowUp)
  const openLaterPicker = useStore((s) => s.openLaterPicker)
  const laterOn = useStore((s) => s.settings.laterTools !== false)
  const mentionsOnly = useStore((s) => s.settings.mentionsOnly)
  const toggleMentionsOnly = useStore((s) => s.toggleMentionsOnly)
  const allConversations = useShownConversations()
  const rawConversations = useStore((s) => s.conversations)
  const quickFilter = useStore((s) => s.quickFilter)
  const markedUnread = useStore((s) => s.settings.markedUnread)
  const markUnread = useStore((s) => s.markUnread)
  const markRead = useStore((s) => s.markRead)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const openBeside = useStore((s) => s.openBeside)
  const layout = useStore((s) => s.layout)
  const canSplit = useStore((s) => s.wide && !s.narrow)
  const beside = new Set(openIds(layout).filter((id) => id !== selectedId))
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const searchHits = useStore((s) => s.searchHits)
  const openHit = useStore((s) => s.openHit)
  const filter = useStore((s) => s.filter)
  const accounts = useStore((s) => s.accounts)
  const typing = useStore((s) => s.typing)
  const language = useStore((s) => s.settings.language)
  const tags = useStore((s) => s.settings.tags)
  const toggleTag = useStore((s) => s.toggleTag)
  const overrides = useStore((s) => s.settings.contactOverrides)
  const prefetch = useStore((s) => s.prefetch)
  const drafts = useStore((s) => s.drafts)
  const pals = useStore((s) => s.settings.style === 'pals')
  const quiet = useStore((s) => isQuietStyle(s.settings.style))
  // How my last message stands, for the chats that were opened (message id -> status). One string, so the list only
  // redraws when a receipt changes; the Moshi look is the only one that shows it.
  const receiptKey = useStore((s) => {
    if (!isQuietStyle(s.settings.style)) return ''
    let key = ''
    for (const id in s.messages) {
      const last = s.messages[id]?.at(-1)
      if (last?.isOutgoing) key += `${last.id}|${last.status};`
    }
    return key
  })
  const receipts = new Map<string, MessageStatus>(receiptKey.split(';').filter(Boolean).map((pair) => [pair.slice(0, pair.lastIndexOf('|')), pair.slice(pair.lastIndexOf('|') + 1) as MessageStatus]))
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pins = useStore((s) => s.settings.pins)
  const togglePin = useStore((s) => s.togglePin)
  const { list: tagList, byId: tagById } = useTagDefs()
  const muted = useStore((s) => s.settings.muted)
  const toggleMute = useStore((s) => s.toggleMute)
  const openSheet = useStore((s) => s.openSheet)
  const showBadge = useShowPlatformBadge()
  // Which account a chat is on, where an app has more than one (not needed once a single account is picked).
  const accountLabels = useAccountLabels()
  const [menu, setMenu] = useState<TagMenuState | undefined>()
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useScrollFade(listRef)
  // Only the rows on screen (and a few around them) exist: with a few thousand chats the list used to hold every row,
  // tens of thousands of nodes, and re-rendered them all for each incoming message.
  const rowsTop = useRef<HTMLDivElement>(null)
  const [rowsOffset, setRowsOffset] = useState(0)
  const hidden = useStore((s) => s.settings.hidden)
  const hideConversation = useStore((s) => s.hideConversation)
  /**
   * The "…" button opens the same menu as a right-click, hanging under the button and kept inside the window. Only
   * a click opens it (resting the pointer on it does not); a second click closes it.
   */
  const openMenuAt = useCallback((el: HTMLElement, conversationId: string, keyboard = false): void => {
    const r = el.getBoundingClientRect()
    setMenu((m) => (m?.conversationId === conversationId ? undefined : { conversationId, keyboard, x: Math.max(8, Math.min(r.right - 210, window.innerWidth - 226)), y: r.bottom + 4 }))
  }, [])
  // Handlers the memoised rows are given: they stay the same function while the store's actions do.
  const openRow = useCallback(
    (id: string, besideIt: boolean): void => {
      if (besideIt) return openBeside(id)
      // On a phone-sized window the list slides away to the chat.
      if (useStore.getState().narrow) withViewTransition('to-chat', () => select(id))
      else select(id)
    },
    [openBeside, select]
  )
  const hoverRow = useCallback(
    (id: string): void => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      hoverTimer.current = setTimeout(() => void prefetch(id), 250)
    },
    [prefetch]
  )
  const leaveRow = useCallback((): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
  }, [])
  const menuRow = useCallback((id: string, x: number, y: number, keyboard = false): void => setMenu({ conversationId: id, x, y, keyboard }), [])
  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => (quiet ? 64 : 68),
    overscan: 8,
    // What sits above the rows in the same scroller (the requests row, a filter note) shifts them down.
    scrollMargin: rowsOffset,
    getItemKey: (i) => conversations[i]?.id ?? i
  })
  // Measured again whenever what sits above the rows can change.
  useLayoutEffect(() => {
    const top = rowsTop.current?.offsetTop ?? 0
    if (top !== rowsOffset) setRowsOffset(top)
  }, [rowsOffset, requestCount, listView, quickFilter, search, conversations.length])
  // A chat that a new message moves up slides there (FLIP) instead of jumping: only the rows on screen both before and
  // after, only when the order changed (not when a height was measured), and not under reduced motion.
  const lastRows = useRef<{ ids: string[]; pos: Map<string, number> }>({ ids: [], pos: new Map() })
  useLayoutEffect(() => {
    const rows = virtualizer.getVirtualItems().map((v) => ({ id: conversations[v.index]?.id ?? '', y: v.start - virtualizer.options.scrollMargin, size: v.size }))
    const before = lastRows.current
    const ids = rows.map((row) => row.id)
    lastRows.current = { ids, pos: new Map(rows.map((row) => [row.id, row.y])) }
    const list = listRef.current
    const container = rowsTop.current
    if (!list || !container || !before.ids.length || !reordered(before.ids, ids)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const top = list.scrollTop - rowsOffset
    for (const move of flipMoves(before.pos, rows, { top, bottom: top + list.clientHeight })) {
      const el = container.querySelector<HTMLElement>(`:scope > [data-id="${CSS.escape(move.id)}"]`)
      if (!el) continue
      // Promoted for the slide only (a text layer kept promoted renders its text differently on Windows).
      el.style.willChange = 'transform'
      const slide = el.animate([{ transform: `translateY(${move.from}px)` }, { transform: `translateY(${move.to}px)` }], { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      slide.onfinish = slide.oncancel = () => {
        el.style.willChange = ''
      }
    }
  })
  const hasAccounts = Object.keys(accounts).length > 0
  const searching = search.trim().length > 0
  // One clock reading for the whole list render (snooze and follow-up states, typing).
  const now = Date.now()
  const mutedChat = (c: Conversation): boolean => isChatMuted({ muted, tags }, c)
  const archivedChat = (c: Conversation): boolean => isArchived(c, archived?.[c.id], mutedChat(c))
  // The menu stays mounted while it fades out, with what it showed.
  const lastMenu = useRef<TagMenuState | undefined>(undefined)
  if (menu) lastMenu.current = menu
  const shown = menu ?? lastMenu.current
  const { mounted: menuMounted, state: menuState } = usePresence(!!menu)
  // From the store, not the list: a chat can leave the filtered list while its menu is open (untagging it).
  const menuConversation = shown ? allConversations[shown.conversationId] : undefined
  const menuUnread = !!menuConversation && isUnread(menuConversation, markedUnread)
  const menuArchived = !!menuConversation && archivedChat(menuConversation)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(undefined)
    // A key pressed anywhere but in the menu closes it (the menu handles its own keys).
    const onKey = (e: KeyboardEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // Focus goes into the menu when it opens (the first item from the keyboard) and back to the chat's row when it
  // closes, unless the person has already moved on to something else.
  const menuChat = menu?.conversationId
  useEffect(() => {
    if (!menuChat) return
    const el = menuRef.current
    const list = listRef.current
    if (el) {
      const first = el.querySelector<HTMLElement>('[role^="menuitem"]')
      ;(lastMenu.current?.keyboard && first ? first : el).focus({ preventScroll: true })
    }
    return () => {
      const at = document.activeElement
      if (at && at !== document.body && !el?.contains(at)) return
      list?.querySelector<HTMLElement>(`.conv-item[data-id="${CSS.escape(menuChat)}"]`)?.focus({ preventScroll: true })
    }
  }, [menuChat])

  // Arrow keys walk the items (wrapping), Home and End jump, Escape and Tab close.
  const onMenuKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      setMenu(undefined)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const from = at < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : at
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (from + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next].focus()
  }

  // A right-click low in the list, or near the window's right edge, used to open the menu past the window: move
  // it back inside. offsetWidth/Height ignore the open animation's scale, so this is the size the menu settles at.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el || !menu) return
    const dx = popoverShift({ left: menu.x, right: menu.x + el.offsetWidth }, { left: 0, right: window.innerWidth })
    const dy = popoverShift({ left: menu.y, right: menu.y + el.offsetHeight }, { left: 0, right: window.innerHeight })
    el.style.left = `${menu.x + dx}px`
    el.style.top = `${menu.y + dy}px`
  }, [menu])

  const title =
    filter === 'all'
      ? t('messages')
      : filter.startsWith('account:')
        ? (accounts[filter.slice(8)]?.displayName ?? t('messages'))
        : filter.startsWith('tag:')
          ? (tagById[filter.slice(4)]?.name[language] ?? t('messages'))
          : PLATFORMS[filter as Platform].name

  const visibleHits = searchHits.filter((h) => {
    if (hidden?.[h.conversation.id]) return false
    if (filter === 'all') return true
    if (filter.startsWith('account:')) return h.conversation.accountId === filter.slice(8)
    if (filter.startsWith('tag:')) return (tags[h.conversation.id] ?? []).includes(filter.slice(4))
    return h.conversation.platform === filter
  })

  // Why the list is empty, if it is: nothing found, an empty archive, a chip with nothing in it (the inbox has
  // chats), everything archived, or no chats at all (the usual "no conversations" note).
  const empty =
    conversations.length > 0
      ? undefined
      : searching
        ? visibleHits.length === 0
          ? 'no-results'
          : undefined
        : listView === 'archive'
          ? 'archive'
          : listView === 'requests'
            ? 'requests'
            : listView === 'snoozed'
              ? 'snoozed'
              : counts.all > 0 && quickFilter !== 'all'
                ? 'chip'
                : archivedCount > 0
                  ? 'inbox-zero'
                  : requestCount > 0
                    ? undefined // only requests so far: the Requests row says it all
                    : 'no-chats'

  return (
    <section className="list-col">
      <header className={`list-header drag ${listView !== 'inbox' ? 'in-archive' : ''}`}>
        {listView !== 'inbox' ? (
          <div className="list-title-row" key={listView}>
            <button
              className="icon-btn no-drag list-back"
              onClick={() => setListView('inbox')}
              title={listView === 'archive' ? `${t('archiveBack')} (${shortcutLabel(';')})` : t('archiveBack')}
              aria-label={t('archiveBack')}
            >
              <ChevronLeft size={20} strokeWidth={2.2} />
            </button>
            <h1 className="list-title">{listView === 'archive' ? t('archiveTitle') : listView === 'snoozed' ? t('snoozedTitle') : t('requestsTitle')}</h1>
          </div>
        ) : (
          <h1 className="list-title">{title}</h1>
        )}
        <div className="list-header-actions no-drag">
          {listView === 'inbox' && snoozedCount > 0 && (
            <button className="icon-btn archive-btn" onClick={() => setListView('snoozed')} title={t('snoozedShow')} aria-label={`${t('snoozedShow')}, ${snoozedCount}`}>
              <AlarmClock size={17} strokeWidth={2} />
              <span className="archive-btn-count" aria-hidden>
                {formatBadge(snoozedCount)}
              </span>
            </button>
          )}
          {listView === 'inbox' && archivedCount > 0 && (
            <button
              className="icon-btn archive-btn"
              onClick={() => setListView('archive')}
              title={`${t('archiveShow')} (${shortcutLabel(';')})`}
              aria-label={`${t('archiveShow')}, ${archivedCount}`}
            >
              <Archive size={17} strokeWidth={2} />
              <span className="archive-btn-count" aria-hidden>
                {formatBadge(archivedCount)}
              </span>
            </button>
          )}
          <button className="icon-btn" title={`${t('newChat')} (${shortcutLabel('N')})`} onClick={() => openSheet({ kind: 'new-chat' })}>
            <SquarePen size={18} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="search-field">
        <Search size={14} strokeWidth={2.4} />
        <input type="text" placeholder={t('searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
        {search && (
          <button className="search-clear" onClick={() => setSearch('')} aria-label={t('close')}>
            <X size={11} strokeWidth={3} />
          </button>
        )}
      </div>

      {!searching && listView === 'inbox' && <AccountFilters />}
      {!searching && listView === 'inbox' && (counts.all > 0 || quickFilter !== 'all') && <QuickFilters counts={counts} />}
      {!searching && listView === 'requests' && <p className="requests-note">{t('requestsNote')}</p>}

      {Object.values(accounts)
        .filter((a) => !a.demo && (a.status === 'needs_auth' || a.status === 'error' || a.error?.startsWith('relay-offline:')))
        .filter((a) => filter === 'all' || filter === a.platform || filter === `account:${a.id}`)
        .map((a) => (
          <ReconnectBanner key={a.id} accountId={a.id} status={a.status} reason={a.error} label={`${PLATFORMS[a.platform].name}${a.handle ? ` ${a.handle}` : ''}`} />
        ))}
      <ActiveCallStrip />
      <div className="conv-list scroll edge-fade" ref={listRef}>
        {empty === 'chip' && quickFilter !== 'all' && <QuickFilterEmpty filter={quickFilter} />}
        {!searching && listView === 'inbox' && requestCount > 0 && (
          <button className="requests-row" onClick={() => setListView('requests')}>
            <span className="requests-row-icon" aria-hidden>
              {pals ? <Pal spec={KNOCKING} size={40} /> : <UserRoundPlus size={18} strokeWidth={2.2} />}
            </span>
            <span className="requests-row-text">
              <span className="requests-row-title">{t('requestsTitle')}</span>
              <span className="requests-row-sub">{t('requestsRowHint', { count: requestCount })}</span>
            </span>
            <span className="requests-row-count">{formatBadge(requestCount)}</span>
            <ChevronRight size={16} strokeWidth={2.2} className="requests-row-chevron" aria-hidden />
          </button>
        )}
        {empty === 'requests' && <ListEmpty glyph="📬" title={t('requestsEmpty')} hint={t('requestsEmptyHint')} />}
        {empty === 'snoozed' && <ListEmpty glyph="⏰" title={t('snoozedEmpty')} hint={t('snoozedEmptyHint', { key: shortcutLabel('H', true) })} />}
        {empty === 'archive' && <ListEmpty glyph="🗂️" title={t('archiveEmpty')} hint={t('archiveEmptyHint', { key: shortcutLabel('E') })} />}
        {empty === 'inbox-zero' && (
          <ListEmpty glyph="🌤️" title={t('inboxZero')} hint={t('inboxZeroHint')} action={{ label: t('archiveShow'), run: () => setListView('archive') }} />
        )}
        {(empty === 'no-results' || empty === 'no-chats') && (
          <div className="conv-empty">
            <strong>{searching ? t('noResults') : t('noConversations')}</strong>
            {!searching && !hasAccounts && t('noConversationsHint')}
          </div>
        )}
        {searching && conversations.length > 0 && <div className="conv-group-label">{t('conversationsSection')}</div>}
        <div ref={rowsTop} className="conv-rows" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const c = conversations[v.index]
            const isTyping = !!typing[c.id] && typing[c.id].until > now
            const snoozeEntry = snoozed?.[c.id]
            const follow = followState(followUps?.[c.id], now)
            // A merged person: the badge shows the app of the newest message, the title lists every app.
            const memberChats = c.members?.map((id) => rawConversations[id]).filter((m): m is Conversation => !!m)
            const merged = !!memberChats && memberChats.length > 1
            const latestApp = memberChats?.find((m) => m.lastMessage && m.lastMessage.id === c.lastMessage?.id)?.platform ?? c.platform
            return (
              <div
                key={v.key}
                data-id={c.id}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className="conv-row"
                style={{ transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
              >
                <ConversationRow
                  c={c}
                  t={t}
                  language={language}
                  selected={selectedId === c.id}
                  beside={beside.has(c.id)}
                  unread={isUnread(c, markedUnread)}
                  muted={mutedChat(c)}
                  pinned={isPinned(c, pins)}
                  isTyping={isTyping}
                  typingName={isTyping ? typing[c.id].name : undefined}
                  draft={drafts[c.id]}
                  quiet={quiet}
                  lastStatus={c.lastMessage?.isOutgoing ? receipts.get(c.lastMessage.id) : undefined}
                  timeLabel={c.updatedAt > 0 ? formatListTime(c.updatedAt, language) : ''}
                  badge={merged ? latestApp : showBadge ? c.platform : undefined}
                  appsKey={merged ? memberChats.map((m) => m.platform).join(',') : undefined}
                  birthday={isBirthdayToday(overrides?.[c.id]?.birthday)}
                  tagIds={tags[c.id]}
                  tagById={tagById}
                  accountLabel={!merged && !filter.startsWith('account:') ? accountLabels[c.accountId] : undefined}
                  menuOpen={menu?.conversationId === c.id}
                  later={isSnoozed(snoozeEntry, now) ? 'snoozed' : isWoken(snoozeEntry, now) ? 'back' : follow === 'due' ? 'due' : undefined}
                  snoozeUntil={snoozeEntry?.until}
                  follow={follow}
                  followUntil={followUps?.[c.id]?.until}
                  mentionsOnly={!!mentionsOnly?.[c.id]}
                  archivedMark={searching && archivedChat(c)}
                  requestMark={searching && isPendingRequest(c, acceptedRequests)}
                  canSplit={canSplit}
                  onOpen={openRow}
                  onHover={hoverRow}
                  onLeave={leaveRow}
                  onContext={menuRow}
                  onMore={openMenuAt}
                />
              </div>
            )
          })}
        </div>

        {searching && visibleHits.length > 0 && (
          <>
            <div className="conv-group-label">{t('messagesSection')}</div>
            {visibleHits.map((hit) => (
              <button key={`${hit.conversation.id}#${hit.message.id}`} className="conv-item hit" onClick={() => openHit(hit)}>
                <Avatar name={hit.conversation.title} url={hit.conversation.avatarUrl} size={36} platform={showBadge ? hit.conversation.platform : undefined} />
                <span className="conv-body">
                  <span className="conv-top">
                    <span className="conv-title">{hit.conversation.title}</span>
                    <span className="conv-time">{formatListTime(hit.message.sentAt, language)}</span>
                  </span>
                  <span className="conv-bottom">
                    <span className="conv-preview">
                      {hit.message.isOutgoing ? `${t('you')}: ` : hit.conversation.isGroup ? `${hit.message.senderName.split(' ')[0]}: ` : ''}
                      <Highlight text={hit.message.text || hit.message.attachments[0]?.name || ''} query={search} />
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Rendered at the document root: the glass column would otherwise clip a fixed menu. */}
      {menuMounted &&
        shown &&
        createPortal(
          <div
            ref={menuRef}
            className="context-menu"
            role="menu"
            data-focus-return={`.conv-item[data-id="${CSS.escape(shown.conversationId)}"]`}
            aria-label={t('moreActions')}
            tabIndex={-1}
            data-state={menuState}
            {...(menuState === 'closing' ? { inert: '' } : undefined)}
            style={{ left: shown.x, top: shown.y, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
            onKeyDown={onMenuKey}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {menuConversation && (
              <button
                className="context-menu-item" role="menuitem"
                onClick={() => {
                  void (menuUnread ? markRead : markUnread)(menuConversation.id)
                  setMenu(undefined)
                }}
              >
                {menuUnread ? <CheckCheck size={15} /> : <CircleDot size={15} />}
                <span>{menuUnread ? t('markRead') : t('markUnread')}</span>
                <span className="context-menu-shortcut">{shortcutLabel('U', true)}</span>
              </button>
            )}
            {menuConversation && !menuConversation.isGroup && (
              <button
                className="context-menu-item" role="menuitem"
                onClick={() => {
                  openSheet({ kind: 'merge', conversationId: menuConversation.id })
                  setMenu(undefined)
                }}
              >
                <Link2 size={15} />
                <span>{t('mergeWith')}</span>
              </button>
            )}
            {menuConversation && (
              <button
                className="context-menu-item" role="menuitem"
                onClick={() => {
                  void (menuArchived ? unarchive : archive)(menuConversation.id)
                  setMenu(undefined)
                }}
              >
                {menuArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                <span>{menuArchived ? t('unarchive') : t('archive')}</span>
                <span className="context-menu-shortcut">{shortcutLabel('E')}</span>
              </button>
            )}
            {menuConversation &&
              laterOn &&
              (isSnoozed(snoozed?.[menuConversation.id]) ? (
                <button
                  className="context-menu-item" role="menuitem"
                  onClick={() => {
                    void unsnooze(menuConversation.id)
                    setMenu(undefined)
                  }}
                >
                  <AlarmClockOff size={15} />
                  <span>{t('unsnoozeAction')}</span>
                  <span className="context-menu-shortcut">{formatLaterTime(snoozed![menuConversation.id].until, language)}</span>
                </button>
              ) : (
                <button
                  className="context-menu-item" role="menuitem"
                  onClick={() => {
                    openLaterPicker({ conversationId: menuConversation.id, mode: 'snooze', x: shown.x, y: shown.y })
                    setMenu(undefined)
                  }}
                >
                  <AlarmClock size={15} />
                  <span>{t('snoozeAction')}</span>
                  <span className="context-menu-shortcut">{shortcutLabel('H', true)}</span>
                </button>
              ))}
            {menuConversation &&
              laterOn &&
              (followState(followUps?.[menuConversation.id]) === 'waiting' ? (
                <button
                  className="context-menu-item" role="menuitem"
                  onClick={() => {
                    void cancelFollowUp(menuConversation.id)
                    setMenu(undefined)
                  }}
                >
                  <BellRing size={15} />
                  <span>{t('unfollowAction')}</span>
                  <span className="context-menu-shortcut">{formatLaterTime(followUps![menuConversation.id].until, language)}</span>
                </button>
              ) : (
                <button
                  className="context-menu-item" role="menuitem"
                  onClick={() => {
                    openLaterPicker({ conversationId: menuConversation.id, mode: 'follow', x: shown.x, y: shown.y })
                    setMenu(undefined)
                  }}
                >
                  <BellRing size={15} />
                  <span>{t('followAction')}</span>
                </button>
              ))}
            {canSplit && shown.conversationId !== selectedId && (
              <button
                className="context-menu-item" role="menuitem"
                onClick={() => {
                  openBeside(shown.conversationId)
                  setMenu(undefined)
                }}
              >
                <Columns2 size={15} />
                <span>{t('openBeside')}</span>
                <span className="context-menu-shortcut">{modKey}·click</span>
              </button>
            )}
            <button
              className="context-menu-item" role="menuitem"
              onClick={() => {
                void togglePin(shown.conversationId)
                setMenu(undefined)
              }}
            >
              {isPinned(menuConversation, pins) ? <PinOff size={15} /> : <Pin size={15} />}
              <span>{isPinned(menuConversation, pins) ? t('unpin') : t('pin')}</span>
            </button>
            <button
              className="context-menu-item" role="menuitem"
              onClick={() => {
                void toggleMute('conversations', shown.conversationId)
                setMenu(undefined)
              }}
            >
              <BellOff size={15} />
              <span>{muted.conversations.includes(shown.conversationId) ? t('unmute') : t('mute')}</span>
            </button>
            {menuConversation?.isGroup && (
              <button
                className={`context-menu-item ${mentionsOnly?.[menuConversation.id] ? 'active' : ''}`}
                role="menuitemcheckbox"
                aria-checked={!!mentionsOnly?.[menuConversation.id]}
                onClick={() => {
                  void toggleMentionsOnly(menuConversation.id)
                  setMenu(undefined)
                }}
              >
                <AtSign size={15} />
                <span>{t('mentionsOnly')}</span>
                {mentionsOnly?.[menuConversation.id] && <span className="context-menu-check">✓</span>}
              </button>
            )}
            <button
              className="context-menu-item" role="menuitem"
              onClick={() => {
                void hideConversation(shown.conversationId)
                setMenu(undefined)
              }}
            >
              <EyeOff size={15} />
              <span>{t('hide')}</span>
            </button>
            <div className="context-menu-title" role="presentation">{t('tags')}</div>
            {tagList.map((tag) => {
              const active = (tags[shown.conversationId] ?? []).includes(tag.id)
              return (
                <button key={tag.id} className={`context-menu-item tag-row ${active ? 'active' : ''}`} role="menuitemcheckbox" aria-checked={active} onClick={() => void toggleTag(shown.conversationId, tag.id)}>
                  <TagChip tag={tag} size="sm" flat={!active} />
                  {active && <span className="context-menu-check">✓</span>}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </section>
  )
}

export function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
  const needle = query.trim().toLowerCase()
  const index = text.toLowerCase().indexOf(needle)
  if (index < 0 || !needle) return <>{text}</>
  const start = Math.max(0, index - 24)
  return (
    <>
      {start > 0 ? '…' : ''}
      {text.slice(start, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  )
}
