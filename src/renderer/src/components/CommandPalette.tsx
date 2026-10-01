import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlarmClock,
  Lock,
  BellRing,
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Columns2,
  DatabaseBackup,
  Inbox,
  Info,
  ListTodo,
  Mail,
  MailOpen,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Sun,
  Users
} from 'lucide-react'
import { PLATFORMS, type Conversation } from '@shared/types'
import { foldName, maskCode } from '@shared/inbox'
import { isArchivedNow, isPinned, useShowPlatformBadge, useShownConversations, useStore, useT } from '../store'
import { isUnread } from '../quickFilter'
import { isMac, shortcutLabel } from '../utils'
import type { TKey } from '../i18n'
import { Avatar } from './Avatar'

interface Command {
  id: string
  label: string
  /** Extra words it answers to, in both languages (so "dark" finds it in Vietnamese too). */
  keywords: string
  icon: JSX.Element
  shortcut?: string
  run(): void
}

type Row = { kind: 'chat'; conversation: Conversation } | { kind: 'command'; command: Command }

const ICON = { size: 16, strokeWidth: 2.2 }

/**
 * ⌘K: jump to a chat or run a command. Chats come first; commands follow, the ones about the open chat on
 * top. Typing searches both (accents do not matter); a leading ">" searches commands only.
 */
