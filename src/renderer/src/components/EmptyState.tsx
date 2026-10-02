import { useStore, useT } from '../store'
import { LogoHero, LogoMark } from './Logo'
import { PalStage } from './Pals'

export function EmptyState({ kind }: { kind: 'no-selection' | 'welcome' }): JSX.Element {
  const t = useT()
  const openSheet = useStore((s) => s.openSheet)
  const addDemo = useStore((s) => s.addDemo)
  const pals = useStore((s) => s.settings.style === 'pals')
  const hello = useStore((s) => (s.settings.language === 'vi' ? 'Chào~' : 'Hello~'))

  if (kind === 'welcome') {
    return (
      <section className="chat-col">
        <div className="drag" style={{ height: 'var(--titlebar-height)', flexShrink: 0 }} />
        <div className="welcome">
          {pals ? <PalStage greeting={hello} /> : <LogoHero size={170} className="welcome-hero" />}
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
        {pals ? <PalStage greeting={hello} /> : <LogoMark size={92} mood="calm" className="empty-buddy" title="" />}
        <div className="empty-title">{t('selectConversation')}</div>
        <div className="empty-body">{t('selectConversationHint')}</div>
      </div>
    </section>
  )
}
