import { useEffect, useMemo, useRef, useState } from 'react'
import { Forward, Search } from 'lucide-react'
import type { Message } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { useStore, useT } from '../store'
import { Avatar } from './Avatar'
import { isComposingEnter } from '../imeGuard'

export function ForwardSheet({ message }: { message: Message }): JSX.Element {
  const t = useT()
  const conversations = useStore((s) => s.conversations)
  const accounts = useStore((s) => s.accounts)
  const forward = useStore((s) => s.forward)
  const startForward = useStore((s) => s.startForward)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => ref.current?.focus(), [])
  useEffect(() => setIndex(0), [query])

  const sourceAccount = message.conversationId.slice(0, message.conversationId.indexOf('/'))
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return Object.values(conversations)
      .filter((c) => c.id !== message.conversationId)
      .filter((c) => accounts[c.accountId]?.status === 'connected')
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.participants.some((p) => p.handle?.toLowerCase().includes(q)))
      // Same-account targets first: those keep media and attribution.
      .sort((a, b) => Number(b.accountId === sourceAccount) - Number(a.accountId === sourceAccount) || b.updatedAt - a.updatedAt)
      .slice(0, 14)
  }, [conversations, accounts, query, message.conversationId, sourceAccount])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (isComposingEnter(e)) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[index]) {
      void forward(results[index].id)
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && startForward(undefined)}>
      <div className="command-palette" role="dialog" aria-label={t('forward')}>
        <div className="forward-preview">
          <Forward size={14} strokeWidth={2.4} />
          <span className="forward-preview-text">
            <strong>{t('forward')}</strong>
            <span>{message.text || message.attachments[0]?.name || t('attachment')}</span>
          </span>
        </div>
        <div className="command-input">
          <Search size={18} strokeWidth={2.2} />
          <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} placeholder={t('forwardTo')} />
        </div>
        <div className="command-list scroll">
          {results.length === 0 && <div className="conv-empty">{t('noResults')}</div>}
          {results.map((c, i) => (
            <button
              key={c.id}
              className={`command-item ${i === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => void forward(c.id)}
            >
              <Avatar name={c.title} url={c.avatarUrl} size={28} platform={c.platform} />
              <span className="command-item-text">
                <span className="command-item-title">{c.title}</span>
                <span className="command-item-sub">
                  {PLATFORMS[c.platform].name}
                  {c.accountId !== sourceAccount ? ` · ${t('forwardTextOnly')}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="command-hint">{t('commandHint')}</div>
      </div>
    </div>
  )
}
