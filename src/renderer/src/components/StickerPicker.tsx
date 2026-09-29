import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, ImagePlus, Trash2, UserRound } from 'lucide-react'
import { LOGOS, LOGO_ORDER, type LogoId } from '@shared/logos'
import { STICKER_EXPRESSIONS, STICKER_VIEWBOX, isStickerId, stickerInner, type StickerId } from '@shared/stickers'
import { stickerMotionCss } from '@shared/sticker-motion'
import { MITO_STICKERS, isMitoId, mitoSticker, mitoUrl, type MitoId } from '@shared/mito'
import { useStore, useT } from '../store'
import { useAi } from '../aiStore'
import { AI_MODELS } from '@shared/ai'

const AI_MODELS_CUTOUT_MB = AI_MODELS.cutout.megabytes
import { useKeepInside } from '../popover'
import { LogoMark } from './Logo'

const RECENT_KEY = 'unison.recentStickers'
const MITO_NAME = 'Mito'

type PackSticker = StickerId | MitoId

function loadRecent(): PackSticker[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).filter((id): id is PackSticker => isStickerId(id) || isMitoId(id))
  } catch {
    return []
  }
}

function saveRecent(list: PackSticker[]): void {
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

/**
 * A Mito sticker (a picture, not drawn in code). The animated ones move like StickerArt: while hovered ('hover',
 * finishing the loop when the pointer leaves) and twice when first seen in a chat ('auto'). Each play loads the
 * animation afresh so it starts at its first frame, which is the still pose, and it hands back to the still on a loop
 * boundary, so nothing snaps. Until the animation has loaded the still stays in place.
 */
export function MitoArt({ id, size = 72, play = 'none' }: { id: MitoId; size?: number; play?: 'none' | 'hover' | 'auto' }): JSX.Element {
  const loop = mitoSticker(id).loop
  const ref = useRef<HTMLSpanElement>(null)
  const effects = useStore((s) => s.settings.effects !== false)
  // n: which play this is (a fresh copy of the animation each time); shown once it has loaded; 0 = the still.
  const [run, setRun] = useState({ n: 0, shown: false })
  const plays = useRef(0)
  const started = useRef(0)
  // Loops still to play once loaded or left: undefined while hovered (keep going).
  const pending = useRef<number | undefined>(0)
  const timer = useRef<number>()

  const stopAt = useCallback(
    (loops: number): void => {
      if (!loop) return
      window.clearTimeout(timer.current)
      const elapsed = started.current ? performance.now() - started.current : 0
      const end = started.current ? Math.max(Math.ceil(elapsed / loop), loops) * loop : loops * loop
      timer.current = window.setTimeout(() => {
        started.current = 0
        setRun({ n: 0, shown: false })
      }, end - elapsed)
    },
    [loop]
  )

  useEffect(() => {
    const target = ref.current?.parentElement
    if (!target || play === 'none' || !loop || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const begin = (loops: number | undefined): void => {
      window.clearTimeout(timer.current)
      pending.current = loops
      if (!started.current) setRun((r) => (r.n ? r : { n: ++plays.current, shown: false }))
      else if (loops !== undefined) stopAt(loops)
    }
    const enter = (): void => begin(undefined)
    const leave = (): void => {
      pending.current = 1
      if (started.current) stopAt(1)
    }
    target.addEventListener('mouseenter', enter)
    target.addEventListener('mouseleave', leave)
    let observer: IntersectionObserver | undefined
    if (play === 'auto' && effects) {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return
          observer?.disconnect()
          begin(2)
        },
        { threshold: 0.6 }
      )
      observer.observe(target)
    }
    return () => {
      target.removeEventListener('mouseenter', enter)
      target.removeEventListener('mouseleave', leave)
      observer?.disconnect()
      window.clearTimeout(timer.current)
    }
  }, [play, effects, loop, stopAt])

  const loaded = (): void => {
    started.current = performance.now()
    setRun((r) => ({ ...r, shown: true }))
    if (pending.current !== undefined) stopAt(pending.current)
  }

  return (
    <span ref={ref} className="sticker-art mito-art" style={{ width: size, height: size }} aria-hidden>
      <img src={mitoUrl(id, 'still')} alt="" draggable={false} style={{ visibility: run.shown ? 'hidden' : undefined }} />
      {run.n > 0 && <img key={run.n} src={mitoUrl(id, 'animated', run.n)} alt="" draggable={false} onLoad={loaded} style={{ visibility: run.shown ? undefined : 'hidden' }} />}
    </span>
  )
}

/** Moshi sticker pack: one tab per logo character, twelve expressions each. */
export function StickerPicker({ onPick, onClose }: { onPick(id: string): void; onClose(): void }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const [recent, setRecent] = useState<PackSticker[]>(loadRecent)
  const [tab, setTab] = useState<'recent' | 'mine' | 'mito' | LogoId>(() => (loadRecent().length ? 'recent' : 'mito'))
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

  const items: PackSticker[] =
    tab === 'recent'
      ? recent
      : tab === 'mine'
        ? []
        : tab === 'mito'
          ? MITO_STICKERS.map((m) => `mito:${m.id}` as MitoId)
          : STICKER_EXPRESSIONS.map((e) => `${tab}-${e.id}` as StickerId)
  const add = async (): Promise<void> => {
    setAdding(true)
    try {
      await addSticker(cutout)
    } finally {
      setAdding(false)
    }
  }
  const nameOf = (id: PackSticker): string =>
    isMitoId(id) ? mitoSticker(id).name[language] : (STICKER_EXPRESSIONS.find((e) => id.endsWith(`-${e.id}`))?.name[language] ?? '')

  const pick = (id: PackSticker): void => {
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
        <button role="tab" aria-selected={tab === 'mito'} className={tab === 'mito' ? 'active' : ''} onClick={() => setTab('mito')} title={MITO_NAME}>
          <img className="sticker-tab-pic" src={mitoUrl('mito:chao', 'still')} alt="" draggable={false} />
        </button>
        {LOGO_ORDER.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} title={LOGOS[id].name[language]}>
            <LogoMark logo={id} size={24} title="" />
          </button>
        ))}
      </div>
      <div className="sticker-title">{tab === 'recent' ? t('recent') : tab === 'mine' ? t('stickerMine') : tab === 'mito' ? MITO_NAME : LOGOS[tab].name[language]}</div>
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
            {isMitoId(id) ? <MitoArt id={id} size={68} play="hover" /> : <StickerArt id={id} size={68} play="hover" />}
          </button>
        ))}
      </div>
    </div>
  )
}
