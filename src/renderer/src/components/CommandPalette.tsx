import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { PLATFORMS } from '@shared/types'
import { useStore, useT } from '../store'
import { Avatar } from './Avatar'

export function CommandPalette(): JSX.Element {
  const t = useT()
  const conversations = useStore((s) => s.conversations)
  const select = useStore((s) => s.select)
  const closeSheet = useStore((s) => s.closeSheet)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => ref.current?.focus(), [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return Object.values(conversations)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.participants.some((p) => p.handle?.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12)
  }, [conversations, query])

  useEffect(() => setIndex(0), [query])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[index]) {
      select(results[index].id)
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="command-palette" role="dialog">
        <div className="command-input">
          <Search size={18} strokeWidth={2.2} />
          <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} placeholder={t('commandPlaceholder')} />
        </div>
        <div className="command-list scroll">
          {results.length === 0 && <div className="conv-empty">{t('noResults')}</div>}
          {results.map((c, i) => (
            <button
              key={c.id}
              className={`command-item ${i === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => select(c.id)}
            >
              <Avatar name={c.title} url={c.avatarUrl} size={28} platform={c.platform} />
              <span className="command-item-text">
                <span className="command-item-title">{c.title}</span>
                <span className="command-item-sub">
                  {PLATFORMS[c.platform].name}
                  {c.lastMessage?.text ? ` · ${c.lastMessage.text}` : ''}
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
