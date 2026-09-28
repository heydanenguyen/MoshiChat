import { useCallback, useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { useStore, useUnreadCounts } from './store'
import { translate } from './i18n'
import { isMac } from './utils'
import { Sidebar } from './components/Sidebar'
import { ConversationList } from './components/ConversationList'
import { ChatView } from './components/ChatView'
import { DetailsPane } from './components/DetailsPane'
import { EmptyState } from './components/EmptyState'
import { SettingsSheet } from './components/SettingsSheet'
import { AddAccountSheet } from './components/AddAccountSheet'
import { AuthPromptSheet } from './components/AuthPromptSheet'
import { CommandPalette } from './components/CommandPalette'
import { ForwardSheet } from './components/ForwardSheet'
import { Lightbox } from './components/Lightbox'
import { TitleBar } from './components/TitleBar'
import { ACCENT_VAR_NAMES, accentVars } from '@shared/accent'
import { stepZoom } from '@shared/types'
import { NewChatSheet } from './components/NewChatSheet'
import { BackupSheet } from './components/BackupSheet'
import { LegalSheet } from './components/LegalSheet'
import { Splash, readSplashPrefs, writeSplashPrefs } from './components/Splash'
import { firstNameOf } from './greetings'
import { AiSetupSheet } from './components/AiParts'
import { useAi } from './aiStore'
import { useUpdate } from './updateStore'

/** Step the whole interface zoom (saved in Settings) and say where it landed. */
function zoomBy(direction: 1 | -1 | 0): void {
  const { settings, setSettings, showToast } = useStore.getState()
  const zoom = direction === 0 ? 1 : stepZoom(settings.zoom, direction)
  if (zoom === (settings.zoom ?? 1)) return
  void setSettings({ zoom })
  showToast(`${translate(settings.language, 'zoom')} ${Math.round(zoom * 100)}%`)
}

export default function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  const unreadTotal = useUnreadCounts().total
  const init = useStore((s) => s.init)
  const theme = useStore((s) => s.settings.theme)
  const language = useStore((s) => s.settings.language)
  const sheet = useStore((s) => s.sheet)
  const openSheet = useStore((s) => s.openSheet)
  const closeSheet = useStore((s) => s.closeSheet)
  const authPrompts = useStore((s) => s.authPrompts)
  const hasAccounts = useStore((s) => Object.keys(s.accounts).length > 0)
  const detailsOpen = useStore((s) => s.detailsOpen)
  const selectedId = useStore((s) => s.selectedId)
  const toast = useStore((s) => s.toast)
  const forwarding = useStore((s) => s.forwarding)
  const lightbox = useStore((s) => s.lightbox)
  const collapsed = useStore((s) => s.settings.sidebarCollapsed)
  const mesh = useStore((s) => s.settings.mesh)
  const accent = useStore((s) => s.settings.accent)
  const customAccents = useStore((s) => s.settings.customAccents)
  const font = useStore((s) => s.settings.font)
  const messageShadows = useStore((s) => s.settings.messageShadows)
  const textSize = useStore((s) => s.settings.textSize ?? 'md')
  const logo = useStore((s) => s.settings.logo)
  const accounts = useStore((s) => s.accounts)
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
    document.documentElement.dataset.font = font
    document.documentElement.dataset.messageShadows = messageShadows === false ? 'off' : 'on'
    document.documentElement.dataset.textSize = textSize
  }, [mesh, accent, customAccents, font, messageShadows, textSize])

  // Unread count on the Dock / taskbar icon (0 until the first load, so a stale badge never lingers).
  useEffect(() => {
    window.unison.app.setBadge(ready ? unreadTotal : 0)
  }, [ready, unreadTotal])

  // The native menu bar (macOS) sends its shortcuts here.
  useEffect(() => {
    return window.unison.onEvent((event) => {
      if (event.type !== 'app:command') return
      const { openSheet, sheet } = useStore.getState()
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

  // Remember what the launch screen needs next time (settings load after it appears).
  useEffect(() => {
    if (ready) writeSplashPrefs({ logo: logo ?? 'buddies', language, name: firstNameOf(Object.values(accounts)) })
  }, [ready, logo, language, accounts])

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.classList.toggle('platform-mac', isMac)
    document.documentElement.classList.toggle('platform-win', !isMac)
  }, [language])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
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

  // One tree for both phases so the launch screen stays mounted while the app appears beneath it.
  return (
    <div className="shell">
      {splash && <Splash ready={ready} onDone={hideSplash} />}
      {ready && (
        <>
          <TitleBar />
          <div className={`app ${collapsed ? 'sidebar-collapsed' : ''} ${split ? 'split' : ''} ${narrow ? (selectedId ? 'narrow show-chat' : 'narrow show-list') : ''}`}>
            <div className="mesh" aria-hidden>
              <span className="mesh-blob b1" />
              <span className="mesh-blob b2" />
              <span className="mesh-blob b3" />
              <span className="mesh-blob b4" />
              <span className="mesh-blob b5" />
            </div>
            <Sidebar />
            <ConversationList />
            {hasAccounts ? <ChatView /> : <EmptyState kind="welcome" />}
            {detailsOpen && selectedId ? <DetailsPane /> : <div />}

            {sheet.kind === 'settings' && <SettingsSheet />}
            {sheet.kind === 'add-account' && <AddAccountSheet initialPlatform={sheet.platform} />}
            {sheet.kind === 'command' && <CommandPalette />}
            {sheet.kind === 'new-chat' && <NewChatSheet />}
            {sheet.kind === 'backup' && <BackupSheet key={sheet.mode} mode={sheet.mode} />}
            {sheet.kind === 'legal' && <LegalSheet doc={sheet.doc} />}
            <AiSetupSheet />
            {forwarding && <ForwardSheet message={forwarding} />}
            {lightbox && <Lightbox {...lightbox} />}
            {authPrompts[0] && <AuthPromptSheet prompt={authPrompts[0]} />}

            {toast && (
              <div className={`toast ${toast.kind}`}>
                {toast.kind === 'error' && <AlertCircle size={16} />}
                {toast.text}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
