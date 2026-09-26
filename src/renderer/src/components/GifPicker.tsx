import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, ExternalLink, Search, TrendingUp, X } from 'lucide-react'
import type { GifItem, GifProvider } from '@shared/types'
import { useStore, useT } from '../store'
import { BuddyLoader } from './BuddyLoader'
import { LogoMark } from './Logo'

const RECENT_KEY = 'unison.recentGifs'
const KEY_PAGES: Record<GifProvider, string> = { klipy: 'https://partner.klipy.com', giphy: 'https://developers.giphy.com/dashboard/' }
const PROVIDER_NAMES: Record<GifProvider, string> = { klipy: 'KLIPY', giphy: 'GIPHY' }
/** Mood shortcuts: labels in the app language, searches in English (the libraries are tagged in English). */
const MOODS: Array<{ q: string; vi: string; en: string }> = [
  { q: 'lol', vi: 'Haha', en: 'LOL' },
  { q: 'love', vi: 'Yêu', en: 'Love' },
  { q: 'hug', vi: 'Ôm', en: 'Hug' },
  { q: 'wow', vi: 'Wow', en: 'Wow' },
  { q: 'sad', vi: 'Buồn', en: 'Sad' },
  { q: 'thank you', vi: 'Cảm ơn', en: 'Thanks' },
  { q: 'ok', vi: 'OK', en: 'OK' },
  { q: 'hello', vi: 'Chào', en: 'Hi' },
  { q: 'celebrate', vi: 'Ăn mừng', en: 'Party' },
  { q: 'good night', vi: 'Ngủ ngon', en: 'Night' },
  { q: 'angry', vi: 'Tức', en: 'Angry' },
  { q: 'cat', vi: 'Mèo', en: 'Cats' }
]
const TINTS = ['#ffe3ec', '#e3edff', '#efe4ff', '#dcf6ea', '#fff1d9', '#e0f4ff']

function loadRecent(): GifItem[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as GifItem[]
    return Array.isArray(list) ? list.filter((g) => g?.id && g.preview?.url && g.gif?.url) : []
  } catch {
    return []
  }
}

function saveRecent(list: GifItem[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 24)))
  } catch {
    /* private mode */
  }
}

/** Two masonry columns: each GIF goes to the shorter column, so the order still reads left to right. */
function columnsOf(list: GifItem[]): Array<Array<{ item: GifItem; i: number }>> {
  const columns: Array<Array<{ item: GifItem; i: number }>> = [[], []]
  const heights = [0, 0]
  list.forEach((item, i) => {
    const c = heights[0] <= heights[1] ? 0 : 1
    columns[c].push({ item, i })
    heights[c] += (item.preview.height || 1) / (item.preview.width || 1)
  })
  return columns
}

type Status = 'loading' | 'ready' | 'nokey' | 'rate' | 'error'

