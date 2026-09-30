import { useMemo } from 'react'
import { ChevronRight, Sparkles, X } from 'lucide-react'
import type { SavedMessage } from '@shared/types'
import { useStore, useT, personIn } from '../store'
import { formatAgo, formatMomentDate, formatMonthLabel } from '../utils'
import { PreviewText } from './MessageParts'
import { LogoMark } from './Logo'

const NO_MOMENTS: SavedMessage[] = []

/** The moments kept with one person, newest first. */
function useMoments(conversationId: string): SavedMessage[] {
  const saved = useStore((s) => s.settings.savedMessages ?? NO_MOMENTS)
  const people = useStore((s) => s.settings.people)
  const conversations = useStore((s) => s.conversations)
  // A merged person's moments come from all of its chats.
  const ids = useMemo(() => personIn(people, conversations, conversationId)?.members ?? [conversationId], [people, conversations, conversationId])
  return useMemo(() => saved.filter((m) => ids.includes(m.conversationId)).sort((a, b) => b.sentAt - a.sentAt), [saved, ids])
}

function MomentQuote({ moment }: { moment: SavedMessage }): JSX.Element {
  return (
    <span className="moment-quote">
      <PreviewText kind={moment.kind} text={moment.text} />
    </span>
  )
}

/** Info tab card: how many moments you share and the latest one; opens the Moments tab. */
export function MomentsPreviewCard({ conversationId }: { conversationId: string }): JSX.Element | null {
  const t = useT()
  const moments = useMoments(conversationId)
  const language = useStore((s) => s.settings.language)
  const setDetailsTab = useStore((s) => s.setDetailsTab)
  if (!moments.length) return null
  const latest = moments[0]
  return (
    <button className="details-card moments-preview" onClick={() => setDetailsTab('moments')}>
      <span className="details-card-title moments-preview-title">
        <Sparkles size={13} strokeWidth={2.4} />
        {t('tabMoments')}
        <span className="moments-preview-count">{t('momentsCount', { count: moments.length })}</span>
        <ChevronRight size={15} strokeWidth={2.4} className="moments-preview-chevron" />
      </span>
      <span className={`moment-card static ${latest.isOutgoing ? 'mine' : ''}`}>
        <MomentQuote moment={latest} />
        <span className="moment-who">
          {latest.isOutgoing ? t('you') : latest.senderName} · {formatAgo(latest.sentAt, language)}
        </span>
      </span>
    </button>
  )
}

/** Details pane tab: a little scrapbook of the messages you kept with this person. */
export function MomentsTab({ conversationId }: { conversationId: string }): JSX.Element {
  const t = useT()
  const moments = useMoments(conversationId)
  const conversation = useStore((s) => s.conversations[conversationId])
  const language = useStore((s) => s.settings.language)
  const saved = useStore((s) => s.settings.savedMessages)
  const setSettings = useStore((s) => s.setSettings)
  const openSaved = useStore((s) => s.openSaved)
  const name = conversation?.title ?? ''

  const months = useMemo(() => {
    const groups: Array<{ label: string; items: SavedMessage[] }> = []
    for (const moment of moments) {
      const label = formatMonthLabel(moment.sentAt, language)
      const last = groups[groups.length - 1]
      if (last?.label === label) last.items.push(moment)
      else groups.push({ label, items: [moment] })
    }
    return groups
  }, [moments, language])

  const remove = (moment: SavedMessage): void => {
    void setSettings({ savedMessages: (saved ?? []).filter((m) => !(m.messageId === moment.messageId && m.conversationId === moment.conversationId)) })
  }

  if (!moments.length) {
    return (
      <div className="moments-empty">
        <LogoMark size={64} mood="calm" title="" className="moments-empty-buddy" />
        <strong>{t('savedEmpty')}</strong>
        <span>{t('savedEmptyHint', { name })}</span>
      </div>
    )
  }

  const first = moments[moments.length - 1]
  return (
    <div className="moments">
      <div className="moments-hero">
        <span className="moments-hero-icon">
          <Sparkles size={18} strokeWidth={2.2} />
        </span>
        <span className="moments-hero-text">
          <strong>{t('momentsWith', { name })}</strong>
          <span>
            {t('momentsCount', { count: moments.length })} · {t('momentsSince', { date: formatMomentDate(first.sentAt, language, true) })}
          </span>
        </span>
      </div>
      {months.map((group) => (
        <section key={group.label} className="moments-month">
          <div className="moments-month-label">{group.label}</div>
          <ol className="moments-timeline">
            {group.items.map((moment) => (
              <li key={moment.messageId} className="moment">
                <span className="moment-dot" aria-hidden />
                <button className={`moment-card ${moment.isOutgoing ? 'mine' : ''}`} onClick={() => void openSaved(moment)} title={t('savedOpen')}>
                  <span className="moment-date">{formatMomentDate(moment.sentAt, language)}</span>
                  <MomentQuote moment={moment} />
                  <span className="moment-who">
                    {moment.isOutgoing ? t('you') : moment.senderName} · {formatAgo(moment.sentAt, language)}
                  </span>
                </button>
                <button className="icon-btn moment-remove" onClick={() => remove(moment)} title={t('unsaveAction')} aria-label={t('unsaveAction')}>
                  <X size={13} strokeWidth={2.6} />
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
