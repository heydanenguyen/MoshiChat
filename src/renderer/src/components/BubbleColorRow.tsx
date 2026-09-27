import { ACCENTS } from '@shared/types'
import { useStore, useT } from '../store'

/** Per-chat outgoing bubble colour: follow the app accent, a preset, or one of your custom accents. */
export function BubbleColorRow({ conversationId }: { conversationId: string }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const custom = useStore((s) => s.settings.contactOverrides?.[conversationId])
  const customAccents = useStore((s) => s.settings.customAccents)
  const setContactOverride = useStore((s) => s.setContactOverride)
  const current = custom?.bubble
  const pick = (bubble?: string): void => void setContactOverride(conversationId, { ...custom, bubble })
  const options = [
    ...ACCENTS.map((a) => ({ id: a.id as string, fill: a.flat ? a.from : `linear-gradient(135deg, ${a.from}, ${a.to})`, flat: !!a.flat, name: a.name[language] })),
    ...(customAccents ?? []).map((a) => ({ id: a.id as string, fill: a.to ? `linear-gradient(135deg, ${a.from}, ${a.to})` : a.from, flat: !a.to, name: a.to ? `${a.from} → ${a.to}` : a.from }))
  ]
  return (
    <div className="bubble-colors" role="radiogroup" aria-label={t('bubbleColor')}>
      <button className={`bubble-color default ${!current ? 'active' : ''}`} role="radio" aria-checked={!current} onClick={() => pick(undefined)} title={t('bubbleDefault')}>
        <span style={{ background: 'var(--accent-gradient)' }} />
      </button>
      {options.map((o) => (
        <button
          key={o.id}
          className={`bubble-color ${o.flat ? 'flat' : ''} ${current === o.id ? 'active' : ''}`}
          role="radio"
          aria-checked={current === o.id}
          onClick={() => pick(o.id)}
          title={o.name}
        >
          <span style={{ background: o.fill }} />
        </button>
      ))}
    </div>
  )
}
