import { Suspense, lazy, memo, useCallback, useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { isArchivedNow, useStore, useUnreadCounts } from './store'
import { translate } from './i18n'
import { isMac } from './utils'
import { Sidebar } from './components/Sidebar'
import { ConversationList } from './components/ConversationList'
import { ChatView } from './components/ChatView'
import { DetailsPane } from './components/DetailsPane'
import { EmptyState } from './components/EmptyState'
import { AuthPromptSheet } from './components/AuthPromptSheet'
import { CommandPalette } from './components/CommandPalette'
import { ForwardSheet } from './components/ForwardSheet'
import { Lightbox } from './components/Lightbox'
import { TitleBar } from './components/TitleBar'
import { ACCENT_VAR_NAMES, DARK_BASE_VAR_NAMES, accentVars, darkBaseVars } from '@shared/accent'
import { darkBaseHex, palsPaperHex, stepZoom } from '@shared/types'
import { TodoSheet } from './components/TodoSheet'
import { InsightsSheet } from './components/Insights'
import { LaterPicker } from './components/LaterPicker'
import { LockScreen } from './components/LockScreen'
import { Splash, readSplashPrefs, writeSplashPrefs } from './components/Splash'
import { firstNameOf } from './greetings'
import { AiSetupSheet } from './components/AiParts'
import { PaneBoundary } from './components/PaneBoundary'
import { cleanError } from './store'
import { useAi } from './aiStore'
import { useUpdate } from './updateStore'

/*
 * Sheets opened now and then load when first opened, so they are not part of what has to load at launch.
 */
const SettingsSheet = lazy(() => import('./components/SettingsSheet').then((m) => ({ default: m.SettingsSheet })))
const AddAccountSheet = lazy(() => import('./components/AddAccountSheet').then((m) => ({ default: m.AddAccountSheet })))
const NewChatSheet = lazy(() => import('./components/NewChatSheet').then((m) => ({ default: m.NewChatSheet })))
const BackupSheet = lazy(() => import('./components/BackupSheet').then((m) => ({ default: m.BackupSheet })))
const LegalSheet = lazy(() => import('./components/LegalSheet').then((m) => ({ default: m.LegalSheet })))
const MergeSheet = lazy(() => import('./components/MergeSheet').then((m) => ({ default: m.MergeSheet })))

/*
 * The panes subscribe to what they show themselves. Memoised (they take no props), they skip the App re-renders that
 * opening a sheet or the lock causes, and App itself no longer subscribes to the conversations at all: before, every
 * incoming message re-rendered the whole tree from here.
 */
const TitleBarPane = memo(TitleBar)
const SidebarPane = memo(Sidebar)
const ConversationListPane = memo(ConversationList)
const ChatPane = memo(ChatView)
const DetailsPanePane = memo(DetailsPane)

/** Unread count on the Dock / taskbar icon (0 until the first load, so a stale badge never lingers). */
function BadgeSync(): null {
  const ready = useStore((s) => s.ready)
  const total = useUnreadCounts().total
  useEffect(() => {
    window.unison.app.setBadge(ready ? total : 0)
  }, [ready, total])
  return null
}

/** Remember what the launch screen needs next time (settings load after it appears). */
function SplashPrefsSync(): null {
  const ready = useStore((s) => s.ready)
  const logo = useStore((s) => s.settings.logo)
  const language = useStore((s) => s.settings.language)
  const accounts = useStore((s) => s.accounts)
  useEffect(() => {
    if (ready) writeSplashPrefs({ logo: logo ?? 'buddies', language, name: firstNameOf(Object.values(accounts)) })
  }, [ready, logo, language, accounts])
  return null
}

function Toast(): JSX.Element | null {
  const toast = useStore((s) => s.toast)
  if (!toast) return null
  return (
    <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      {toast.kind === 'error' && <AlertCircle size={16} />}
      {toast.text}
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.run()
            useStore.setState({ toast: undefined })
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

/** Step the whole interface zoom (saved in Settings) and say where it landed. */
function zoomBy(direction: 1 | -1 | 0): void {
  const { settings, setSettings, showToast } = useStore.getState()
  const zoom = direction === 0 ? 1 : stepZoom(settings.zoom, direction)
  if (zoom === (settings.zoom ?? 1)) return
  void setSettings({ zoom })
  showToast(`${translate(settings.language, 'zoom')} ${Math.round(zoom * 100)}%`)
}

/**
 * Inbox keys, all with ⌘/Ctrl so they never fire while typing (single letters would, mid-word in Telex/VNI):
 * ⌘E archive the open chat, ⌘⇧U unread/read, ⌘; inbox/archive.
 */
type InboxCommand = 'archive' | 'toggle-unread' | 'show-archive' | 'snooze'

function inboxKey(e: KeyboardEvent): InboxCommand | undefined {
  const key = e.key.toLowerCase()
  if (key === 'e' && !e.shiftKey) return 'archive'
  if (key === 'h' && e.shiftKey) return 'snooze'
  if (key === 'u' && e.shiftKey) return 'toggle-unread'
  if (e.key === ';' && !e.shiftKey) return 'show-archive'
  return undefined
}

/** From the keyboard or the macOS menu; never behind a sheet, the photo viewer or the forward picker. */
function runInboxCommand(command: InboxCommand): void {
  const state = useStore.getState()
  if (state.sheet.kind !== 'none' || state.lightbox || state.forwarding) return
  if (command === 'show-archive') return state.setListView(state.listView === 'archive' ? 'inbox' : 'archive')
  const id = state.selectedId
  if (!id) return
  if (command === 'snooze') {
    // Under the open chat's own snooze button when it is on screen, else in the middle of the window.
    const anchor = document.querySelector<HTMLElement>('.chat-pane.active [data-later-anchor]')?.getBoundingClientRect()
    if (state.laterPicker) return state.closeLaterPicker()
    return state.openLaterPicker(
      anchor ? { conversationId: id, mode: 'snooze', x: anchor.right, y: anchor.bottom + 6, align: 'end', keyboard: true } : { conversationId: id, mode: 'snooze', keyboard: true }
    )
  }
  if (command === 'toggle-unread') void state.toggleUnread(id)
  else if (isArchivedNow(state, id)) void state.unarchive(id)
  else void state.archive(id)
}

export default function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const theme = useStore((s) => s.settings.theme)
  const language = useStore((s) => s.settings.language)
  const sheet = useStore((s) => s.sheet)
  const openSheet = useStore((s) => s.openSheet)
  const closeSheet = useStore((s) => s.closeSheet)
  const authPrompts = useStore((s) => s.authPrompts)
  const hasAccounts = useStore((s) => Object.keys(s.accounts).length > 0)
  const detailsOpen = useStore((s) => s.detailsOpen)
  const toggleDetails = useStore((s) => s.toggleDetails)
  const selectedId = useStore((s) => s.selectedId)
  const forwarding = useStore((s) => s.forwarding)
  const lightbox = useStore((s) => s.lightbox)
  const collapsed = useStore((s) => s.settings.sidebarCollapsed)
  const locked = useStore((s) => !!s.lock?.locked)
  const closeFriends = useStore((s) => s.settings.closeFriends !== false)
  const mesh = useStore((s) => s.settings.mesh)
  const darkBase = useStore((s) => s.settings.darkBase)
  const palsPaper = useStore((s) => s.settings.palsPaper)
  const style = useStore((s) => s.settings.style)
  const accent = useStore((s) => s.settings.accent)
  const customAccents = useStore((s) => s.settings.customAccents)
  const font = useStore((s) => s.settings.font)
  const messageShadows = useStore((s) => s.settings.messageShadows)
  const textSize = useStore((s) => s.settings.textSize ?? 'md')
  const [splash, setSplash] = useState(true)
  const hideSplash = useCallback(() => setSplash(false), [])

  const narrow = useStore((s) => s.narrow)
  const setNarrow = useStore((s) => s.setNarrow)
  const setWide = useStore((s) => s.setWide)
  const split = useStore((s) => s.layout.panes.length > 1 && s.wide && !s.narrow)

  // Apple-style overlay scrollbars: show the thumb only while scrolling or hovering.
  useEffect(() => {
    const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
    const onScroll = (e: Event): void => {
      const el = e.target as Element
      if (!(el instanceof Element) || !el.classList.contains('scroll')) return
      el.classList.add('is-scrolling')
      const existing = timers.get(el)
      if (existing) clearTimeout(existing)
      timers.set(
        el,
        setTimeout(() => el.classList.remove('is-scrolling'), 900)
      )
    }
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [])

  // The buddies blink (every 5.6 s) and glance (every 9 s) on a slow clock: the animation runs only for the
  // moment the eyes move, never while the window is in the background or motion is reduced.
  useEffect(() => {
    const root = document.documentElement
    const still = (): boolean => root.classList.contains('window-idle') || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const pulse = (name: string, ms: number): void => {
      if (still()) return
      root.setAttribute(name, '')
      setTimeout(() => root.removeAttribute(name), ms)
    }
    const blink = setInterval(() => pulse('data-blink', 340), 5600)
    const glance = setInterval(() => pulse('data-glance', 2400), 9000)
    return () => {
      clearInterval(blink)
      clearInterval(glance)
    }
  }, [])

  // A failure nothing waited for (a click whose action failed in the background) used to vanish without a word: it is
  // logged, and said once in a while as a small notice (never a burst of them).
  useEffect(() => {
    let last = 0
    const onRejection = (e: PromiseRejectionEvent): void => {
      const reason = e.reason as Error | undefined
      console.error('unhandled rejection:', reason?.message ?? String(e.reason))
      if (!reason?.message || reason.name === 'AbortError' || Date.now() - last < 5000) return
      last = Date.now()
      useStore.getState().showToast(cleanError(reason), 'error')
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  // Decorative animations rest while the window is in the background (see .window-idle in app.css).
  useEffect(() => {
    const apply = (): void => {
      document.documentElement.classList.toggle('window-idle', document.hidden || !document.hasFocus())
    }
    apply()
    window.addEventListener('focus', apply)
    window.addEventListener('blur', apply)
    document.addEventListener('visibilitychange', apply)
    return () => {
      window.removeEventListener('focus', apply)
      window.removeEventListener('blur', apply)
      document.removeEventListener('visibilitychange', apply)
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)')
    const apply = (): void => setNarrow(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [setNarrow])

  // Two chat panes need room: below this the split is remembered but only the active pane shows.
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1100px)')
    const apply = (): void => setWide(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [setWide])

  useEffect(() => {
    document.documentElement.dataset.mesh = mesh
    document.documentElement.dataset.style = style ?? 'moshi'
    // Custom accents set their variables inline on :root; presets use the [data-accent] rules.
    const root = document.documentElement
    const custom = accent.startsWith('custom-') ? customAccents?.find((a) => a.id === accent) : undefined
    for (const name of ACCENT_VAR_NAMES) root.style.removeProperty(name)
    if (custom) {
      root.dataset.accent = 'custom'
      for (const [name, value] of Object.entries(accentVars(custom))) root.style.setProperty(name, value)
    } else {
      root.dataset.accent = accent.startsWith('custom-') ? 'ocean' : accent
    }
    // Dark-mode base tone: the dark theme reads these through var(--dark-*, navy default).
    for (const name of DARK_BASE_VAR_NAMES) root.style.removeProperty(name)
    if (darkBase && darkBase !== 'navy') for (const [name, value] of Object.entries(darkBaseVars(darkBaseHex(darkBase)))) root.style.setProperty(name, value)
    // Pals' paper in light mode (lilac, the default, sets nothing)
    if (palsPaper && palsPaper !== 'lilac') root.style.setProperty('--pals-pick', palsPaperHex(palsPaper))
    else root.style.removeProperty('--pals-pick')
    document.documentElement.dataset.font = font
    document.documentElement.dataset.messageShadows = messageShadows === false ? 'off' : 'on'
    document.documentElement.dataset.textSize = textSize
  }, [mesh, style, darkBase, palsPaper, accent, customAccents, font, messageShadows, textSize])

  // The native menu bar (macOS) sends its shortcuts here.
  useEffect(() => {
    return window.unison.onEvent((event) => {
      if (event.type !== 'app:command') return
      const { openSheet, sheet, lock } = useStore.getState()
      if (lock?.locked) return
      switch (event.command) {
        case 'settings':
          openSheet({ kind: 'settings' })
          break
        case 'new-chat':
          openSheet({ kind: 'new-chat' })
          break
        case 'command-palette':
          openSheet(sheet.kind === 'command' ? { kind: 'none' } : { kind: 'command' })
          break
        case 'zoom-in':
          zoomBy(1)
          break
        case 'zoom-out':
          zoomBy(-1)
          break
        case 'zoom-reset':
          zoomBy(0)
          break
        case 'toggle-split':
          useStore.getState().toggleSplit()
          break
        case 'archive':
        case 'toggle-unread':
        case 'show-archive':
        case 'snooze':
          runInboxCommand(event.command)
          break
        case 'close': {
          // ⌘W: the photo viewer, then an open sheet, then the window itself (hidden on macOS).
          const state = useStore.getState()
          if (state.lightbox) state.openLightbox(undefined)
          else if (sheet.kind !== 'none') state.closeSheet()
          else window.unison.app.windowAction('close')
          break
        }
      }
    })
  }, [])

  // Ctrl +/-/0 and Ctrl + mouse wheel zoom the whole interface (saved in Settings).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey) return
      if (e.key === '=' || e.key === '+') zoomBy(1)
      else if (e.key === '-' || e.key === '_') zoomBy(-1)
      else if (e.key === '0') zoomBy(0)
      else return
      e.preventDefault()
    }
    let last = 0
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      if (Date.now() - last < 180) return
      last = Date.now()
      zoomBy(e.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  useEffect(() => {
    void init().then(() => Promise.all([useAi.getState().init(), useUpdate.getState().init()]))
    // Catch up on unread messages in the open panes when the window regains focus.
    const onFocus = (): void => {
      const { layout, conversations } = useStore.getState()
      for (const id of layout.panes) if (id && conversations[id]?.unreadCount) void window.unison.conversations.markRead(id)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [init])

  // Resolve the effective theme and keep it in sync with the OS. Until settings arrive, reuse the
  // theme from the last run so the launch screen does not flash the wrong one.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const cached = ready ? undefined : readSplashPrefs().theme
      const effective = cached ?? (theme === 'system' ? (media.matches ? 'dark' : 'light') : theme)
      document.documentElement.dataset.theme = effective
      if (ready) writeSplashPrefs({ theme: effective })
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, ready])

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.classList.toggle('platform-mac', isMac)
    document.documentElement.classList.toggle('platform-win', !isMac)
  }, [language])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Nothing behind the lock screen answers the keyboard.
      if (useStore.getState().lock?.locked) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openSheet({ kind: 'new-chat' })
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSheet(sheet.kind === 'command' ? { kind: 'none' } : { kind: 'command' })
      } else if (mod && e.key === ',') {
        e.preventDefault()
        openSheet({ kind: 'settings' })
      } else if (mod && e.key === '\\') {
        e.preventDefault()
        useStore.getState().toggleSplit()
      } else if (mod && !e.altKey && !e.isComposing && sheet.kind === 'none' && inboxKey(e)) {
        e.preventDefault()
        runInboxCommand(inboxKey(e)!)
      } else if (mod && (e.key === '1' || e.key === '2') && useStore.getState().layout.panes.length > 1) {
        e.preventDefault()
        useStore.getState().activatePane(e.key === '1' ? 0 : 1, true)
      } else if (e.key === 'Escape' && (sheet.kind !== 'none' || useStore.getState().forwarding || useStore.getState().lightbox)) {
        closeSheet()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet.kind, openSheet, closeSheet])

  // Locked: everything behind the lock screen is out of reach (no focus, no clicks, not read aloud), and any open
  // sheet closes so it is not waiting there afterwards.
  useEffect(() => {
    // The app inside the shell, and whatever is drawn straight into <body> (menus, pickers, toasts, the photo viewer).
    const behind = [...document.querySelectorAll('.shell > :not(.lock-screen):not(.splash)'), ...document.querySelectorAll('body > :not(#root)')]
    for (const el of behind) el.toggleAttribute('inert', locked)
    if (locked) useStore.getState().closeSheet()
    if (!locked) return
    // A menu or toast that opens while locked is out of reach too.
    const watcher = new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.addedNodes) if (node instanceof HTMLElement && node.id !== 'root') node.inert = true
    })
    watcher.observe(document.body, { childList: true })
    return () => watcher.disconnect()
  }, [locked, ready])

  // One tree for both phases so the launch screen stays mounted while the app appears beneath it.
  return (
    <div className="shell">
      <BadgeSync />
      <SplashPrefsSync />
      {splash && <Splash ready={ready} onDone={hideSplash} />}
      {ready && locked && <LockScreen />}
      {ready && (
        <>
          <TitleBarPane />
          <div className={`app ${collapsed ? 'sidebar-collapsed' : ''} ${split ? 'split' : ''} ${detailsOpen && selectedId ? 'details-open' : ''} ${narrow ? (selectedId ? 'narrow show-chat' : 'narrow show-list') : ''}`}>
            <div className="mesh" aria-hidden>
              <span className="mesh-blob b1" />
              <span className="mesh-blob b2" />
              <span className="mesh-blob b3" />
              <span className="mesh-blob b4" />
              <span className="mesh-blob b5" />
            </div>
            <PaneBoundary name="sidebar">
              <SidebarPane />
            </PaneBoundary>
            <PaneBoundary name="list">
              <ConversationListPane />
            </PaneBoundary>
            {hasAccounts ? (
              <PaneBoundary name="chat">
                <ChatPane />
              </PaneBoundary>
            ) : (
              <EmptyState kind="welcome" />
            )}
            {detailsOpen && selectedId ? (
              <PaneBoundary name="details">
                <DetailsPanePane />
              </PaneBoundary>
            ) : (
              <div />
            )}
            {/* Mid-width windows float the details over the chat; the scrim closes them (see the responsive rules). */}
            {detailsOpen && selectedId && <div className="details-scrim" aria-hidden onClick={() => toggleDetails()} />}

            <Suspense fallback={null}>
              {sheet.kind === 'settings' && <SettingsSheet initialPage={sheet.page} />}
              {sheet.kind === 'add-account' && <AddAccountSheet initialPlatform={sheet.platform} />}
              {sheet.kind === 'new-chat' && <NewChatSheet />}
              {sheet.kind === 'backup' && <BackupSheet key={sheet.mode} mode={sheet.mode} />}
              {sheet.kind === 'legal' && <LegalSheet doc={sheet.doc} />}
              </Suspense>
            {sheet.kind === 'command' && <CommandPalette />}
            {sheet.kind === 'todos' && <TodoSheet />}
            {sheet.kind === 'insights' && closeFriends && <InsightsSheet />}
            {sheet.kind === 'merge' && <MergeSheet conversationId={sheet.conversationId} />}
            <AiSetupSheet />
            <LaterPicker />
            {forwarding && <ForwardSheet message={forwarding} />}
            {lightbox && <Lightbox {...lightbox} />}
            {authPrompts[0] && <AuthPromptSheet prompt={authPrompts[0]} />}

            <Toast />
          </div>
        </>
      )}
    </div>
  )
}
