import { X } from 'lucide-react'
import { PLATFORMS } from '@shared/types'
import { useStore, useT } from '../store'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'

export function DetailsPane(): JSX.Element | null {
  const t = useT()
  const conversation = useStore((s) => (s.selectedId ? s.conversations[s.selectedId] : undefined))
  const account = useStore((s) => (conversation ? s.accounts[conversation.accountId] : undefined))
  const toggleDetails = useStore((s) => s.toggleDetails)
  if (!conversation) return null

  const peer = conversation.participants.find((p) => !p.isMe)
  const others = conversation.participants.filter((p) => !p.isMe)

  return (
    <aside className="details-col">
      <div className="details-top drag">
        <button className="icon-btn no-drag" onClick={toggleDetails} title={t('close')}>
          <X size={16} strokeWidth={2.4} />
        </button>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        <div className="details-hero">
          <Avatar name={conversation.title} url={conversation.avatarUrl} size={88} />
          <div className="details-name">{conversation.title}</div>
          {(peer?.handle || conversation.isGroup) && (
            <div className="details-handle">
              {conversation.isGroup ? t('members', { count: conversation.participants.length }) : peer?.handle}
            </div>
          )}
          <span className="details-chip">
            <PlatformIcon platform={conversation.platform} size={18} />
            {PLATFORMS[conversation.platform].name}
          </span>
        </div>

        {conversation.isGroup && others.length > 0 && (
          <div className="details-section">
            <div className="details-section-title">{t('participants')}</div>
            {others.map((p) => (
              <div key={p.id} className="details-row">
                <Avatar name={p.name} url={p.avatarUrl} size={30} />
                <div className="details-row-text">
                  <div className="details-row-name">{p.name}</div>
                  {p.handle && <div className="details-row-sub">{p.handle}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="details-section">
          <div className="details-section-title">{t('connectedVia')}</div>
          {account && (
            <div className="details-row">
              <Avatar name={account.displayName} url={account.avatarUrl} size={30} platform={account.platform} />
              <div className="details-row-text">
                <div className="details-row-name">{account.displayName}</div>
                <div className="details-row-sub">{account.handle ?? PLATFORMS[account.platform].name}</div>
              </div>
            </div>
          )}
          <div className="details-kv">
            <span>{t('pinned')}</span>
            <span>{conversation.pinned ? '✓' : '—'}</span>
          </div>
          <div className="details-kv">
            <span>{t('notifications')}</span>
            <span>{conversation.muted ? t('muted') : '✓'}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
