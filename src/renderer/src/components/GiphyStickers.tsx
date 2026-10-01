import { useCallback, useEffect, useState } from 'react'
import { Clock, ExternalLink, Inbox, Search, TrendingUp, X } from 'lucide-react'
import type { GifItem } from '@shared/types'
import { useStore, useT } from '../store'
import { imageSrc } from '@shared/media'
import { loadGiphyStickers, rememberGiphySticker, type SavedGiphySticker } from '../giphyStickers'
import { BuddyLoader } from './BuddyLoader'
import { LogoMark } from './Logo'
import { MOODS } from './GifPicker'

type Status = 'loading' | 'ready' | 'nokey' | 'rate' | 'error'
type View = 'search' | 'recent' | 'received'

/** A GIPHY key is at hand: the GIF key when it is GIPHY's, one set for stickers, or one built into the release. */
function useGiphyKey(): boolean {
  const own = useStore((s) => (s.settings.gif?.provider === 'giphy' && !!s.settings.gif.key?.trim()) || !!s.settings.giphyKey?.trim())
  const [builtIn, setBuiltIn] = useState(false)
  useEffect(() => {
    let live = true
    void window.unison.app.gifDefault().then((p) => live && setBuiltIn(p === 'giphy'))
    return () => {
      live = false
    }
  }, [])
  return own || builtIn
}

/**
 * The GIPHY sticker tab: the same library as Instagram's sticker tray, so a pick reaches Instagram as a real sticker
 * (and other apps as a moving, see-through GIF). Also lists the GIPHY stickers friends sent, to send back.
 */
