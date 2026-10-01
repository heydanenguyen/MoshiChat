import { useEffect, useState } from 'react'
import { Crown, Flame } from 'lucide-react'
import type { ShareCardData } from '@shared/insights'
import type { LogoId } from '@shared/logos'
import { translate } from '../i18n'
import { Avatar } from './Avatar'
import { LogoMark } from './Logo'
import { INNER, OUTER, PERSONA_LABEL, WEEKDAYS, hourPhrase, personaOf } from './Insights'

/**
 * The share window (#share, off screen, 1080 × 1920): asks main for the card, draws it, waits for fonts and
 * pictures, then says it is ready so main can capture it.
 */
export function ShareRoot(): JSX.Element | null {
  const [card, setCard] = useState<ShareCardData | undefined>()
  useEffect(() => {
    document.documentElement.classList.add('share-mode')
    void window.unison.insights.shareData().then(setCard)
  }, [])
  useEffect(() => {
    if (!card) return
    const pictures = [...document.images].map((img) =>
      img.complete
        ? undefined
        : new Promise((done) => {
            img.addEventListener('load', done)
            img.addEventListener('error', done)
          })
    )
    void Promise.all([document.fonts.ready, ...pictures]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => window.unison.insights.shareReady())))
  }, [card])
  return card ? <ShareCard card={card} /> : null
}

const MEDALS = ['gold', 'silver', 'bronze'] as const

/** Close friends as a story: the orbit, the period in three numbers, the podium, and where it came from. */
function ShareCard({ card }: { card: ShareCardData }): JSX.Element {
  const tr = (key: Parameters<typeof translate>[1], params?: Record<string, string>): string => translate(card.language, key, params)
  const persona = personaOf(card.busiestHour)
  const friends = card.friends.slice(0, 8)
  const podium = [1, 0, 2].filter((i) => card.friends[i])
  return (
    <div className="share-card" style={{ '--share-accent': card.accent, '--share-logo': card.logoColor } as React.CSSProperties}>
      <header className="share-top">
        <span className="share-brand">
          <LogoMark size={64} logo={card.logo as LogoId} title="" />
          Moshi
        </span>
        <span className="share-period">{tr(card.period === 'month' ? 'shareMonth' : 'shareYear')}</span>
      </header>
      <h1 className="share-title">{tr('shareTitle')}</h1>

      <div className="share-orbit">
        <span className="share-ring inner" />
        <span className="share-ring outer" />
        <span className="share-me">
          <Avatar name={card.me.name} url={card.me.avatarUrl} size={150} />
          <span>{tr('cfYou')}</span>
        </span>
        {friends.map((f, i) => {
          const inner = i < 3
          const angle = ((inner ? INNER[i] : OUTER[i - 3]) * Math.PI) / 180
          // Wider rings and smaller faces than in the app: the picture has room, and nobody may cover you.
          const [rx, ry] = inner ? [29, 33] : [44, 45]
          const size = i === 0 ? 150 : inner ? 116 : 90
          return (
            <span key={i} className={`share-friend ${i === 0 ? 'first' : ''}`} style={{ left: `${50 + Math.cos(angle) * rx}%`, top: `${50 + Math.sin(angle) * ry}%` }}>
              <span className="share-face">
                <Avatar name={f.name} url={f.avatarUrl} size={size} />
                {i === 0 && (
                  <span className="share-crown">
                    <Crown size={34} strokeWidth={2.6} />
                  </span>
                )}
                {f.streak >= 2 && (
                  <span className="share-flame">
                    <Flame size={26} strokeWidth={2.8} />
                    {f.streak}
                  </span>
                )}
              </span>
              {inner && <span className="share-name">{f.name.length <= 12 ? f.name : f.name.split(/\s+/)[0]}</span>}
            </span>
          )
        })}
      </div>

      <div className="share-stats">
        <div className="share-stat">
          <b>{card.total.toLocaleString(card.language)}</b>
          <span>{tr('cfCardMessagesUnit')}</span>
        </div>
        <div className="share-stat persona">
          <b>{tr(PERSONA_LABEL[persona])}</b>
          <span>{tr('cfCardTimeSub', { hour: hourPhrase(card.busiestHour, card.language), weekday: (card.language === 'vi' ? WEEKDAYS.vi : WEEKDAYS.en)[card.busiestWeekday] })}</span>
        </div>
        {card.streak && (
          <div className="share-stat fire">
            <b>
              <Flame size={64} strokeWidth={2.6} />
              {card.streak.days}
            </b>
            <span>{tr('cfCardStreakWith', { name: card.streak.name })}</span>
          </div>
        )}
      </div>

      <div className="share-podium">
        {podium.map((i) => (
          <div key={i} className={`share-place ${MEDALS[i]}`}>
            <span className="share-place-face">
              <Avatar name={card.friends[i].name} url={card.friends[i].avatarUrl} size={i === 0 ? 150 : 120} />
              <span className="share-medal">{i + 1}</span>
            </span>
            <span className="share-place-name">{card.friends[i].name}</span>
            <span className="share-step" />
          </div>
        ))}
      </div>

      <footer className="share-foot">{tr('shareMadeWith')}</footer>
    </div>
  )
}
