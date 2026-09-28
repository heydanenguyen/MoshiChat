import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlarmClock, AlertCircle, Cake, Send, X } from 'lucide-react'
import type { Conversation, Message, ScheduledMessage } from '@shared/types'
import { detectEffect, fillQuickReply, givenName, isBirthdayToday, type EffectKind } from '@shared/extras'
import type { StickerId } from '@shared/stickers'
import { useStore, useT } from '../store'
import { formatListTime, formatTime } from '../utils'
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

/** Confetti, hearts or fireworks over the chat, with the chosen logo character popping up to cheer. */
export function EffectLayer({ kind, seed, onDone }: { kind: EffectKind; seed: string; onDone(): void }): JSX.Element {
  const t = useT()
  const quiet = reducedMotion()
  useEffect(() => {
    const timer = setTimeout(onDone, quiet ? 1800 : 3600)
    return () => clearTimeout(timer)
  }, [onDone, quiet])

  const pieces = useMemo(() => {
    const rnd = seeded([...seed].reduce((a, c) => a + c.charCodeAt(0), 7))
    if (quiet) return []
    if (kind === 'love') {
      return Array.from({ length: 22 }, (_, i) => (
        <span
          key={i}
          className="fx-heart"
          style={
            {
              left: `${4 + rnd() * 92}%`,
              '--size': `${14 + rnd() * 18}px`,
              '--delay': `${rnd() * 900}ms`,
              '--dur': `${2200 + rnd() * 1200}ms`,
              '--sway': `${(rnd() - 0.5) * 60}px`,
              color: ['#FF4F7B', '#FF7AC0', '#FF5B1F', '#E0457B'][i % 4]
            } as CSSProperties
          }
        >
          <svg viewBox="0 0 24 22" aria-hidden>
            <path d="M12 21.4 10.3 19.9C4.4 14.5.5 11 .5 6.6.5 3 3.3.3 6.8.3c2 0 3.9.9 5.2 2.4C13.3 1.2 15.2.3 17.2.3c3.5 0 6.3 2.7 6.3 6.3 0 4.4-3.9 7.9-9.8 13.3Z" fill="currentColor" />
          </svg>
        </span>
      ))
    }
    if (kind === 'newyear') {
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
    }
    return Array.from({ length: 80 }, (_, i) => (
      <span
        key={i}
        className={`fx-confetti s${i % 3}`}
        style={
          {
            left: `${rnd() * 100}%`,
            background: COLORS[i % COLORS.length],
            '--delay': `${rnd() * 700}ms`,
            '--dur': `${1900 + rnd() * 1500}ms`,
            '--drift': `${(rnd() - 0.5) * 160}px`,
            '--spin': `${(rnd() > 0.5 ? 1 : -1) * (360 + rnd() * 540)}deg`
          } as CSSProperties
        }
      />
    ))
  }, [kind, seed, quiet])

  const cheer = kind === 'birthday' ? t('effectBirthday') : kind === 'newyear' ? t('effectNewYear') : kind === 'congrats' ? t('effectCongrats') : undefined
  return (
    <div className={`fx-layer fx-${kind}`} aria-hidden>
      {pieces}
      {cheer && (
        <div className="fx-buddy">
          <div className="fx-buddy-bubble">{cheer}</div>
          <LogoMark size={84} title="" />
        </div>
      )}
    </div>
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
              <StickerArt id={id} size={34} />
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
export function ScheduledStrip({ conversationId }: { conversationId: string }): JSX.Element | null {
  const t = useT()
  const all = useStore((s) => s.settings.scheduled)
  const language = useStore((s) => s.settings.language)
  const applySettings = useStore((s) => s.applySettings)
  const showToast = useStore((s) => s.showToast)
  const items = useMemo(() => (all ?? []).filter((m) => m.conversationId === conversationId).sort((a, b) => a.sendAt - b.sendAt), [all, conversationId])
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
