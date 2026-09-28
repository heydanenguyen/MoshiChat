import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { LOGOS, LOGO_ORDER, type LogoId } from '@shared/logos'
import { STICKER_EXPRESSIONS, STICKER_VIEWBOX, isStickerId, stickerInner, type StickerId } from '@shared/stickers'
import { useStore, useT } from '../store'
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
export function StickerPicker({ onPick, onClose }: { onPick(id: StickerId): void; onClose(): void }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const logo = useStore((s) => s.settings.logo)
  const [recent, setRecent] = useState<StickerId[]>(loadRecent)
  const [tab, setTab] = useState<'recent' | LogoId>(() => (loadRecent().length ? 'recent' : (logo ?? 'buddies')))
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

  const items: StickerId[] = tab === 'recent' ? recent : STICKER_EXPRESSIONS.map((e) => `${tab}-${e.id}` as StickerId)
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
        {LOGO_ORDER.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} title={LOGOS[id].name[language]}>
            <LogoMark logo={id} size={24} title="" />
          </button>
        ))}
      </div>
      <div className="sticker-title">{tab === 'recent' ? t('recent') : LOGOS[tab].name[language]}</div>
      <div className="sticker-grid scroll">
        {items.map((id) => (
          <button key={id} className="sticker-cell" onClick={() => pick(id)} title={nameOf(id)} aria-label={nameOf(id)}>
            <StickerArt id={id} size={68} />
          </button>
        ))}
      </div>
    </div>
  )
}
