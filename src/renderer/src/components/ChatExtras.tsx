import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlarmClock, AlertCircle, Cake, Send, X } from 'lucide-react'
import type { Conversation, Message, ScheduledMessage } from '@shared/types'
import { detectEffect, fillQuickReply, givenName, isBirthdayToday, type EffectKind } from '@shared/extras'
import type { StickerId } from '@shared/stickers'
import { useStore, useT } from '../store'
import { formatListTime, formatTime } from '../utils'
import { SHINE, drawStatic, resolveColor, shineDelay, shineEnd, startShower, type CelebrationKind } from '../motion/celebrate'
import { LogoMark } from './Logo'
import { StickerArt } from './StickerPicker'

const COLORS = ['#FF5B1F', '#FFC21A', '#13B26B', '#FF6FB5', '#1F6BFF', '#9B5DE5']
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Deterministic pseudo-random numbers so a given effect always looks the same while it plays. */
function seeded(seed: number): () => number {
  let s = seed || 1
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/**
 * Plays an effect when a message arrives (or is sent) that calls for one, like iMessage/Messenger word
 * effects. Only new messages count (not history), and effects are spaced out so a burst of wishes
 * plays once.
 */
export function useMessageEffects(messages: Message[] | undefined): [{ kind: EffectKind; key: string } | undefined, (effect?: { kind: EffectKind; key: string }) => void] {
  const enabled = useStore((s) => s.settings.effects !== false)
  const seen = useRef<Set<string> | null>(null)
  const last = useRef(0)
  const [effect, setEffect] = useState<{ kind: EffectKind; key: string } | undefined>()
  useEffect(() => {
    if (!messages) return
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m.id))
      return
    }
    for (const m of messages) {
      if (seen.current.has(m.id)) continue
      seen.current.add(m.id)
      if (!enabled || Date.now() - m.sentAt > 120_000 || Date.now() - last.current < 4_000) continue
      const kind = detectEffect(m.text)
      if (kind) {
        last.current = Date.now()
        setEffect({ kind, key: m.id })
      }
    }
  }, [messages, enabled])
  return [effect, setEffect]
}

/**
 * Confetti, hearts or fireworks over the chat, with the logo character popping up to cheer. Confetti and hearts are drawn on one
 * canvas per chat column (motion/celebrate.ts: real physics, rAF only while pieces live, 2.5 s at most); fireworks stay as
 * small DOM bursts. Reduced motion: one still bundle fades in and out.
 */
export function EffectLayer({ kind, seed, onDone }: { kind: EffectKind; seed: string; onDone(): void }): JSX.Element {
  const t = useT()
  const quiet = reducedMotion()
  const shower: CelebrationKind | undefined = kind === 'love' ? 'hearts' : kind === 'newyear' ? undefined : 'confetti'
  const cheer = kind === 'birthday' ? t('effectBirthday') : kind === 'newyear' ? t('effectNewYear') : kind === 'congrats' ? t('effectCongrats') : undefined
  const canvas = useRef<HTMLCanvasElement>(null)
  const [painting, setPainting] = useState(!!shower)
  // The caller passes a new onDone every render: keep the latest without restarting the shower.
  const done = useRef(onDone)
  done.current = onDone

  // The layer stays for the cheering character (3.6 s); with nothing to cheer it goes when the last piece has.
  useEffect(() => {
    if (!cheer && shower && !quiet) return
    const timer = setTimeout(() => done.current(), quiet ? 1800 : 3600)
    return () => clearTimeout(timer)
  }, [cheer, shower, quiet])

  useEffect(() => {
    const el = canvas.current
    if (!el || !shower) return
    const accent = resolveColor('var(--accent)', el)
    if (quiet) {
      drawStatic(el, shower, { seed, accent })
      el.classList.add('show')
      const fade = setTimeout(() => el.classList.remove('show'), 900)
      return () => clearTimeout(fade)
    }
    const run = startShower(el, shower, {
      seed,
      accent,
      onEnd: () => {
        setPainting(false)
        if (!cheer) done.current()
      }
    })
    return run.stop
  }, [shower, seed, quiet, cheer])

  const pieces = useMemo(() => {
    if (kind !== 'newyear' || quiet) return []
    const rnd = seeded([...seed].reduce((a, c) => a + c.charCodeAt(0), 7))
    return Array.from({ length: 5 }, (_, b) => {
      const x = 12 + rnd() * 76
      const y = 12 + rnd() * 45
      const color = COLORS[b % COLORS.length]
      return (
        <span key={b} className="fx-burst" style={{ left: `${x}%`, top: `${y}%`, '--delay': `${b * 380}ms` } as CSSProperties}>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ '--angle': `${(i / 14) * 360}deg`, '--dist': `${46 + rnd() * 26}px`, background: color } as CSSProperties} />
          ))}
        </span>
      )
    })
  }, [kind, seed, quiet])

  return (
    <div className={`fx-layer fx-${kind}`} aria-hidden>
      {pieces}
      {shower && painting && <canvas ref={canvas} className="fx-canvas" />}
      {cheer && (
        <div className="fx-buddy">
          <div className="fx-buddy-bubble">{cheer}</div>
          <LogoMark size={84} title="" />
        </div>
      )}
    </div>
  )
}

