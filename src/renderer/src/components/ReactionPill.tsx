import { useEffect, useRef, useState } from 'react'
import type { Message, Reaction } from '@shared/types'
import { ZALO_QUICK } from '@shared/reactions'
import { useStore, useT } from '../store'

/** "❤️ Lan, Tài · 😆 You": who reacted with what, for a tooltip or a screen reader. */
function describe(reactions: Reaction[], you: string): string {
  return reactions
    .map((r) => {
      const who = [...(r.byMe ? [you] : []), ...(r.names ?? [])]
      const rest = r.count - who.length
      return `${r.emoji} ${[...who, ...(rest > 0 ? [`+${rest}`] : [])].join(', ')}`
    })
    .join(' · ')
}

/**
 * Reactions the way Zalo shows them: one small pill on the bubble's corner with the top three icons and the total,
 * yours ringed in the accent so you can always see what you put. Clicking it lists who reacted with what and lets
 * you change or take back yours with Zalo's own six.
 */
export function ReactionPill({ message, outgoing, canReact }: { message: Message; outgoing: boolean; canReact: boolean }): JSX.Element | null {
  const t = useT()
  const react = useStore((s) => s.react)
  const [open, setOpen] = useState(false)
  // Opens upward when there is not room under the pill inside the chat (near the composer).
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const reactions = message.reactions
  const mine = reactions.find((r) => r.byMe)?.emoji
  const total = reactions.reduce((n, r) => n + r.count, 0)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  if (!reactions.length) return null
  const summary = describe(reactions, t('you'))
  return (
    <div className={`zreact ${outgoing ? 'out' : 'in'}`} ref={ref}>
      <button
        className={`zreact-pill ${mine ? 'mine' : ''}`}
        onClick={() => {
          if (!open && ref.current) {
            const pill = ref.current.getBoundingClientRect()
            const chat = ref.current.closest('.chat-scroll')?.getBoundingClientRect()
            setUp((chat?.bottom ?? window.innerHeight) - pill.bottom < 240)
          }
          setOpen((v) => !v)
        }}
        title={summary}
        aria-label={`${t('reactionsLabel')}: ${summary}`}
        aria-expanded={open}
      >
        {/* Mine first, so it is always among the three shown. */}
        {[...reactions]
          .sort((a, b) => Number(b.byMe) - Number(a.byMe))
          .slice(0, 3)
          .map((r) => (
            <span key={r.emoji} className="zreact-emoji">
              {r.emoji}
            </span>
          ))}
        {total > 1 && <span className="zreact-count">{total}</span>}
      </button>
      {open && (
        <div className={`zreact-panel ${up ? 'up' : ''}`} role="dialog" aria-label={t('reactionsLabel')}>
          <ul className="zreact-list">
            {reactions.map((r) => (
              <li key={r.emoji} className={r.byMe ? 'mine' : ''}>
                <span className="zreact-list-emoji">{r.emoji}</span>
                <span className="zreact-list-who">{[...(r.byMe ? [t('you')] : []), ...(r.names ?? [])].join(', ') || t('reactionsSomeone')}</span>
                <span className="zreact-list-count">{r.count}</span>
              </li>
            ))}
          </ul>
          {canReact && (
            <div className="zreact-quick" role="group" aria-label={t('react')}>
              {ZALO_QUICK.map((emoji) => (
                <button
                  key={emoji}
                  className={mine === emoji ? 'on' : ''}
                  aria-pressed={mine === emoji}
                  title={mine === emoji ? t('removeReaction') : undefined}
                  onClick={() => {
                    setOpen(false)
                    void react(message.conversationId, message.id, emoji)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {mine && <p className="zreact-hint">{t('reactionsYours', { emoji: mine })}</p>}
        </div>
      )}
    </div>
  )
}

/** Zalo's "more" reactions: only what Zalo can actually send, in a grid (instead of every emoji there is). */
export function ReactionGrid({ emojis, current, onPick, onClose }: { emojis: string[]; current?: string; onPick(emoji: string): void; onClose(): void }): JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [onClose])
  return (
    <div className="reaction-grid" ref={ref} role="dialog" aria-label={t('moreReactions')} onMouseDown={(e) => e.stopPropagation()}>
      <p className="reaction-grid-title">{t('zaloReactionsTitle')}</p>
      <div className="reaction-grid-cells">
        {emojis.map((emoji) => (
          <button key={emoji} className={current === emoji ? 'on' : ''} aria-pressed={current === emoji} onClick={() => onPick(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