export function GiphyStickers({ onPick }: { onPick(id: string): void }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const hasKey = useGiphyKey()
  const [recent, setRecent] = useState<SavedGiphySticker[]>(() => loadGiphyStickers('recent'))
  const [received] = useState<SavedGiphySticker[]>(() => loadGiphyStickers('received'))
  const [view, setView] = useState<View>('search')
  const [query, setQuery] = useState('')
  const [mood, setMood] = useState<string | undefined>()
  const [items, setItems] = useState<GifItem[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [status, setStatus] = useState<Status>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [request] = useState(() => ({ n: 0 }))
  const effective = query.trim() || mood || ''

  const load = useCallback(
    async (q: string, nextPage: number) => {
      const id = ++request.n
      if (nextPage === 1) setStatus('loading')
      else setLoadingMore(true)
      try {
        const result = await window.unison.app.stickerSearch(q, nextPage)
        if (id !== request.n) return
        setItems((prev) => {
          if (nextPage === 1) return result.items
          const seen = new Set(prev.map((g) => g.id))
          return [...prev, ...result.items.filter((g) => !seen.has(g.id))]
        })
        setPage(nextPage)
        setHasNext(result.hasNext && result.items.length > 0)
        setStatus('ready')
      } catch (err) {
        if (id !== request.n) return
        const message = (err as Error).message ?? ''
        setStatus(message.includes('GIF_KEY') ? 'nokey' : message.includes('GIF_RATE') ? 'rate' : 'error')
      } finally {
        if (id === request.n) setLoadingMore(false)
      }
    },
    [request]
  )

  useEffect(() => {
    if (!hasKey) {
      setStatus('nokey')
      return
    }
    const timer = setTimeout(() => void load(effective, 1), effective ? 320 : 0)
    return () => clearTimeout(timer)
  }, [effective, hasKey, load])

  const pick = (sticker: SavedGiphySticker): void => {
    setRecent(rememberGiphySticker('recent', sticker))
    onPick(`giphy:${sticker.id}`)
  }

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (view !== 'search' || !hasNext || loadingMore || status !== 'ready') return
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) void load(effective, page + 1)
  }

  const saved = view === 'recent' ? recent : view === 'received' ? received : undefined
  const cells: SavedGiphySticker[] =
    saved ??
    items.map((item) => ({
      id: item.id.slice('giphy:'.length),
      url: item.preview.url,
      title: item.title
    }))
  // Without a key the saved lists still work (sending needs no key); only search asks for one.
  const needsKey = view === 'search' && status === 'nokey'

  return (
    <>
      <div className="gif-top giphy-top">
        <div className="search-field gif-search">
          <Search size={14} strokeWidth={2.4} />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setView('search')
            }}
            placeholder={t('giphySearch')}
            spellCheck={false}
            disabled={!hasKey}
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
              aria-selected={view === 'recent'}
              className={`gif-mood icon ${view === 'recent' ? 'active' : ''}`}
              onClick={() => setView(view === 'recent' ? 'search' : 'recent')}
              title={t('recent')}
            >
              <Clock size={14} strokeWidth={2.4} />
            </button>
          )}
          {received.length > 0 && (
            <button
              role="tab"
              aria-selected={view === 'received'}
              className={`gif-mood ${view === 'received' ? 'active' : ''}`}
              onClick={() => setView(view === 'received' ? 'search' : 'received')}
              title={t('giphyReceivedHint')}
            >
              <Inbox size={13} strokeWidth={2.4} /> {t('giphyReceived')}
            </button>
          )}
          {hasKey && (
            <button
              role="tab"
              aria-selected={view === 'search' && !effective}
              className={`gif-mood icon ${view === 'search' && !effective ? 'active' : ''}`}
              onClick={() => {
                setView('search')
                setQuery('')
                setMood(undefined)
              }}
              title={t('gifTrending')}
            >
              <TrendingUp size={14} strokeWidth={2.4} />
            </button>
          )}
          {hasKey &&
            MOODS.map((m) => {
              const active = view === 'search' && !query.trim() && mood === m.q
              return (
                <button
                  key={m.q}
                  role="tab"
                  aria-selected={active}
                  className={`gif-mood ${active ? 'active' : ''}`}
                  onClick={() => {
                    setView('search')
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
      {needsKey ? (
        <div className="gif-setup scroll">
          <LogoMark size={44} title="" className="gif-setup-buddy" />
          <strong>{t('giphySetupTitle')}</strong>
          <span className="gif-setup-text">{t('giphySetupHint')}</span>
          <GiphyKeyForm onSaved={() => void load(effective, 1)} />
        </div>
      ) : (
        <div className="sticker-grid giphy-grid scroll" onScroll={onScroll}>
          {!saved && status === 'loading' && <BuddyLoader size={36} label={t('loading')} className="gif-loader giphy-wide" />}
          {!saved && (status === 'rate' || status === 'error') && (
            <div className="gif-empty giphy-wide">
              <span>{t(status === 'rate' ? 'gifRateLimited' : 'gifError')}</span>
              <button className="btn" onClick={() => void load(effective, 1)}>
                {t('retry')}
              </button>
            </div>
          )}
          {(saved || status === 'ready') && cells.length === 0 && <div className="sticker-empty giphy-wide">{t('noResults')}</div>}
          {(saved || status === 'ready') &&
            cells.map((s) => (
              <button key={s.id} className="sticker-cell giphy-cell" onClick={() => pick(s)} title={s.title} aria-label={s.title || t('sticker')}>
                <img src={imageSrc(s.url)} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          {loadingMore && <BuddyLoader size={22} inline className="gif-more giphy-wide" />}
        </div>
      )}
      <div className="gif-footer">{t('gifPoweredBy', { provider: 'GIPHY' })}</div>
    </>
  )
}

/** Paste a GIPHY key just for stickers (kept apart from a KLIPY GIF key). */
function GiphyKeyForm({ onSaved }: { onSaved(): void }): JSX.Element {
  const t = useT()
  const setSettings = useStore((s) => s.setSettings)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const save = async (): Promise<void> => {
    if (!key.trim()) return
    setBusy(true)
    setError(undefined)
    await setSettings({ giphyKey: key.trim() })
    try {
      await window.unison.app.stickerSearch('', 1)
      setKey('')
      onSaved()
    } catch (err) {
      setError((err as Error).message.includes('GIF_KEY') ? t('gifKeyInvalid') : t('gifError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gif-key-form compact">
      <div className="gif-key-row">
        <input
          className="field-input mono"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder={t('gifKeyPlaceholder', { provider: 'GIPHY' })}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
        />
        <button className="btn primary" onClick={() => void save()} disabled={busy || !key.trim()}>
          {busy ? <BuddyLoader size={18} inline /> : t('save')}
        </button>
      </div>
      {error && <span className="gif-key-error">{error}</span>}
      <button className="gif-key-link" onClick={() => void window.unison.app.openExternal('https://developers.giphy.com/dashboard/')}>
        {t('gifGetKeyGiphy')}
        <ExternalLink size={12} strokeWidth={2.4} />
      </button>
    </div>
  )
}