/** Composer popover: search KLIPY/GIPHY, mood shortcuts, recent GIFs; picking one sends it. */
export function GifPicker({ onPick, onClose }: { onPick(item: GifItem): void; onClose(): void }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const provider = useStore((s) => s.settings.gif?.provider ?? 'klipy')
  const hasKey = useStore((s) => !!s.settings.gif?.key?.trim())
  const [recent, setRecent] = useState<GifItem[]>(loadRecent)
  const [query, setQuery] = useState('')
  const [mood, setMood] = useState<string | undefined>()
  const [showRecent, setShowRecent] = useState(false)
  const [items, setItems] = useState<GifItem[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [status, setStatus] = useState<Status>(hasKey ? 'loading' : 'nokey')
  const [loadingMore, setLoadingMore] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const effective = query.trim() || mood || ''

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const load = useCallback(async (q: string, nextPage: number) => {
    const id = ++request.current
    if (nextPage === 1) setStatus('loading')
    else setLoadingMore(true)
    try {
      const result = await window.unison.app.gifSearch(q, nextPage)
      if (id !== request.current) return
      setItems((prev) => {
        if (nextPage === 1) return result.items
        const seen = new Set(prev.map((g) => g.id))
        return [...prev, ...result.items.filter((g) => !seen.has(g.id))]
      })
      setPage(nextPage)
      setHasNext(result.hasNext && result.items.length > 0)
      setStatus('ready')
    } catch (err) {
      if (id !== request.current) return
      const message = (err as Error).message ?? ''
      setStatus(message.includes('GIF_KEY') ? 'nokey' : message.includes('GIF_RATE') ? 'rate' : 'error')
    } finally {
      if (id === request.current) setLoadingMore(false)
    }
  }, [])

  // Search as you type (debounced); trending when empty.
  useEffect(() => {
    if (!hasKey) {
      setStatus('nokey')
      return
    }
    const timer = setTimeout(() => void load(effective, 1), effective ? 320 : 0)
    return () => clearTimeout(timer)
  }, [effective, hasKey, provider, load])

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (showRecent || !hasNext || loadingMore || status !== 'ready') return
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 240) void load(effective, page + 1)
  }

  const pick = (item: GifItem): void => {
    const next = [item, ...recent.filter((g) => g.id !== item.id)]
    setRecent(next)
    saveRecent(next)
    onPick(item)
  }

  const list = showRecent ? recent : items

  return (
    <div className="emoji-sheet gif-sheet" ref={ref} role="dialog" aria-label="GIF">
      {status === 'nokey' ? (
        <div className="gif-setup scroll">
          <LogoMark size={52} title="" className="gif-setup-buddy" />
          <strong>{t('gifSetupTitle')}</strong>
          <span className="gif-setup-text">{t('gifSetupHint')}</span>
          <GifKeyForm compact onSaved={() => void load(effective, 1)} invalid={hasKey} />
        </div>
      ) : (
        <>
          <div className="gif-top">
            <div className="search-field gif-search">
              <Search size={14} strokeWidth={2.4} />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setShowRecent(false)
                }}
                placeholder={t('gifSearch', { provider: PROVIDER_NAMES[provider] })}
                spellCheck={false}
              />
              {query && (
                <button className="search-clear" onClick={() => setQuery('')} aria-label={t('close')}>
                  <X size={11} strokeWidth={3} />
                </button>
              )}
            </div>
            <div className="gif-moods scroll" role="tablist">
              {recent.length > 0 && (
                <button
                  role="tab"
                  aria-selected={showRecent}
                  className={`gif-mood icon ${showRecent ? 'active' : ''}`}
                  onClick={() => setShowRecent((v) => !v)}
                  title={t('recent')}
                >
                  <Clock size={14} strokeWidth={2.4} />
                </button>
              )}
              <button
                role="tab"
                aria-selected={!showRecent && !effective}
                className={`gif-mood icon ${!showRecent && !effective ? 'active' : ''}`}
                onClick={() => {
                  setShowRecent(false)
                  setQuery('')
                  setMood(undefined)
                }}
                title={t('gifTrending')}
              >
                <TrendingUp size={14} strokeWidth={2.4} />
              </button>
              {MOODS.map((m) => {
                const active = !showRecent && !query.trim() && mood === m.q
                return (
                  <button
                    key={m.q}
                    role="tab"
                    aria-selected={active}
                    className={`gif-mood ${active ? 'active' : ''}`}
                    onClick={() => {
                      setShowRecent(false)
                      setQuery('')
                      setMood(active ? undefined : m.q)
                    }}
                  >
                    {m[language]}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="gif-grid-wrap scroll" onScroll={onScroll}>
            {!showRecent && status === 'loading' && <BuddyLoader size={40} label={t('loading')} className="gif-loader" />}
            {!showRecent && (status === 'rate' || status === 'error') && (
              <div className="gif-empty">
                <LogoMark size={44} mood="calm" title="" />
                <span>{t(status === 'rate' ? 'gifRateLimited' : 'gifError')}</span>
                <button className="btn" onClick={() => void load(effective, 1)}>
                  {t('retry')}
                </button>
              </div>
            )}
            {(showRecent || status === 'ready') && list.length === 0 && (
              <div className="gif-empty">
                <LogoMark size={44} mood="calm" title="" />
                <span>{t('noResults')}</span>
              </div>
            )}
            {(showRecent || status === 'ready') && (
              <div className="gif-grid">
                {columnsOf(list).map((column, c) => (
                  <div key={c} className="gif-column">
                    {column.map(({ item, i }) => (
                      <button
                        key={item.id}
                        className="gif-cell"
                        style={{ aspectRatio: `${item.preview.width || 1} / ${item.preview.height || 1}`, background: TINTS[i % TINTS.length] }}
                        onClick={() => pick(item)}
                        title={item.title}
                        aria-label={item.title || 'GIF'}
                      >
                        <img src={item.preview.url} alt="" loading="lazy" draggable={false} />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {loadingMore && <BuddyLoader size={22} inline className="gif-more" />}
          </div>
          <div className="gif-footer">{t('gifPoweredBy', { provider: PROVIDER_NAMES[provider] })}</div>
        </>
      )}
    </div>
  )
}

/** Choose the GIF library and paste your own free key (used in the picker and in Settings). */
export function GifKeyForm({ compact = false, invalid = false, onSaved }: { compact?: boolean; invalid?: boolean; onSaved?(): void }): JSX.Element {
  const t = useT()
  const current = useStore((s) => s.settings.gif)
  const setSettings = useStore((s) => s.setSettings)
  const [provider, setProvider] = useState<GifProvider>(current?.provider ?? 'klipy')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(invalid ? t('gifKeyInvalid') : undefined)

  const save = async (): Promise<void> => {
    if (!key.trim()) return
    setBusy(true)
    setError(undefined)
    await setSettings({ gif: { provider, key: key.trim() } })
    try {
      await window.unison.app.gifSearch('', 1)
      setKey('')
      onSaved?.()
    } catch (err) {
      setError((err as Error).message.includes('GIF_KEY') ? t('gifKeyInvalid') : t('gifError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`gif-key-form ${compact ? 'compact' : ''}`}>
      <div className="segmented">
        {(['klipy', 'giphy'] as GifProvider[]).map((p) => (
          <button key={p} className={provider === p ? 'active' : ''} onClick={() => setProvider(p)}>
            {PROVIDER_NAMES[p]}
          </button>
        ))}
      </div>
      <div className="gif-key-row">
        <input
          className="field-input mono"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder={current?.key && current.provider === provider ? t('gifKeySaved') : t('gifKeyPlaceholder', { provider: PROVIDER_NAMES[provider] })}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
        />
        <button className="btn primary" onClick={() => void save()} disabled={busy || !key.trim()}>
          {busy ? <BuddyLoader size={18} inline /> : t('save')}
        </button>
      </div>
      {error && <span className="gif-key-error">{error}</span>}
      <button className="gif-key-link" onClick={() => void window.unison.app.openExternal(KEY_PAGES[provider])}>
        {t(provider === 'klipy' ? 'gifGetKeyKlipy' : 'gifGetKeyGiphy')}
        <ExternalLink size={12} strokeWidth={2.4} />
      </button>
    </div>
  )
}
