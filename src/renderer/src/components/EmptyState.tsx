import { PenSquare } from 'lucide-react'
import { useStore, useT } from '../store'
import { shortcutLabel } from '../utils'
import { LogoHero, LogoMark } from './Logo'
import { PalStage } from './Pals'
import { MonoStage } from './MonoStage'

export function EmptyState({ kind }: { kind: 'no-selection' | 'welcome' }): JSX.Element {
  const t = useT()
  const openSheet = useStore((s) => s.openSheet)
  const addDemo = useStore((s) => s.addDemo)
  const style = useStore((s) => s.settings.style)
  const hello = useStore((s) => (s.settings.language === 'vi' ? 'Chào~' : 'Hello~'))

  if (kind === 'welcome') {
    return (
      <section className="chat-col">
        <div className="drag" style={{ height: 'var(--titlebar-height)', flexShrink: 0 }} />
        <div className="welcome">
          {style === 'pals' ? <PalStage greeting={hello} /> : style === 'mono' ? <MonoStage /> : <LogoHero size={170} className="welcome-hero" />}
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
        {style === 'pals' ? <PalStage greeting={hello} /> : style === 'mono' ? <MonoStage /> : <LogoMark size={92} mood="calm" className="empty-buddy" title="" />}
        <div className="empty-title">{t('selectConversation')}</div>
        <div className="empty-body">{t('selectConversationHint')}</div>
        <button className="btn primary empty-cta" onClick={() => openSheet({ kind: 'new-chat' })}>
          <PenSquare size={16} strokeWidth={2.4} />
          {t('newChat')}
          <kbd>{shortcutLabel('N')}</kbd>
        </button>
      </div>
    </section>
  )
}