export function CommandPalette(): JSX.Element {
  const t = useT()
  const conversations = useShownConversations()
  const hidden = useStore((s) => s.settings.hidden)
  const select = useStore((s) => s.select)
  const closeSheet = useStore((s) => s.closeSheet)
  const showBadge = useShowPlatformBadge()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => ref.current?.focus(), [])

  const commands = useCommands()
  const commandsOnly = query.trimStart().startsWith('>')
  const q = foldName(query.trim().replace(/^>\s*/, ''))

  const rows = useMemo((): Row[] => {
    // Hidden chats (Strangers) stay out of sight here too; archived ones are still found.
    const chats = commandsOnly
      ? []
      : Object.values(conversations)
          .filter((c) => !hidden?.[c.id])
          .filter((c) => !q || foldName(c.title).includes(q) || c.participants.some((p) => p.handle && foldName(p.handle).includes(q)))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, q ? 8 : 6)
    const matched = commands.filter((c) => !q || foldName(`${c.label} ${c.keywords}`).includes(q))
    return [...chats.map((conversation): Row => ({ kind: 'chat', conversation })), ...matched.map((command): Row => ({ kind: 'command', command }))]
  }, [conversations, hidden, q, commandsOnly, commands])

  useEffect(() => setIndex(0), [query])

  // Keep the highlighted row in view while moving with the arrow keys.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.command-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (row: Row | undefined): void => {
    if (!row) return
    if (row.kind === 'chat') return select(row.conversation.id)
    closeSheet()
    row.command.run()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(rows[index])
    }
  }

  const firstCommand = rows.findIndex((r) => r.kind === 'command')

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="command-palette" role="dialog" aria-label={t('commandPlaceholder')}>
        <div className="command-input">
          <Search size={18} strokeWidth={2.2} />
          <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} placeholder={t('commandPlaceholder')} />
        </div>
        <div className="command-list scroll" ref={listRef}>
          {rows.length === 0 && <div className="conv-empty">{t('noResults')}</div>}
          {rows.map((row, i) => (
            <div key={row.kind === 'chat' ? row.conversation.id : row.command.id} style={{ display: 'contents' }}>
              {i === firstCommand && <div className="command-section">{t('commandActions')}</div>}
              {row.kind === 'chat' ? (
                <button className={`command-item ${i === index ? 'active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => run(row)}>
                  <Avatar name={row.conversation.title} url={row.conversation.avatarUrl} size={28} platform={showBadge ? row.conversation.platform : undefined} />
                  <span className="command-item-text">
                    <span className="command-item-title">{row.conversation.title}</span>
                    <span className="command-item-sub">
                      {PLATFORMS[row.conversation.platform].name}
                      {row.conversation.lastMessage?.text ? ` · ${maskCode(row.conversation.lastMessage.text)}` : ''}
                    </span>
                  </span>
                </button>
              ) : (
                <button className={`command-item action ${i === index ? 'active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => run(row)}>
                  <span className="command-item-icon">{row.command.icon}</span>
                  <span className="command-item-title">{row.command.label}</span>
                  {row.command.shortcut && <kbd className="command-item-key">{row.command.shortcut}</kbd>}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="command-hint">{t('commandHint')}</div>
      </div>
    </div>
  )
}

/** What the palette can do: first about the open chat (when there is one), then app-wide. */
function useCommands(): Command[] {
  const t = useT()
  const state = useStore.getState()
  const selectedId = useStore((s) => s.selectedId)
  const conversation = useStore((s) => (s.selectedId ? s.conversations[s.selectedId] : undefined))
  const settings = useStore((s) => s.settings)
  const listView = useStore((s) => s.listView)
  const wide = useStore((s) => s.wide && !s.narrow)
  const archived = useStore((s) => (s.selectedId ? isArchivedNow(s, s.selectedId) : false))

  return useMemo(() => {
    const list: Command[] = []
    const add = (id: string, label: TKey, keywords: string, icon: JSX.Element, run: () => void, shortcut?: string): void => {
      list.push({ id, label: t(label), keywords, icon, run, shortcut })
    }

    if (selectedId && conversation) {
      const id = selectedId
      const unread = isUnread(conversation, settings.markedUnread)
      const pinned = isPinned(conversation, settings.pins)
      const muted = settings.muted.conversations.includes(id)
      // Opens the details on that tab (never closes them, unlike the header button).
      const details = (tab: 'info' | 'search') => (): void => (useStore.getState().detailsOpen ? state.setDetailsTab(tab) : state.toggleDetails(tab))
      add('chat-info', 'commandChatInfo', 'info details profile thong tin', <Info {...ICON} />, details('info'))
      add('chat-search', 'commandSearchChat', 'search find tim kiem', <Search {...ICON} />, details('search'))
      if (archived) add('chat-unarchive', 'unarchive', 'inbox restore archive', <ArchiveRestore {...ICON} />, () => void state.unarchive(id), shortcutLabel('E'))
      else add('chat-archive', 'archive', 'archive luu tru', <Archive {...ICON} />, () => void state.archive(id), shortcutLabel('E'))
      add('chat-snooze', 'snoozeAction', 'snooze later remind hoan nhac sau', <AlarmClock {...ICON} />, () => state.openLaterPicker({ conversationId: id, mode: 'snooze' }), shortcutLabel('H', true))
      add('chat-follow', 'followAction', 'follow up remind reply nhac tra loi', <BellRing {...ICON} />, () => state.openLaterPicker({ conversationId: id, mode: 'follow' }))
      if (unread) add('chat-read', 'markRead', 'read da doc', <MailOpen {...ICON} />, () => void state.markRead(id), shortcutLabel('U', true))
      else add('chat-unread', 'markUnread', 'unread chua doc', <Mail {...ICON} />, () => void state.markUnread(id), shortcutLabel('U', true))
      add(pinned ? 'chat-unpin' : 'chat-pin', pinned ? 'unpin' : 'pin', 'pin ghim', pinned ? <PinOff {...ICON} /> : <Pin {...ICON} />, () => void state.togglePin(id))
      add(muted ? 'chat-unmute' : 'chat-mute', muted ? 'unmute' : 'mute', 'mute notifications thong bao', muted ? <Bell {...ICON} /> : <BellOff {...ICON} />, () => void state.toggleMute('conversations', id))
    }

    add('new-chat', 'newChat', 'new message compose tin nhan moi', <SquarePen {...ICON} />, () => state.openSheet({ kind: 'new-chat' }), shortcutLabel('N'))
    add('archive-view', listView === 'archive' ? 'commandShowInbox' : 'commandShowArchive', 'archive archived inbox luu tru hop thu', listView === 'archive' ? <Inbox {...ICON} /> : <Archive {...ICON} />, () => state.setListView(listView === 'archive' ? 'inbox' : 'archive'), shortcutLabel(';'))
    const dark = document.documentElement.dataset.theme === 'dark'
    add('theme', dark ? 'commandLightMode' : 'commandDarkMode', 'theme dark light mode giao dien toi sang', dark ? <Sun {...ICON} /> : <Moon {...ICON} />, () => void state.setSettings({ theme: dark ? 'light' : 'dark' }))
    const liquid = settings.style === 'liquid'
    add('style', liquid ? 'commandMoshiLook' : 'commandLiquidGlass', 'liquid glass style moshi kinh', <Sparkles {...ICON} />, () => void state.setSettings({ style: liquid ? 'moshi' : 'liquid' }))
    if (wide) add('split', 'splitView', 'split two panes chia doi', <Columns2 {...ICON} />, () => state.toggleSplit(), shortcutLabel('\\'))
    add('sidebar', settings.sidebarCollapsed ? 'expandSidebar' : 'collapseSidebar', 'sidebar thanh ben', settings.sidebarCollapsed ? <PanelLeftOpen {...ICON} /> : <PanelLeftClose {...ICON} />, () => void state.toggleSidebar())
    add('todos', 'todos', 'todo tasks reminders viec can lam', <ListTodo {...ICON} />, () => state.openSheet({ kind: 'todos' }))
    if (settings.closeFriends !== false) add('insights', 'insights', 'close friends insights than thiet', <Users {...ICON} />, () => state.openSheet({ kind: 'insights' }))
    if (state.lock?.enabled) add('lock', 'lockNow', 'lock passcode khoa ma bao mat', <Lock {...ICON} />, () => void window.unison.lock.lockNow(), isMac ? '⌃⌘L' : undefined)
    add('add-account', 'addAccount', 'account connect login them tai khoan', <Plus {...ICON} />, () => state.openSheet({ kind: 'add-account' }))
    add('appearance', 'appearance', 'appearance theme colour color accent giao dien mau', <Palette {...ICON} />, () => state.openSheet({ kind: 'settings', page: 'appearance' }))
    add('backup', 'backupCreate', 'backup export sao luu', <DatabaseBackup {...ICON} />, () => state.openSheet({ kind: 'backup', mode: 'create' }))
    add('settings', 'settings', 'settings preferences cai dat', <Settings {...ICON} />, () => state.openSheet({ kind: 'settings' }), shortcutLabel(','))
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state holds stable actions only
  }, [t, selectedId, conversation, settings, listView, wide, archived])
}
