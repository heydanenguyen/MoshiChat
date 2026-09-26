import { useMemo } from 'react'
import { Bookmark, BookmarkX, X } from 'lucide-react'
import type { SavedMessage } from '@shared/types'
import { useStore, useT } from '../store'
import { formatListTime } from '../utils'
import { Avatar } from './Avatar'
import { PreviewText } from './MessageParts'

/** Bookmarked messages grouped by conversation; a click jumps to the exact moment in the chat. */
export function SavedSheet(): JSX.Element {
  const t = useT()
  const saved = useStore((s) => s.settings.savedMessages)
  const conversations = useStore((s) => s.conversations)
  const language = useStore((s) => s.settings.language)
  const closeSheet = useStore((s) => s.closeSheet)
  const openSaved = useStore((s) => s.openSaved)
  const setSettings = useStore((s) => s.setSettings)

  const groups = useMemo(() => {
    const map = new Map<string, SavedMessage[]>()
    for (const item of saved ?? []) {
      const list = map.get(item.conversationId) ?? []
      list.push(item)
      map.set(item.conversationId, list)
    }
    return [...map.entries()].map(([conversationId, items]) => ({ conversationId, items: items.sort((a, b) => b.sentAt - a.sentAt) }))
  }, [saved])

  const remove = (item: SavedMessage): void => {
    void setSettings({ savedMessages: (saved ?? []).filter((s) => !(s.messageId === item.messageId && s.conversationId === item.conversationId)) })
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet saved-sheet" role="dialog" aria-label={t('savedMessages')}>
        <div className="sheet-header">
          <div className="sheet-title">
            <Bookmark size={17} strokeWidth={2.3} /> {t('savedMessages')}
          </div>
          <button className="icon-btn" onClick={closeSheet} title={t('close')}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="sheet-body scroll">
          {groups.length === 0 && (
            <div className="saved-empty">
              <span className="saved-empty-icon">
                <Bookmark size={26} strokeWidth={2} />
              </span>
              <strong>{t('savedEmpty')}</strong>
              <span>{t('savedEmptyHint')}</span>
            </div>
          )}
          {groups.map(({ conversationId, items }) => {
            const conversation = conversations[conversationId]
            return (
              <div key={conversationId} className="saved-group">
                <div className="saved-group-head">
                  <Avatar name={conversation?.title ?? items[0].senderName} url={conversation?.avatarUrl} size={26} platform={items[0].platform} />
                  <span>{conversation?.title ?? items[0].senderName}</span>
                </div>
                {items.map((item) => (
                  <div key={item.messageId} className="saved-item">
                    <button className="saved-item-main" onClick={() => void openSaved(item)} disabled={!conversation} title={conversation ? t('savedOpen') : t('savedGone')}>
                      <span className="saved-item-who">
                        {item.isOutgoing ? t('you') : item.senderName}
                        <span className="saved-item-time">{formatListTime(item.sentAt, language)}</span>
                      </span>
                      <span className="saved-item-text">
                        <PreviewText kind={item.kind} text={item.text} />
                      </span>
                    </button>
                    <button className="icon-btn saved-remove" onClick={() => remove(item)} title={t('unsaveAction')}>
                      <BookmarkX size={15} strokeWidth={2.2} />
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
