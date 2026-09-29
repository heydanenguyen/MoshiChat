import { useEffect, useRef, useState } from 'react'
import { Clock, ImagePlus, Trash2, UserRound } from 'lucide-react'
import { LOGOS, LOGO_ORDER, type LogoId } from '@shared/logos'
import { STICKER_EXPRESSIONS, STICKER_VIEWBOX, isStickerId, stickerInner, type StickerId } from '@shared/stickers'
import { stickerMotionCss } from '@shared/sticker-motion'
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

/** Keyframes for a sticker are added to the page the first time it is shown moving. */
const motionStyles = new Set<string>()
function ensureMotion(id: StickerId): void {
  if (motionStyles.has(id)) return
  motionStyles.add(id)
  const style = document.createElement('style')
  style.dataset.sticker = id
  style.textContent = stickerMotionCss(id)
  document.head.appendChild(style)
}

/**
 * A sticker drawn inline (crisp at any size), optionally alive:
 * - 'hover': moves while the pointer is over it (or its button), and finishes the loop when it leaves;
 * - 'auto': also plays twice the first time it scrolls into view (a new sticker in a chat).
 * It always stops on a loop boundary, where every part is back on the still pose, so it never snaps.
 */
export function StickerArt({ id, size = 72, play = 'none' }: { id: StickerId; size?: number; play?: 'none' | 'hover' | 'auto' }): JSX.Element {
  const ref = useRef<SVGSVGElement>(null)
  const [playing, setPlaying] = useState(false)
  // Loops left before stopping; undefined while hovered (keep going).
  const loopsLeft = useRef<number | undefined>(0)
  const effects = useStore((s) => s.settings.effects !== false)

  useEffect(() => {
    if (play !== 'none') ensureMotion(id)
  }, [id, play])

  useEffect(() => {
    const svg = ref.current
    const target = svg?.parentElement
    if (!svg || !target || play === 'none') return
    const enter = (): void => {
      loopsLeft.current = undefined
      setPlaying(true)
    }
    const leave = (): void => {
      loopsLeft.current = 1
    }
    const iteration = (e: AnimationEvent): void => {
      if (!e.animationName.endsWith('-body') || loopsLeft.current === undefined) return
      loopsLeft.current -= 1
      if (loopsLeft.current <= 0) setPlaying(false)
    }
    target.addEventListener('mouseenter', enter)
    target.addEventListener('mouseleave', leave)
    svg.addEventListener('animationiteration', iteration)
    let observer: IntersectionObserver | undefined
    if (play === 'auto' && effects) {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return
          observer?.disconnect()
          if (loopsLeft.current === undefined) return
          loopsLeft.current = 2
          setPlaying(true)
        },
        { threshold: 0.6 }
      )
      observer.observe(svg)
    }
    return () => {
      target.removeEventListener('mouseenter', enter)
      target.removeEventListener('mouseleave', leave)
      svg.removeEventListener('animationiteration', iteration)
      observer?.disconnect()
    }
  }, [play, effects])

  return (
    <svg
      ref={ref}
      className={`sticker-art stk-${id}${playing ? ' stk-play' : ''}`}
      width={size}
      height={size}
      viewBox={STICKER_VIEWBOX}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: stickerInner(id) }}
    />
  )
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
            <StickerArt id={id} size={68} play="hover" />
          </button>
        ))}
      </div>
    </div>
  )
}
