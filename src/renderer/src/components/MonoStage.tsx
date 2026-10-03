import type { CSSProperties } from 'react'
import { PLATFORMS, PLATFORM_ORDER } from '@shared/types'
import { useT, useUnreadCounts } from '../store'

/** Where each app sits on the dial, in % of its width. */
const STATION = (i: number): number => 10 + i * 20

/**
 * The Mono style's empty chat, after a radio tuner: the unread count in big numerals (its leading zeros in grey,
 * like 094.4), and a dial of the five apps with the accent needle on the one holding the most unread messages.
 * The needle sweeps to it once, when the dial appears.
 */
export function MonoStage(): JSX.Element {
  const t = useT()
  const unread = useUnreadCounts()
  const digits = String(unread.total).padStart(3, '0')
  const lead = digits.length - String(unread.total).length
  const top = PLATFORM_ORDER.reduce((best, p) => (unread.byPlatform[p] > unread.byPlatform[best] ? p : best), PLATFORM_ORDER[0])
  const tuned = unread.total > 0 ? PLATFORM_ORDER.indexOf(top) : -1
  return (
    <div className="mono-dial">
      <div className="mono-num" aria-label={`${unread.total} ${t('monoUnread')}`}>
        <span className="mono-num-lead" aria-hidden>
          {digits.slice(0, lead)}
        </span>
        <span aria-hidden>{digits.slice(lead)}</span>
      </div>
      <div className="mono-num-label">
        {unread.total > 0 ? `${t('monoUnread')} · ${t('monoMostOn', { app: PLATFORMS[top].name })}` : t('monoAllRead')}
      </div>
      <div className="mono-ruler" aria-hidden>
        {PLATFORM_ORDER.map((p, i) => (
          <span key={p} className={`mono-station ${i === tuned ? 'on' : ''}`} style={{ left: `${STATION(i)}%` }}>
            <i />
            <b>{PLATFORMS[p].name}</b>
          </span>
        ))}
        <span className="mono-needle" style={{ ['--at' as string]: `${tuned < 0 ? 50 : STATION(tuned)}%` } as CSSProperties} />
      </div>
    </div>
  )
}
