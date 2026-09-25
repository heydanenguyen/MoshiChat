import { MessageCircle } from 'lucide-react'
import { useStore, useT } from '../store'
import { PlatformIcon } from './PlatformIcon'

export function EmptyState({ kind }: { kind: 'no-selection' | 'welcome' }): JSX.Element {
  const t = useT()
  const openSheet = useStore((s) => s.openSheet)
  const addDemo = useStore((s) => s.addDemo)

  if (kind === 'welcome') {
    return (
      <section className="chat-col">
        <div className="drag" style={{ height: 'var(--titlebar-height)', flexShrink: 0 }} />
        <div className="welcome">
          <div className="welcome-logos">
            <PlatformIcon platform="messenger" size={56} style={{ borderRadius: 16 }} />
            <PlatformIcon platform="instagram" size={56} style={{ borderRadius: 16 }} />
            <PlatformIcon platform="telegram" size={56} style={{ borderRadius: 16 }} />
          </div>
          <h2 className="welcome-title">{t('welcomeTitle')}</h2>
          <p className="welcome-body">{t('welcomeBody')}</p>
          <div className="welcome-actions">
            <button className="btn primary lg" onClick={() => openSheet({ kind: 'add-account' })}>
              {t('connectAccount')}
            </button>
            <button className="btn secondary lg" onClick={() => void addDemo()}>
              {t('tryDemo')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="chat-col">
      <div className="drag" style={{ height: 'var(--titlebar-height)', flexShrink: 0 }} />
      <div className="empty-state">
        <div className="empty-icon">
          <MessageCircle size={34} strokeWidth={1.8} />
        </div>
        <div className="empty-title">{t('selectConversation')}</div>
        <div className="empty-body">{t('selectConversationHint')}</div>
      </div>
    </section>
  )
}
