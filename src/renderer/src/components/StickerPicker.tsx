import { useEffect, useRef, useState } from 'react'
import { Clock, ImagePlus, Trash2, UserRound } from 'lucide-react'
import { LOGOS, LOGO_ORDER, type LogoId } from '@shared/logos'
import { STICKER_EXPRESSIONS, STICKER_VIEWBOX, isStickerId, stickerInner, type StickerId } from '@shared/stickers'
import { useStore, useT } from '../store'
import { useAi } from '../aiStore'
import { AI_MODELS } from '@shared/ai'

const AI_MODELS_CUTOUT_MB = AI_MODELS.cutout.megabytes
import { useKeepInside } from '../popover'
import { LogoMark } from './Logo'

const RECENT_KEY = 'unison.recentStickers'

function loadRecent(): StickerId[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).filter(isStickerId)
  } catch {
    return []
  }
}

function saveRecent(list: StickerId[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)))
  } catch {
    /* private mode */
  }
}

/** A sticker drawn inline (crisp at any size). */
export function StickerArt({ id, size = 72 }: { id: StickerId; size?: number }): JSX.Element {
  return <svg className="sticker-art" width={size} height={size} viewBox={STICKER_VIEWBOX} aria-hidden dangerouslySetInnerHTML={{ __html: stickerInner(id) }} />
}

/** Moshi sticker pack: one tab per logo character, twelve expressions each. */
export function StickerPicker({ onPick, onClose }: { onPick(id: string): void; onClose(): void }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const logo = useStore((s) => s.settings.logo)
  const [recent, setRecent] = useState<StickerId[]>(loadRecent)
  const [tab, setTab] = useState<'recent' | 'mine' | LogoId>(() => (loadRecent().length ? 'recent' : (logo ?? 'buddies')))
  const mine = useStore((s) => s.customStickers)
  const loadStickers = useStore((s) => s.loadStickers)
  const addSticker = useStore((s) => s.addSticker)
  const removeSticker = useStore((s) => s.removeSticker)
  const cutoutReady = useAi((s) => !!s.status?.cutout.ready)
  const [cutout, setCutout] = useState(true)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    void loadStickers()
  }, [loadStickers])
  const ref = useRef<HTMLDivElement>(null)
  useKeepInside(ref)

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

  const items: StickerId[] = tab === 'recent' ? recent : tab === 'mine' ? [] : STICKER_EXPRESSIONS.map((e) => `${tab}-${e.id}` as StickerId)
  const add = async (): Promise<void> => {
    setAdding(true)
    try {
      await addSticker(cutout)
    } finally {
      setAdding(false)
    }
  }
  const nameOf = (id: StickerId): string => STICKER_EXPRESSIONS.find((e) => id.endsWith(`-${e.id}`))?.name[language] ?? ''

  const pick = (id: StickerId): void => {
    const next = [id, ...recent.filter((r) => r !== id)]
    setRecent(next)
    saveRecent(next)
    onPick(id)
  }

  return (
    <div className="emoji-sheet sticker-sheet" ref={ref} role="dialog" aria-label={t('stickers')}>
      <div className="sticker-tabs" role="tablist">
        {recent.length > 0 && (
          <button role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'active' : ''} onClick={() => setTab('recent')} title={t('recent')}>
            <Clock size={16} strokeWidth={2.2} />
          </button>
        )}
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')} title={t('stickerMine')}>
          <UserRound size={16} strokeWidth={2.2} />
        </button>
        {LOGO_ORDER.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} title={LOGOS[id].name[language]}>
            <LogoMark logo={id} size={24} title="" />
          </button>
        ))}
      </div>
      <div className="sticker-title">{tab === 'recent' ? t('recent') : tab === 'mine' ? t('stickerMine') : LOGOS[tab].name[language]}</div>
      {tab === 'mine' && (
        <div className="sticker-mine-bar">
          <button className="btn small" onClick={() => void add()} disabled={adding}>
            <ImagePlus size={14} strokeWidth={2.4} /> {adding ? t('stickerAdding') : t('stickerAdd')}
          </button>
          <label className="sticker-cutout">
            <input type="checkbox" checked={cutout} onChange={(e) => setCutout(e.target.checked)} />
            {t('stickerCutout')}
            {!cutoutReady && <span className="sticker-cutout-note">· {AI_MODELS_CUTOUT_MB} MB</span>}
          </label>
        </div>
      )}
      {tab === 'mine' && mine.length === 0 && <div className="sticker-empty">{t('stickerEmpty')}</div>}
      <div className="sticker-grid scroll">
        {tab === 'mine' &&
          mine.map((s) => (
            <span key={s.id} className="sticker-cell mine">
              <button className="sticker-cell-img" onClick={() => onPick(`custom:${s.id}`)} title={s.name} aria-label={s.name}>
                <img src={s.url} alt={s.name} draggable={false} />
              </button>
              <button className="sticker-remove" onClick={() => void removeSticker(s.id)} title={t('stickerRemove')}>
                <Trash2 size={11} strokeWidth={2.6} />
              </button>
            </span>
          ))}
        {items.map((id) => (
          <button key={id} className="sticker-cell" onClick={() => pick(id)} title={nameOf(id)} aria-label={nameOf(id)}>
            <StickerArt id={id} size={68} />
          </button>
        ))}
      </div>
    </div>
  )
}
