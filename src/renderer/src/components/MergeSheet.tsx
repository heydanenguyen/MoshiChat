import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Link2, Search, X } from 'lucide-react'
import type { Conversation } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { foldName } from '@shared/inbox'
import { candidatesFor, peerOf } from '@shared/people'
import { peopleIndex, useStore, useT } from '../store'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'

/**
 * "Merge with…": pick this person's chats on other apps. Suggestions come first (same phone number, then a
 * similar name, both only hints to confirm); a search reaches every other one-to-one chat. Nothing merges on
 * its own.
 */
export function MergeSheet({ conversationId }: { conversationId: string }): JSX.Element {
  const t = useT()
  const conversations = useStore((s) => s.conversations)
  const people = useStore((s) => s.settings.people)
  const dismissed = useStore((s) => s.settings.mergeDismissed)
  const accounts = useStore((s) => s.accounts)
  const closeSheet = useStore((s) => s.closeSheet)
  const mergeChats = useStore((s) => s.mergeChats)
  const target = conversations[conversationId]
  const index = peopleIndex(people)
  const personId = index.get(conversationId)
  const already = personId ? (people?.[personId]?.members ?? []) : [conversationId]
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState(personId ? (people?.[personId]?.name ?? '') : (target?.title ?? ''))
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => ref.current?.focus({ preventScroll: true }), [])

  const all = useMemo(() => Object.values(conversations), [conversations])
  // Suggestions for the chat itself; chats already in this person (or on one of its accounts) are left out.
  const taken = new Set(already.map((id) => conversations[id]?.accountId))
  const suggestions = useMemo(
    () => (target ? candidatesFor(target, all, index, dismissed).filter((c) => !taken.has(c.conversation.accountId)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `taken` follows `already`, which follows these
    [target, all, index, dismissed, people]
  )
  const others = useMemo(() => {
    const q = foldName(query)
    // Suggestions have their own section, except while searching: then everything is searched alike.
    const suggested = new Set(q ? [] : suggestions.map((c) => c.conversation.id))
    return all
      .filter((c) => !c.isGroup && peerOf(c) && !taken.has(c.accountId) && !index.has(c.id) && !suggested.has(c.id))
      .filter((c) => !q || foldName(c.title).includes(q) || foldName(c.originalTitle ?? '').includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
  }, [all, query, suggestions, index, people])

  if (!target) return <></>

  const toggle = (id: string): void => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  const merge = async (): Promise<void> => {
    if (!picked.length || busy) return
    setBusy(true)
    await mergeChats([conversationId, ...picked], name)
    closeSheet()
  }

  const row = (c: Conversation, reason?: 'phone' | 'name'): JSX.Element => {
    const on = picked.includes(c.id)
    const account = accounts[c.accountId]
    return (
      <button key={c.id} type="button" role="checkbox" aria-checked={on} className={`command-item merge-item ${on ? 'picked' : ''}`} onClick={() => toggle(c.id)}>
        <Avatar name={c.title} url={c.avatarUrl} size={34} platform={c.platform} />
        <span className="command-item-text">
          <span className="command-item-title">{c.title}</span>
          <span className="command-item-sub">
            {PLATFORMS[c.platform].name}
            {account?.handle ? ` · ${account.handle}` : ''}
            {reason && <span className={`merge-reason ${reason}`}>{reason === 'phone' ? t('mergeReasonPhone') : t('mergeReasonName')}</span>}
          </span>
        </span>
        <span className="merge-check" aria-hidden>
          {on && <Check size={13} strokeWidth={3} />}
        </span>
      </button>
    )
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="command-palette merge-sheet" role="dialog" aria-modal="true" aria-label={t('mergeTitle')}>
        <div className="forward-preview">
          <Link2 size={14} strokeWidth={2.4} />
          <span className="forward-preview-text">
            <strong>{t('mergeTitle')}</strong>
            <span>{t('mergeSubtitle')}</span>
          </span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={closeSheet} title={t('close')}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>
        <div className="merge-target">
          {already.map((id) => conversations[id]).filter(Boolean).map((c) => (
            <span key={c.id} className="merge-target-chip">
              <PlatformIcon platform={c.platform} size={13} />
              {c.title}
            </span>
          ))}
        </div>
        <div className="command-input">
          <Search size={18} strokeWidth={2.2} />
          <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('mergeSearch')} spellCheck={false} />
        </div>
        <div className="command-list scroll">
          {suggestions.length > 0 && !query && (
            <>
              <div className="conv-group-label">{t('mergeSuggested')}</div>
              {suggestions.map((c) => row(c.conversation, c.reason))}
            </>
          )}
          {others.length > 0 && (
            <>
              <div className="conv-group-label">{t('mergeAll')}</div>
              {others.map((c) => row(c))}
            </>
          )}
          {!others.length && !suggestions.length && <div className="conv-empty">{t('mergeNone')}</div>}
        </div>
        <div className="merge-footer">
          <label className="merge-name">
            <span>{t('mergeName')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={target.title} spellCheck={false} />
          </label>
          <button className="btn primary" disabled={!picked.length || busy} onClick={() => void merge()}>
            {t('mergeButton', { count: picked.length + already.length })}
          </button>
        </div>
      </div>
    </div>
  )
}
