import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, SquarePen, X } from 'lucide-react'
import type { Contact, Platform } from '@shared/types'
import { PLATFORMS, PLATFORM_ORDER } from '@shared/types'
import { useStore, useT } from '../store'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'

/** Start a conversation with anyone from any connected account. */
export function NewChatSheet(): JSX.Element {
  const t = useT()
  const accounts = useStore((s) => s.accounts)
  const conversations = useStore((s) => s.conversations)
  const closeSheet = useStore((s) => s.closeSheet)
  const openContact = useStore((s) => s.openContact)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [contacts, setContacts] = useState<Contact[] | undefined>()
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => ref.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void window.unison.contacts.list(query).then((list) => {
        if (!cancelled) setContacts(list)
      })
    }, query ? 150 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const platformsAvailable = PLATFORM_ORDER.filter((p) => Object.values(accounts).some((a) => a.platform === p && a.status === 'connected'))

  const results = useMemo(() => {
    const list = (contacts ?? []).filter((c) => platform === 'all' || c.platform === platform)
    // Recent first: contacts that already have a conversation float up, then alphabetical.
    const recent = new Set<string>()
    for (const c of Object.values(conversations)) {
      if (c.isGroup) continue
      const other = c.participants.find((p) => !p.isMe)
      if (other) recent.add(`${c.accountId}/${other.id}`)
    }
    return list
      .map((c) => ({ contact: c, recent: recent.has(`${c.accountId}/${c.id}`) }))
      .sort((a, b) => Number(b.recent) - Number(a.recent) || a.contact.name.localeCompare(b.contact.name))
  }, [contacts, platform, conversations])

  useEffect(() => setIndex(0), [query, platform])

  const start = async (contact: Contact): Promise<void> => {
    if (busy) return
    setBusy(true)
    await openContact(contact)
    setBusy(false)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[index]) {
      void start(results[index].contact)
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<Platform, typeof results>()
    for (const item of results) {
      const list = map.get(item.contact.platform) ?? []
      list.push(item)
      map.set(item.contact.platform, list)
    }
    return PLATFORM_ORDER.filter((p) => map.has(p)).map((p) => ({ platform: p, items: map.get(p)! }))
  }, [results])

  let flatIndex = -1

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="command-palette new-chat" role="dialog" aria-label={t('newChat')}>
        <div className="forward-preview">
          <SquarePen size={14} strokeWidth={2.4} />
          <span className="forward-preview-text">
            <strong>{t('newChat')}</strong>
            <span>{t('newChatHint')}</span>
          </span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={closeSheet} title={t('close')}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>
        <div className="command-input">
          <Search size={18} strokeWidth={2.2} />
          <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} placeholder={t('searchContacts')} spellCheck={false} />
        </div>
        {platformsAvailable.length > 1 && (
          <div className="platform-filter">
            <button className={`filter-chip ${platform === 'all' ? 'active' : ''}`} onClick={() => setPlatform('all')}>
              {t('allInboxes')}
            </button>
            {platformsAvailable.map((p) => (
              <button key={p} className={`filter-chip ${platform === p ? 'active' : ''}`} onClick={() => setPlatform(p)}>
                <PlatformIcon platform={p} size={18} />
                {PLATFORMS[p].name}
              </button>
            ))}
          </div>
        )}
        <div className="command-list scroll">
          {contacts === undefined && (
            <div className="progress-row" style={{ justifyContent: 'center', padding: 16 }}>
              <span className="spinner" />
            </div>
          )}
          {contacts && results.length === 0 && <div className="conv-empty">{t('noContacts')}</div>}
          {grouped.map((group) => (
            <div key={group.platform}>
              <div className="conv-group-label">{PLATFORMS[group.platform].name}</div>
              {group.items.map(({ contact, recent }) => {
                flatIndex += 1
                const i = flatIndex
                return (
                  <button
                    key={`${contact.accountId}/${contact.id}`}
                    className={`command-item ${i === index ? 'active' : ''}`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => void start(contact)}
                  >
                    <Avatar name={contact.name} url={contact.avatarUrl} size={32} />
                    <span className="command-item-text">
                      <span className="command-item-title">{contact.name}</span>
                      <span className="command-item-sub">
                        {contact.handle ?? PLATFORMS[contact.platform].name}
                        {accounts[contact.accountId] && Object.values(accounts).filter((a) => a.platform === contact.platform).length > 1
                          ? ` · ${accounts[contact.accountId].displayName}`
                          : ''}
                        {recent ? ` · ${t('recent')}` : ''}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="command-hint">{t('commandHint')}</div>
      </div>
    </div>
  )
}
