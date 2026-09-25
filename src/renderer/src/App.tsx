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
  const font = useStore((s) => s.settings.font)

  useEffect(() => {
    document.documentElement.dataset.mesh = mesh
    document.documentElement.dataset.accent = accent
    document.documentElement.dataset.font = font
  }, [mesh, accent, font])

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
      if (mod && e.key.toLowerCase() === 'k') {
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
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`}>
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