interface ShineBox {
  left: number
  top: number
  width: number
  height: number
  /** The sticker's own picture, to mask the gloss with (undefined: no gloss, sparkles only). */
  mask?: string
}

/** Where the sticker sits in its bubble, and its picture as a URL: an image's own, or an inline drawing serialised once. */
function measureSticker(host: HTMLElement): ShineBox | undefined {
  const art = host.parentElement?.querySelector<HTMLElement>('.attachment-sticker')
  if (!art) return undefined
  const box = { left: art.offsetLeft, top: art.offsetTop, width: art.offsetWidth, height: art.offsetHeight }
  // A sprite sheet is several frames side by side: one mask cannot follow it.
  if (art.classList.contains('sprite')) return box
  const img = art.tagName === 'IMG' ? (art as HTMLImageElement) : art.querySelector('img')
  if (img?.currentSrc) return { ...box, mask: img.currentSrc }
  const svg = art.querySelector('svg')
  if (svg) return { ...box, mask: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}` }
  return undefined
}

/**
 * Over a sticker that has just landed: one gloss sweep, masked by the sticker's own picture so it never leaves the artwork,
 * and three sparkles (timing from motion/celebrate.ts, drawing in app.css). `elapsed` = ms since it landed, so a bubble that
 * was drawn again mid-way carries on instead of starting over. Gone after its last sparkle.
 */
export function StickerShine({ elapsed = 0 }: { elapsed?: number }): JSX.Element | null {
  const [gone, setGone] = useState(false)
  const [box, setBox] = useState<ShineBox | undefined>()
  const host = useRef<HTMLSpanElement>(null)
  const mounted = useRef(performance.now())
  useEffect(() => {
    const timer = setTimeout(() => setGone(true), Math.max(0, shineEnd() - elapsed) + 120)
    return () => clearTimeout(timer)
  }, [elapsed])
  // The picture may arrive a little after the bubble (a sticker fetched from the platform): look again once.
  useEffect(() => {
    const el = host.current
    if (!el) return
    setBox(measureSticker(el))
    const again = setTimeout(() => setBox((b) => (b?.mask ? b : measureSticker(el))), 350)
    return () => clearTimeout(again)
  }, [])
  if (gone) return null
  const passed = elapsed + (performance.now() - mounted.current)
  const at = (i: number): CSSProperties => ({ animationDelay: `${shineDelay(i, passed)}ms` })
  const mask = box?.mask ? `url("${box.mask}")` : undefined
  return (
    <span
      className="sticker-shine"
      ref={host}
      aria-hidden
      style={box ? { left: box.left, top: box.top, width: box.width, height: box.height } : undefined}
    >
      {mask && (
        <span className="shine-mask" style={{ maskImage: mask, WebkitMaskImage: mask }}>
          <i className="shine-gloss" style={at(-1)} />
        </span>
      )}
      {Array.from({ length: SHINE.sparks }, (_, i) => (
        <span key={i} className={`shine-spark s${i}`} style={at(i)}>
          <svg viewBox="0 0 24 24">
            <path d="M12 0c.8 6.5 3.5 10.2 12 12-8.5 1.8-11.2 5.5-12 12-.8-6.5-3.5-10.2-12-12C8.5 10.2 11.2 6.5 12 0z" />
          </svg>
        </span>
      ))}
    </span>
  )
}

const today = (): string => new Date().toISOString().slice(0, 10)
const storageGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const storageSet = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

/** "It's X's birthday today!" with sticker suggestions and a ready-made wish (like KakaoTalk). */
export function BirthdayBanner({ conversation, canSendStickers, onCelebrate }: { conversation: Conversation; canSendStickers: boolean; onCelebrate(): void }): JSX.Element | null {
  const t = useT()
  const override = useStore((s) => s.settings.contactOverrides?.[conversation.id]?.birthday)
  const profile = useStore((s) => s.profiles[conversation.id]?.birthday)
  const logo = useStore((s) => s.settings.logo ?? 'buddies')
  const send = useStore((s) => s.send)
  const setComposerDraft = useStore((s) => s.setComposerDraft)
  const showToast = useStore((s) => s.showToast)
  const dismissKey = `unison.bday.${conversation.id}.${today()}`
  const [dismissed, setDismissed] = useState(() => storageGet(dismissKey) === '1')
  const birthday = !conversation.isGroup && isBirthdayToday(override ?? profile)

  // The first time the chat is opened on the day, the characters celebrate once.
  useEffect(() => {
    if (!birthday) return
    const key = `unison.bdayfx.${conversation.id}.${today()}`
    if (storageGet(key)) return
    storageSet(key, '1')
    const timer = setTimeout(onCelebrate, 600)
    return () => clearTimeout(timer)
  }, [birthday, conversation.id, onCelebrate])

  if (!birthday || dismissed) return null
  const name = givenName(conversation.title) || conversation.title
  const stickers: StickerId[] = [`${logo}-party`, `${logo}-love`, `${logo}-kiss`] as StickerId[]
  return (
    <div className="birthday-banner" role="status">
      <span className="birthday-banner-icon">
        <Cake size={17} strokeWidth={2.2} />
      </span>
      <span className="birthday-banner-text">{t('birthdayToday', { name })}</span>
      {canSendStickers && (
        <span className="birthday-banner-stickers">
          {stickers.map((id) => (
            <button
              key={id}
              className="birthday-sticker"
              title={t('sendSticker')}
              onClick={() =>
                void (async () => {
                  try {
                    await send(conversation.id, '', [await window.unison.app.sticker(id)])
                  } catch (err) {
                    showToast((err as Error).message, 'error')
                  }
                })()
              }
            >
              <StickerArt id={id} size={34} play="hover" />
            </button>
          ))}
        </span>
      )}
      <button className="btn primary birthday-wish" onClick={() => setComposerDraft(conversation.id, fillQuickReply(t('birthdayWishText'), name))}>
        {t('birthdayWish')}
      </button>
      <button
        className="icon-btn"
        title={t('close')}
        onClick={() => {
          storageSet(dismissKey, '1')
          setDismissed(true)
        }}
      >
        <X size={14} strokeWidth={2.4} />
      </button>
    </div>
  )
}

/** Messages waiting to be sent in this chat, above the composer. */
export function ScheduledStrip({ conversationId, members }: { conversationId: string; members?: string[] }): JSX.Element | null {
  const t = useT()
  const all = useStore((s) => s.settings.scheduled)
  const language = useStore((s) => s.settings.language)
  const applySettings = useStore((s) => s.applySettings)
  const showToast = useStore((s) => s.showToast)
  // A merged person's are scheduled through any of its chats.
  const items = useMemo(
    () => (all ?? []).filter((m) => (members ?? [conversationId]).includes(m.conversationId)).sort((a, b) => a.sendAt - b.sendAt),
    [all, conversationId, members]
  )
  if (!items.length) return null
  const run = (action: Promise<unknown>): void => {
    void action.then((settings) => applySettings(settings as never)).catch((err: Error) => showToast(err.message, 'error'))
  }
  const when = (m: ScheduledMessage): string => {
    const d = new Date(m.sendAt)
    const sameDay = d.toDateString() === new Date().toDateString()
    return sameDay ? formatTime(m.sendAt, language) : `${formatListTime(m.sendAt, language)} ${formatTime(m.sendAt, language)}`
  }
  return (
    <div className="scheduled-strip">
      {items.map((m) => (
        <div key={m.id} className={`scheduled-item ${m.status}`}>
          <span className="scheduled-icon">{m.status === 'pending' ? <AlarmClock size={15} strokeWidth={2.3} /> : <AlertCircle size={15} strokeWidth={2.3} />}</span>
          <span className="scheduled-text">
            <span className="scheduled-when">
              {m.status === 'pending' ? t('scheduledAt', { time: when(m) }) : m.status === 'missed' ? t('scheduledMissed') : t('scheduledFailed')}
            </span>
            <span className="scheduled-body" title={m.error ?? m.text}>
              {m.text}
            </span>
          </span>
          <button className="scheduled-action" onClick={() => run(window.unison.scheduled.sendNow(m.id))} title={t('scheduledSendNow')}>
            <Send size={13} strokeWidth={2.4} />
            {m.status === 'pending' ? t('scheduledSendNow') : t('retry')}
          </button>
          <button className="icon-btn" onClick={() => run(window.unison.scheduled.cancel(m.id))} title={t('scheduledCancel')}>
            <X size={14} strokeWidth={2.4} />
          </button>
        </div>
      ))}
    </div>
  )
}
