import { useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { useStore } from './store'
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
import { NewChatSheet } from './components/NewChatSheet'
import { SavedSheet } from './components/SavedSheet'

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

  const narrow = useStore((s) => s.narrow)
  const setNarrow = useStore((s) => s.setNarrow)

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
  }, [mesh, accent, customAccents, font, messageShadows])

  useEffect(() => {
    void init()
    // Catch up on unread messages in the open thread when the window regains focus.
    const onFocus = (): void => {
      const { selectedId, conversations } = useStore.getState()
      if (selectedId && conversations[selectedId]?.unreadCount) void window.unison.conversations.markRead(selectedId)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [init])

  // Resolve the effective theme and keep it in sync with the OS.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const effective = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = effective
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

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
      } else if (e.key === 'Escape' && (sheet.kind !== 'none' || useStore.getState().forwarding || useStore.getState().lightbox)) {
        closeSheet()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet.kind, openSheet, closeSheet])

  if (!ready) return <div className="shell" />

  return (
    <div className="shell">
      <TitleBar />
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''} ${narrow ? (selectedId ? 'narrow show-chat' : 'narrow show-list') : ''}`}>
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
      {sheet.kind === 'saved' && <SavedSheet />}
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
    </div>
  )
}
